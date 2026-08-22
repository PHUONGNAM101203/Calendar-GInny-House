-- Ca cố định (recurring shifts) — Đợt 1.
-- Xem docs/superpowers/specs/2026-08-22-recurring-shifts-design.md.
--
-- Spec đánh số migration này là 0077; 0077 đã bị notifications lấy trong cùng
-- phiên làm việc đó, nên số thực tế là 0078. Nội dung không đổi.
--
-- Purely additive: một bảng mới, một cột mới trên shifts, hai RPC mới. Không
-- sửa/không xoá bất cứ policy, trigger hay cột nào đang chạy — an toàn để
-- push thẳng lên database production (không có staging).

-- ---------------------------------------------------------------------------
-- 1. Bảng shift_series — LUẬT lặp, không phải các ca đã sinh ra.
-- ---------------------------------------------------------------------------
create table public.shift_series (
  id             uuid primary key default gen_random_uuid(),
  branch_id      uuid not null references public.branches(id) on delete cascade,
  -- not null ở Đợt 1. Ô trống chưa có người (Đợt 3) sẽ là một bảng riêng, KHÔNG
  -- phải shift/series với assignee null — assignee_id là cột chịu lực của cả
  -- RLS (can_manage_shift_for) lẫn ràng buộc shifts_no_overlap.
  assignee_id    uuid not null references public.profiles(id) on delete cascade,
  shift_type     public.shift_type not null default 'morning',
  note           text,
  -- 0 = Chủ nhật … 6 = Thứ Bảy, khớp extract(dow) của Postgres và getDay() của JS.
  weekdays       smallint[] not null,
  interval_weeks smallint not null default 1,
  -- Giờ địa phương (Asia/Ho_Chi_Minh). end_time <= start_time nghĩa là ca qua
  -- đêm, kết thúc vào ngày hôm sau — đúng quy ước ShiftFormDialog đang dùng.
  start_time     time not null,
  end_time       time not null,
  starts_on      date not null,
  -- null dành cho Đợt 2 ("Không kết thúc"). Đợt 1 bắt buộc có, chặn ở RPC bên dưới.
  ends_on        date,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint shift_series_weekdays_valid check (
    array_length(weekdays, 1) between 1 and 7
    and weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  ),
  constraint shift_series_interval_valid check (interval_weeks between 1 and 8),
  constraint shift_series_range_valid check (ends_on is null or ends_on >= starts_on)
);

create index shift_series_assignee_idx on public.shift_series (assignee_id);

-- ---------------------------------------------------------------------------
-- 2. shifts.series_id — sợi dây nối ca đã sinh về luật sinh ra nó.
-- ---------------------------------------------------------------------------
-- ON DELETE SET NULL, KHÔNG PHẢI CASCADE: xoá cái luật không bao giờ được âm
-- thầm xoá theo lịch sử đã có chấm công. Xoá hàng loạt là một hành động riêng,
-- có kiểm soát — delete_shift_series_occurrences() bên dưới.
alter table public.shifts
  add column series_id uuid references public.shift_series(id) on delete set null;

create index shifts_series_idx on public.shifts (series_id) where series_id is not null;

-- ---------------------------------------------------------------------------
-- 3. RLS — cùng ranh giới với chính bảng shifts.
-- ---------------------------------------------------------------------------
alter table public.shift_series enable row level security;

-- Người được xếp thấy luật của chính mình (chỉ đọc); quản lý thấy luật của
-- những người họ có quyền xếp ca, đúng phạm vi can_manage_shift_for đang dùng
-- cho shifts_insert/_update/_delete (0043 + 0048).
create policy shift_series_select on public.shift_series
  for select to authenticated
  using (assignee_id = auth.uid() or public.can_manage_shift_for(assignee_id));

create policy shift_series_insert_manager on public.shift_series
  for insert to authenticated
  with check (public.can_manage_shift_for(assignee_id));

create policy shift_series_update_manager on public.shift_series
  for update to authenticated
  using (public.can_manage_shift_for(assignee_id))
  with check (public.can_manage_shift_for(assignee_id));

create policy shift_series_delete_manager on public.shift_series
  for delete to authenticated
  using (public.can_manage_shift_for(assignee_id));

