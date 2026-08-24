-- Đợt 2 của "ca cố định": series không có ngày kết thúc.
--
-- 0078 và 0079 đều chặn thẳng p_ends_on is null, kèm ghi chú "Mở ở Đợt 2" —
-- vì chưa có cron gia hạn thì một series vô hạn sẽ đứng yên mãi ở lô đầu tiên,
-- tệ hơn là không cho tạo. Migration này bổ sung đúng cái còn thiếu đó.
--
-- Ba việc:
--   1. Tách vòng lặp sinh ca ra thành materialise_shift_series(), để lúc tạo
--      và lúc cron gia hạn dùng chung MỘT bản logic. Trước đây vòng lặp nằm
--      lồng trong create_shift_series; nhân đôi nó ra chỗ khác là cách chắc
--      chắn nhất để hai đường dần dần lệch nhau.
--   2. Thêm cột materialised_through — "luật này đã được rải tới ngày nào".
--   3. extend_shift_series() cho cron gọi hằng đêm.

-- ---------------------------------------------------------------------------
-- 1. Cột theo dõi mốc đã rải
-- ---------------------------------------------------------------------------
-- Vì sao cần cột riêng thay vì suy ra từ max(shifts.start_at) của series:
-- nếu quản lý cố ý xoá đúng buổi cuối cùng, cách suy-ra sẽ thấy mốc lùi lại
-- một tuần rồi đêm sau tạo lại đúng buổi vừa bị xoá — nhìn y như lỗi. Cột này
-- chỉ tiến, không lùi, nên xoá một buổi là xoá thật.
alter table public.shift_series
  add column if not exists materialised_through date;

-- Series cũ đều có ends_on (Đợt 1 bắt buộc) và đã được rải trọn khoảng đó.
update public.shift_series
set materialised_through = ends_on
where materialised_through is null and ends_on is not null;

comment on column public.shift_series.materialised_through is
  'Ngày cuối cùng đã sinh ca/ô trống cho luật này. NULL = chưa rải lần nào.';

-- ---------------------------------------------------------------------------
-- 2. Chân trời
-- ---------------------------------------------------------------------------
-- 12 tuần, đúng con số chủ app chốt. Đặt thành hàm thay vì hằng số rải rác để
-- create và extend không bao giờ lệch nhau.
create or replace function public.shift_series_horizon()
returns int language sql immutable as $$ select 84; $$;

