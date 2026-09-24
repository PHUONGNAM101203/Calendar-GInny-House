-- Nhiệm vụ của ca cố định.
--
-- Ca cố định sinh ra ô trống, nhưng ô trống không mang thông tin nào về việc
-- cần người thuộc vai trò gì — nhìn vào chỉ thấy "Ca trống · Cơ sở 1". Người
-- xếp lịch báo đúng chỗ này: "ca cố định này chưa có nhiệm vụ, kiểu quản sinh
-- hay trợ giảng hay gì ấy".
--
-- duty_role là YÊU CẦU ĐẶT TRÊN Ô TRỐNG, không phải thuộc tính của ca sau khi
-- đã có người. Khi ô trống thành ca thật, ca đó phản ánh người thật đang giữ
-- nó (xem computeShiftKind) — trừ đúng một trường hợp: nhiệm vụ lễ tân, vì
-- shifts.covering_role sinh ra chính để diễn đạt "người này đang trực quầy
-- thay vì làm vai trò gốc", và ràng buộc shifts_covering_role_valid chỉ nhận
-- null hoặc 'receptionist'.
alter table public.shift_series add column if not exists duty_role public.staff_role;
alter table public.shift_slots  add column if not exists duty_role public.staff_role;

comment on column public.shift_series.duty_role is
  'Nhiệm vụ của ca cố định (quản sinh, trợ giảng...). NULL = không chỉ định, ca theo vai trò gốc của người được xếp.';
comment on column public.shift_slots.duty_role is
  'Nhiệm vụ mà ô trống này cần. Sao từ shift_series.duty_role lúc sinh ô.';

-- Bản 10 tham số phải biến mất, nếu không PostgREST thấy hai overload và một
-- lời gọi thiếu p_duty_role lại rơi vào nhánh cũ, ô trống tiếp tục không có
-- nhiệm vụ — tức lỗi vẫn còn nguyên một đường đi.
drop function if exists public.create_shift_series(
  uuid, uuid, public.shift_type, smallint[], smallint, time, time, date, date, text
);

create or replace function public.create_shift_series(
  p_assignee_id uuid,
  p_branch_id uuid,
  p_shift_type public.shift_type,
  p_weekdays smallint[],
  p_interval_weeks smallint,
  p_start_time time without time zone,
  p_end_time time without time zone,
  p_starts_on date,
  p_ends_on date,
  p_note text default null,
  p_duty_role public.staff_role default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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
    start_time, end_time, starts_on, ends_on, created_by, duty_role
  ) values (
    p_branch_id, p_assignee_id, p_shift_type, nullif(p_note, ''), v_days,
    greatest(coalesce(p_interval_weeks, 1::smallint), 1::smallint),
    p_start_time, p_end_time, p_starts_on, p_ends_on, v_uid, p_duty_role
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

revoke all on function public.create_shift_series(
  uuid, uuid, public.shift_type, smallint[], smallint, time, time, date, date, text, public.staff_role
) from public;
grant execute on function public.create_shift_series(
  uuid, uuid, public.shift_type, smallint[], smallint, time, time, date, date, text, public.staff_role
) to authenticated, service_role;

-- Mang nhiệm vụ xuống từng ô trống, và xuống ca thật khi ca cố định đã có
-- người ngay từ đầu.
create or replace function public.materialise_shift_series(p_series_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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
  v_covering public.staff_role;
begin
  select * into v_series from public.shift_series where id = p_series_id;
  if not found then
    raise exception 'Không tìm thấy ca cố định' using errcode = '23514';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    return jsonb_build_object('created', 0, 'skipped', v_skipped);
  end if;

  -- Chỉ nhiệm vụ lễ tân mới đổ được xuống shifts.covering_role — ràng buộc
  -- shifts_covering_role_valid chỉ nhận null hoặc 'receptionist'. Các nhiệm vụ
  -- khác sống trên ô trống như một yêu cầu; ca đã có người thì phản ánh chính
  -- người đó.
  v_covering := case when v_series.duty_role = 'receptionist' then 'receptionist'::public.staff_role end;

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
            branch_id, series_id, shift_type, note, start_at, end_at, created_by, duty_role
          ) values (
            v_series.branch_id, v_series.id, v_series.shift_type, v_series.note,
            v_start, v_end, v_series.created_by, v_series.duty_role
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
            assignee_id, branch_id, start_at, end_at, shift_type, note, created_by, series_id, covering_role
          ) values (
            v_series.assignee_id, v_series.branch_id, v_start, v_end,
            v_series.shift_type, v_series.note, v_series.created_by, v_series.id, v_covering
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

-- Xếp người vào ô trống: mang nhiệm vụ lễ tân của ô sang ca vừa tạo, để
-- trigger enforce_reception_shift_assignee tự từ chối người không kiêm lễ tân
-- thay vì âm thầm tạo một ca sai nhiệm vụ.
create or replace function public.assign_shift_slot(p_slot_id uuid, p_assignee_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid   uuid := auth.uid();
  v_slot  public.shift_slots%rowtype;
  v_shift public.shifts%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if p_assignee_id is null then
    raise exception 'Vui lòng chọn nhân viên' using errcode = '23514';
  end if;
  if not public.can_manage_shift_for(p_assignee_id) then
    raise exception 'Bạn không có quyền xếp ca cho nhân viên này';
  end if;

  -- for update: hai quản lý cùng gán một ô trống thì người thứ hai phải thấy
  -- nó đã biến mất, chứ không tạo ra ca thứ hai từ cùng một kế hoạch.
  select * into v_slot from public.shift_slots where id = p_slot_id for update;
  if not found then
    raise exception 'Ô ca này không còn nữa' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.shifts s
    where s.assignee_id = p_assignee_id
      and tstzrange(s.start_at, s.end_at) && tstzrange(v_slot.start_at, v_slot.end_at)
  ) then
    raise exception 'Nhân viên này đã có ca trùng giờ' using errcode = '23505';
  end if;

  insert into public.shifts (
    assignee_id, branch_id, start_at, end_at, shift_type, note, created_by, series_id, covering_role
  ) values (
    p_assignee_id, v_slot.branch_id, v_slot.start_at, v_slot.end_at,
    v_slot.shift_type, v_slot.note, v_uid, v_slot.series_id,
    case when v_slot.duty_role = 'receptionist' then 'receptionist'::public.staff_role end
  ) returning * into v_shift;

  delete from public.shift_slots where id = p_slot_id;

  return jsonb_build_object(
    'shift_id', v_shift.id,
    'assignee_id', p_assignee_id,
    'start_at', v_shift.start_at,
    'end_at', v_shift.end_at
  );
end;
$$;