-- ---------------------------------------------------------------------------
-- 4. create_shift_series() — tạo luật rồi sinh từng ca một.
-- ---------------------------------------------------------------------------
-- BỎ QUA-VÀ-BÁO-LẠI, không phải huỷ cả lô. Hai lý do một tuần bị trùng đều
-- được xử lý, nhưng theo hai cách khác nhau và cả hai đều cần thiết:
--
--   (a) shifts_no_overlap là DEFERRABLE INITIALLY DEFERRED (0001) — nó chỉ nổ
--       lúc COMMIT, thành MỘT lỗi duy nhất cho cả transaction, không thể quy về
--       ngày nào. Nên phải TỰ KIỂM TRA TRƯỚC khi insert. Truy vấn kiểm tra đọc
--       được cả những dòng vừa insert trong chính transaction này, nên nó cũng
--       chặn được hai tuần của cùng series tự chồng lên nhau.
--
--   (b) Các trigger BEFORE INSERT trên shifts (quản sinh trùng suất — 0055,
--       branch mặc định — 0040) thì nổ NGAY tại lệnh insert. Block
--       begin/exception bọc từng insert tạo một subtransaction, nên một ngày
--       hỏng chỉ mất đúng ngày đó; SQLERRM chính là câu tiếng Việt trigger raise
--       ra, dùng thẳng làm lý do bỏ qua.
--
-- SECURITY DEFINER + tự kiểm tra can_manage_shift_for: hàm cần đọc TOÀN BỘ ca
-- của người được xếp để dò trùng, kể cả ca ở cơ sở người tạo không xem được.
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
  v_zone     constant text := 'Asia/Ho_Chi_Minh';
  v_uid      uuid := auth.uid();
  v_series   public.shift_series%rowtype;
  v_days     smallint[];
  v_anchor   date;
  v_date     date;
  v_dow      smallint;
  v_end_date date;
  v_start    timestamptz;
  v_end      timestamptz;
  v_created  int := 0;
  v_skipped  jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if not public.can_manage_shift_for(p_assignee_id) then
    raise exception 'Bạn không có quyền xếp ca cho nhân viên này';
  end if;
  if p_branch_id is null then
    raise exception 'Vui lòng chọn cơ sở' using errcode = '23514';
  end if;
  -- Đợt 1 chưa có cron gia hạn, nên một series không có ngày kết thúc sẽ đứng
  -- yên mãi mãi ở lô đầu tiên — tệ hơn là không cho tạo. Mở ở Đợt 2.
  if p_ends_on is null then
    raise exception 'Vui lòng chọn ngày kết thúc' using errcode = '23514';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'Ngày kết thúc phải sau ngày bắt đầu' using errcode = '23514';
  end if;
  if p_ends_on - p_starts_on > 366 then
    raise exception 'Ca cố định chỉ được lặp tối đa 1 năm' using errcode = '23514';
  end if;

  -- Chuẩn hoá: bỏ trùng, bỏ giá trị ngoài 0..6, sắp xếp. Một thứ bị chọn hai
  -- lần mà không dọn sẽ sinh hai ca cùng ngày rồi tự báo trùng chính nó.
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

  -- Mốc đếm tuần: Chủ nhật của tuần chứa starts_on. Cả mốc lẫn từng ngày đều
  -- quy về Chủ nhật trước khi trừ, nên "cách N tuần" luôn tính trên ranh giới
  -- tuần chứ không phải trên số ngày lệch — chọn Thứ Hai và Thứ Bảy trong cùng
  -- một tuần thì cả hai phải cùng thuộc về tuần đó.
  v_anchor := p_starts_on - extract(dow from p_starts_on)::int;

  v_date := p_starts_on;
  while v_date <= p_ends_on loop
    v_dow := extract(dow from v_date)::smallint;
    if v_dow = any(v_days)
       and (((v_date - v_dow::int) - v_anchor) / 7) % v_series.interval_weeks = 0 then

      -- (date + time) ra timestamp không múi giờ; at time zone gán nó là giờ
      -- Việt Nam rồi đổi sang timestamptz. Không dùng now() hay Date của tiến
      -- trình app — tiến trình đó không đặt TZ (xem lib/notifications-emit.ts).
      v_start := (v_date + p_start_time) at time zone v_zone;
      v_end_date := case when p_end_time <= p_start_time then v_date + 1 else v_date end;
      v_end := (v_end_date + p_end_time) at time zone v_zone;

      if exists (
        select 1 from public.shifts s
        where s.assignee_id = p_assignee_id
          and tstzrange(s.start_at, s.end_at) && tstzrange(v_start, v_end)
      ) then
        v_skipped := v_skipped || jsonb_build_object('date', v_date, 'reason', 'Đã có ca trùng giờ');
      else
        begin
          insert into public.shifts (
            assignee_id, branch_id, start_at, end_at, shift_type, note, created_by, series_id
          ) values (
            p_assignee_id, p_branch_id, v_start, v_end, p_shift_type,
            nullif(p_note, ''), v_uid, v_series.id
          );
          v_created := v_created + 1;
        exception when others then
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'reason', SQLERRM);
        end;
      end if;
    end if;
    v_date := v_date + 1;
  end loop;

  return jsonb_build_object(
    'series_id', v_series.id,
    'created', v_created,
    'skipped', v_skipped
  );