-- ---------------------------------------------------------------------------
-- 3. materialise_shift_series() — vòng lặp dùng chung
-- ---------------------------------------------------------------------------
-- Sinh ca (hoặc ô trống, nếu luật không gán ai) cho MỘT series trong khoảng
-- [p_from, p_to]. Bỏ qua và ghi lại buổi nào bị trùng, không huỷ cả lô.
--
-- Mốc đếm tuần luôn lấy từ series.starts_on chứ KHÔNG phải p_from. Đây là chỗ
-- dễ sai nhất khi gia hạn: neo theo p_from thì một luật "cách 2 tuần" sẽ đổi
-- pha mỗi lần cron chạy, và các buổi mới lệch hẳn khỏi nhịp cũ.
--
-- created_by lấy từ series, không từ auth.uid(): cron chạy không có phiên
-- đăng nhập nào cả.
create or replace function public.materialise_shift_series(
  p_series_id uuid,
  p_from      date,
  p_to        date
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_zone     constant text := 'Asia/Ho_Chi_Minh';
  v_series   public.shift_series%rowtype;
  v_anchor   date;
  v_date     date;
  v_dow      smallint;
  v_end_date date;
  v_start    timestamptz;
  v_end      timestamptz;
  v_created  int := 0;
  v_skipped  jsonb := '[]'::jsonb;
begin
  select * into v_series from public.shift_series where id = p_series_id;
  if not found then
    raise exception 'Không tìm thấy ca cố định' using errcode = '23514';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    return jsonb_build_object('created', 0, 'skipped', v_skipped);
  end if;

  v_anchor := v_series.starts_on - extract(dow from v_series.starts_on)::int;

  v_date := p_from;
  while v_date <= p_to loop
    v_dow := extract(dow from v_date)::smallint;
    if v_dow = any(v_series.weekdays)
       and (((v_date - v_dow::int) - v_anchor) / 7) % v_series.interval_weeks = 0 then

      -- (date + time) ra timestamp không múi giờ; at time zone gán nó là giờ
      -- Việt Nam rồi đổi sang timestamptz. Không dùng now() hay Date của tiến
      -- trình app — tiến trình đó không đặt TZ.
      v_start := (v_date + v_series.start_time) at time zone v_zone;
      v_end_date := case
        when v_series.end_time <= v_series.start_time then v_date + 1
        else v_date
      end;
      v_end := (v_end_date + v_series.end_time) at time zone v_zone;

      if v_series.assignee_id is null then
        -- Hai ô trống trùng giờ là vô hại (chưa có ai để đụng lịch), nhưng
        -- cron chạy lại trong cùng một ngày thì không được đẻ ra ô thứ hai.
        if not exists (
          select 1 from public.shift_slots sl
          where sl.series_id = v_series.id and sl.start_at = v_start
        ) then
          insert into public.shift_slots (
            branch_id, series_id, shift_type, note, start_at, end_at, created_by
          ) values (
            v_series.branch_id, v_series.id, v_series.shift_type, v_series.note,
            v_start, v_end, v_series.created_by
          );
          v_created := v_created + 1;
        end if;
      elsif exists (
        select 1 from public.shifts s
        where s.assignee_id = v_series.assignee_id
          and tstzrange(s.start_at, s.end_at) && tstzrange(v_start, v_end)
      ) then
        v_skipped := v_skipped || jsonb_build_object('date', v_date, 'reason', 'Đã có ca trùng giờ');
      else
        begin
          insert into public.shifts (
            assignee_id, branch_id, start_at, end_at, shift_type, note, created_by, series_id
          ) values (
            v_series.assignee_id, v_series.branch_id, v_start, v_end,
            v_series.shift_type, v_series.note, v_series.created_by, v_series.id
          );
          v_created := v_created + 1;
        exception when others then
          -- student_affairs_slot_taken và bạn bè: bỏ buổi đó, giữ phần còn lại.
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'reason', SQLERRM);
        end;
      end if;
    end if;
    v_date := v_date + 1;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. create_shift_series() — nhận ends_on rỗng
-- ---------------------------------------------------------------------------
-- Khác bản 0079 ở đúng ba chỗ: bỏ câu chặn null, tính cửa sổ rải đầu tiên, và
-- gọi materialise_shift_series thay vì lặp tại chỗ. Mọi kiểm tra quyền giữ
-- nguyên từng chữ.
create or replace function public.create_shift_series(
  p_assignee_id    uuid,
  p_branch_id      uuid,
  p_shift_type     public.shift_type,
  p_weekdays       smallint[],
  p_interval_weeks smallint,
  p_start_time     time,
  p_end_time       time,
  p_starts_on      date,
  p_ends_on        date,
  p_note           text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_zone    constant text := 'Asia/Ho_Chi_Minh';
  v_uid     uuid := auth.uid();
  v_series  public.shift_series%rowtype;
  v_days    smallint[];
  v_today   date := (now() at time zone v_zone)::date;
  v_window  date;
  v_result  jsonb;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  if p_assignee_id is null then
    if not public.can_manage_shift_slots() then
      raise exception 'Bạn không có quyền tạo ca cố định';
    end if;
  elsif not public.can_manage_shift_for(p_assignee_id) then
    raise exception 'Bạn không có quyền xếp ca cho nhân viên này';
  end if;

  if p_branch_id is null then
    raise exception 'Vui lòng chọn cơ sở' using errcode = '23514';
  end if;
  -- p_ends_on null giờ hợp lệ: "không kết thúc".
  if p_ends_on is not null then
    if p_ends_on < p_starts_on then
      raise exception 'Ngày kết thúc phải sau ngày bắt đầu' using errcode = '23514';
    end if;
    if p_ends_on - p_starts_on > 366 then
      raise exception 'Ca cố định chỉ được lặp tối đa 1 năm' using errcode = '23514';
    end if;
  end if;

  select array_agg(distinct d order by d) into v_days
  from unnest(p_weekdays) as d where d between 0 and 6;
  if v_days is null or array_length(v_days, 1) = 0 then
    raise exception 'Vui lòng chọn ít nhất một ngày trong tuần' using errcode = '23514';
  end if;

  insert into public.shift_series (
    branch_id, assignee_id, shift_type, note, weekdays, interval_weeks,
    start_time, end_time, starts_on, ends_on, created_by
  ) values (
    p_branch_id, p_assignee_id, p_shift_type, nullif(p_note, ''), v_days,
    greatest(coalesce(p_interval_weeks, 1::smallint), 1::smallint),
    p_start_time, p_end_time, p_starts_on, p_ends_on, v_uid
  ) returning * into v_series;

  -- Có ngày kết thúc thì rải trọn. Không có thì rải tới chân trời tính từ HÔM
  -- NAY, không từ starts_on: một luật bắt đầu từ tháng trước vẫn chỉ cần phủ
  -- 12 tuần tới, chứ không phải 12 tuần kể từ ngày bắt đầu.
  v_window := coalesce(
    p_ends_on,
    greatest(p_starts_on, v_today) + public.shift_series_horizon()
  );

  v_result := public.materialise_shift_series(v_series.id, p_starts_on, v_window);

  update public.shift_series set materialised_through = v_window where id = v_series.id;

  return jsonb_build_object(
    'series_id', v_series.id,
    'created', v_result->'created',
    'skipped', v_result->'skipped',
    -- Cho tầng app biết vừa sinh ra ô trống hay ca thật, để chọn đúng câu
    -- thông báo và để KHÔNG bắn notification cho ai — ô trống chưa có chủ.
    'unassigned', p_assignee_id is null,
    'open_ended', p_ends_on is null
  );
end;
$$;

grant execute on function public.create_shift_series(
  uuid, uuid, public.shift_type, smallint[], smallint, time, time, date, date, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. extend_shift_series() — cron hằng đêm
-- ---------------------------------------------------------------------------
-- Đẩy mọi series không có ngày kết thúc lên tới chân trời 12 tuần.
--
-- Chỉ tiến từ materialised_through + 1, nên chạy lại nhiều lần trong cùng một
-- ngày không sinh thêm gì — cron của Vercel có thể chạy lặp khi retry.
--
-- KHÔNG cấp quyền cho authenticated: hàm này bỏ qua mọi kiểm tra quyền theo
-- người (buộc phải vậy, vì chạy không có phiên đăng nhập), nên chỉ
-- service_role — tức route cron dùng supabaseAdmin — được gọi.
create or replace function public.extend_shift_series()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_zone    constant text := 'Asia/Ho_Chi_Minh';
  v_today   date := (now() at time zone v_zone)::date;
  v_target  date := v_today + public.shift_series_horizon();
  v_row     record;
  v_from    date;
  v_result  jsonb;
  v_series  int := 0;
  v_created int := 0;
begin
  for v_row in
    select id, starts_on, materialised_through
    from public.shift_series
    where ends_on is null
  loop
    v_from := greatest(
      coalesce(v_row.materialised_through + 1, v_row.starts_on),
      v_row.starts_on,
      -- Không bao giờ rải ngược về quá khứ: một series bị bỏ quên vài tháng
      -- không được đột ngột sinh ra hàng loạt ca đã qua.
      v_today
    );
    if v_from > v_target then
      continue;
    end if;

    v_result := public.materialise_shift_series(v_row.id, v_from, v_target);
    update public.shift_series set materialised_through = v_target where id = v_row.id;

    v_series := v_series + 1;
    v_created := v_created + coalesce((v_result->>'created')::int, 0);
  end loop;

  return jsonb_build_object('series', v_series, 'created', v_created, 'through', v_target);
end;
$$;

revoke all on function public.extend_shift_series() from public;
revoke all on function public.extend_shift_series() from authenticated;
grant execute on function public.extend_shift_series() to service_role;