end;
$$;

grant execute on function public.create_shift_series(
  uuid, uuid, public.shift_type, smallint[], smallint, time, time, date, date, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. delete_shift_series_occurrences() — xoá theo phạm vi.
-- ---------------------------------------------------------------------------
-- p_scope: 'all' = mọi ca thuộc series, 'range' = các ca trong khoảng ngày.
-- Phạm vi "chỉ ca này" vẫn đi qua deleteShiftAction sẵn có, không cần RPC.
--
-- CA ĐÃ CÓ CHẤM CÔNG KHÔNG BAO GIỜ BỊ XOÁ, ở mọi phạm vi.
-- attendance.shift_id là ON DELETE SET NULL, nên xoá một ca như vậy sẽ để lại
-- một lần chấm công mồ côi: nó không biến mất khỏi bảng công, nó chỉ mất chỗ
-- neo và lặng lẽ làm sai số giờ. Hàm này giữ lại và đếm riêng để quản lý tự
-- quyết định.
create or replace function public.delete_shift_series_occurrences(
  p_series_id uuid,
  p_scope     text,
  p_from      date default null,
  p_to        date default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_zone           constant text := 'Asia/Ho_Chi_Minh';
  v_uid            uuid := auth.uid();
  v_series         public.shift_series%rowtype;
  v_deleted        int := 0;
  v_kept           int := 0;
  v_series_removed boolean := false;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if p_scope not in ('all', 'range') then
    raise exception 'Phạm vi xoá không hợp lệ' using errcode = '23514';
  end if;

  select * into v_series from public.shift_series where id = p_series_id;
  if not found then
    raise exception 'Không tìm thấy ca cố định này' using errcode = '23514';
  end if;
  if not public.can_manage_shift_for(v_series.assignee_id) then
    raise exception 'Bạn không có quyền xoá ca của nhân viên này';
  end if;
  if p_scope = 'range' and (p_from is null or p_to is null) then
    raise exception 'Vui lòng chọn khoảng ngày' using errcode = '23514';
  end if;
  if p_scope = 'range' and p_to < p_from then
    raise exception 'Ngày kết thúc phải sau ngày bắt đầu' using errcode = '23514';
  end if;

  -- Đối chiếu theo NGÀY ĐỊA PHƯƠNG của giờ bắt đầu, không phải theo UTC: một ca
  -- 23:00 giờ Việt Nam nằm ở ngày hôm trước theo UTC và sẽ rơi ra ngoài khoảng
  -- người dùng chọn nếu so sánh thô.
  with target as (
    select s.id, exists (select 1 from public.attendance a where a.shift_id = s.id) as has_attendance
    from public.shifts s
    where s.series_id = p_series_id
      and (
        p_scope = 'all'
        or (s.start_at at time zone v_zone)::date between p_from and p_to
      )
  ), removed as (
    delete from public.shifts
    where id in (select id from target where not has_attendance)
    returning 1
  )
  select
    (select count(*) from removed),
    (select count(*) from target where has_attendance)
  into v_deleted, v_kept;

  -- Xoá luôn cái luật khi đã dọn sạch mọi lần lặp của nó — để lại một series
  -- rỗng chỉ làm rác danh sách. Còn ca nào được giữ (vì đã chấm công) thì giữ
  -- luật lại, để quản lý vẫn thấy chúng thuộc về đâu.
  if p_scope = 'all' and v_kept = 0 then
    delete from public.shift_series where id = p_series_id;
    v_series_removed := true;
  end if;

  return jsonb_build_object(
    'assignee_id', v_series.assignee_id,
    'deleted', v_deleted,
    'kept', v_kept,
    'series_removed', v_series_removed
  );
end;
$$;

grant execute on function public.delete_shift_series_occurrences(uuid, text, date, date) to authenticated;
