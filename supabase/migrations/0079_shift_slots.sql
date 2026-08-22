-- Ca cố định — Đợt 3: ô trống chưa có người (unassigned slots).
-- Xem docs/superpowers/specs/2026-08-22-recurring-shifts-design.md.
--
-- Quyết định của chủ nhân, chốt lại lần nữa khi mở Đợt 3:
--   • CHỈ quản lý gán người vào ô trống. Không có tự đăng ký.
--   • Nhân viên KHÔNG BAO GIỜ thấy ô trống. Họ chỉ thấy ca sau khi đã có
--     người — lúc đó nó là một dòng `shifts` bình thường và mọi luật hiển
--     thị/follow sẵn có áp dụng nguyên vẹn, không cần thêm gì.
--
-- Vì thế ô trống là một BẢNG RIÊNG chứ không phải `shifts` với assignee null:
-- assignee_id là cột chịu lực của shifts_no_overlap (GiST), của
-- can_manage_shift_for trong mọi policy, và của mọi chỗ đọc
-- shift.assignee.full_name trên giao diện. Cho nó null sẽ làm yếu ràng buộc
-- trùng ca (NULL không bao giờ xung đột) và bắt mọi nơi phải tự phòng null —
-- sót một chỗ là ra dữ liệu sai, không phải crash, tức là loại lỗi tệ nhất.

-- ---------------------------------------------------------------------------
-- 1. Ai được đụng vào ô trống
-- ---------------------------------------------------------------------------
-- Ô trống không có assignee, nên can_manage_shift_for() — vốn soi vai trò của
-- NGƯỜI ĐƯỢC XẾP — không dùng được ở đây. is_manager() cũng không: nó loại HR
-- (0005), trong khi HR vẫn được xếp ca qua group_permissions, nên dùng nó sẽ
-- khoá nhầm HR khỏi chính việc họ được phép làm.
--
-- Predicate này là "có được xếp ca cho BẤT KỲ ai không" — bản SQL của
-- canCreateShiftDirectly() + canCreateShiftFor() trong lib/roles.ts. Giữ hai
-- bên đồng bộ với nhau.
create or replace function public.can_manage_shift_slots()
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when (select role from public.profiles where id = auth.uid()) in ('ceo', 'technical') then true
    else exists (
      select 1 from public.group_permissions gp
      where gp.manager_role = (select role from public.profiles where id = auth.uid())
        and gp.permission = 'create_shift'
    )
  end;
$$;

grant execute on function public.can_manage_shift_slots() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Bảng shift_slots
-- ---------------------------------------------------------------------------
create table public.shift_slots (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references public.branches(id) on delete cascade,
  -- ON DELETE CASCADE ở đây, ngược hẳn với shifts.series_id (SET NULL).
  -- Một ô trống chưa có ai, chưa có chấm công, chưa là lịch của bất kỳ người
  -- nào — nó thuần tuý là một phần của cái luật. Xoá luật thì nó phải đi theo,
  -- còn để lại sẽ thành rác không ai biết thuộc về đâu.
  series_id  uuid references public.shift_series(id) on delete cascade,
  shift_type public.shift_type not null default 'morning',
  note       text,
  start_at   timestamptz not null,
  end_at     timestamptz not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint shift_slots_time_valid check (end_at > start_at)
);

create index shift_slots_branch_start_idx on public.shift_slots (branch_id, start_at);
create index shift_slots_series_idx on public.shift_slots (series_id);

alter table public.shift_slots enable row level security;

-- Không có policy nào cho nhân viên thường, ở bất kỳ động tác nào. Đây chính
-- là chỗ hiện thực hoá "nhân viên không thấy ô trống" — chặn ở tầng database
-- chứ không phải chỉ giấu trên giao diện.
create policy shift_slots_select_manager on public.shift_slots
  for select to authenticated using (public.can_manage_shift_slots());

create policy shift_slots_insert_manager on public.shift_slots
  for insert to authenticated with check (public.can_manage_shift_slots());

create policy shift_slots_update_manager on public.shift_slots
  for update to authenticated
  using (public.can_manage_shift_slots())
  with check (public.can_manage_shift_slots());

create policy shift_slots_delete_manager on public.shift_slots
  for delete to authenticated using (public.can_manage_shift_slots());

-- ---------------------------------------------------------------------------
-- 3. shift_series.assignee_id được phép để trống
-- ---------------------------------------------------------------------------
alter table public.shift_series alter column assignee_id drop not null;

-- BẮT BUỘC phải viết lại cả 4 policy của 0078. Chúng gọi
-- can_manage_shift_for(assignee_id); với assignee_id null thì hàm đó đọc vai
-- trò của một người không tồn tại, trả về NULL/false, nên chính người vừa tạo
-- ra luật cũng không đọc lại được nó.
drop policy if exists shift_series_select on public.shift_series;
create policy shift_series_select on public.shift_series
  for select to authenticated
  using (
    case
      when assignee_id is null then public.can_manage_shift_slots()
      else assignee_id = auth.uid() or public.can_manage_shift_for(assignee_id)
    end
  );

drop policy if exists shift_series_insert_manager on public.shift_series;
create policy shift_series_insert_manager on public.shift_series
  for insert to authenticated
  with check (
    case
      when assignee_id is null then public.can_manage_shift_slots()
      else public.can_manage_shift_for(assignee_id)
    end
  );

drop policy if exists shift_series_update_manager on public.shift_series;
create policy shift_series_update_manager on public.shift_series
  for update to authenticated
  using (
    case
      when assignee_id is null then public.can_manage_shift_slots()
      else public.can_manage_shift_for(assignee_id)
    end
  )
  with check (
    case
      when assignee_id is null then public.can_manage_shift_slots()
      else public.can_manage_shift_for(assignee_id)
    end
  );

drop policy if exists shift_series_delete_manager on public.shift_series;
create policy shift_series_delete_manager on public.shift_series
  for delete to authenticated
  using (
    case
      when assignee_id is null then public.can_manage_shift_slots()
      else public.can_manage_shift_for(assignee_id)
    end
  );

-- ---------------------------------------------------------------------------
-- 4. create_shift_series() — nhận assignee null, sinh ra ô trống
-- ---------------------------------------------------------------------------
-- Giữ nguyên toàn bộ luật tính ngày của 0078; chỉ rẽ nhánh ở chỗ ghi xuống
-- đâu. Nhánh có người: y hệt cũ, kèm dò trùng và các trigger. Nhánh ô trống:
-- không dò trùng gì cả — hai bản kế hoạch chồng giờ nhau là chuyện bình
-- thường, và chưa có ai để mà trùng ca với.
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
  if p_ends_on is null then
    raise exception 'Vui lòng chọn ngày kết thúc' using errcode = '23514';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'Ngày kết thúc phải sau ngày bắt đầu' using errcode = '23514';
  end if;
  if p_ends_on - p_starts_on > 366 then
    raise exception 'Ca cố định chỉ được lặp tối đa 1 năm' using errcode = '23514';
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

  v_anchor := p_starts_on - extract(dow from p_starts_on)::int;

  v_date := p_starts_on;
  while v_date <= p_ends_on loop
    v_dow := extract(dow from v_date)::smallint;
    if v_dow = any(v_days)
       and (((v_date - v_dow::int) - v_anchor) / 7) % v_series.interval_weeks = 0 then

      v_start := (v_date + p_start_time) at time zone v_zone;
      v_end_date := case when p_end_time <= p_start_time then v_date + 1 else v_date end;
      v_end := (v_end_date + p_end_time) at time zone v_zone;

      if p_assignee_id is null then
        insert into public.shift_slots (
          branch_id, series_id, shift_type, note, start_at, end_at, created_by
        ) values (
          p_branch_id, v_series.id, p_shift_type, nullif(p_note, ''), v_start, v_end, v_uid
        );
        v_created := v_created + 1;
      elsif exists (
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
    'skipped', v_skipped,
    -- Cho tầng app biết vừa sinh ra ô trống hay ca thật, để chọn đúng câu
    -- thông báo và để KHÔNG bắn notification cho ai — ô trống chưa có chủ.
    'unassigned', p_assignee_id is null
  );
end;
$$;

grant execute on function public.create_shift_series(
  uuid, uuid, public.shift_type, smallint[], smallint, time, time, date, date, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. assign_shift_slot() — ô trống thành ca thật
-- ---------------------------------------------------------------------------
-- Đây là chỗ duy nhất một ô trống biến thành lịch của một con người, nên nó
-- phải đi qua đúng những cổng mà một ca tạo tay phải đi qua: quyền xếp ca cho
-- người đó, dò trùng giờ, và các trigger trên `shifts` (trùng suất quản sinh).
-- Dò trùng phải làm THỦ CÔNG vì shifts_no_overlap là DEFERRABLE — nó chỉ nổ
-- lúc COMMIT nên không thể bắt và dịch thành câu tiếng Việt tại đây.
create or replace function public.assign_shift_slot(
  p_slot_id     uuid,
  p_assignee_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
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
    assignee_id, branch_id, start_at, end_at, shift_type, note, created_by, series_id
  ) values (
    p_assignee_id, v_slot.branch_id, v_slot.start_at, v_slot.end_at,
    v_slot.shift_type, v_slot.note, v_uid, v_slot.series_id
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

grant execute on function public.assign_shift_slot(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. delete_shift_slot() — bỏ một ô trống
-- ---------------------------------------------------------------------------
-- Không cần đếm chấm công như khi xoá ca: một ô trống chưa có ai, nên không
-- thể có chấm công gắn vào. Vẫn đếm số dòng để phân biệt "đã xoá" với "RLS từ
-- chối", đúng bài học của deleteShiftAction.
create or replace function public.delete_shift_slot(p_slot_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_deleted int;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập'; end if;
  if not public.can_manage_shift_slots() then
    raise exception 'Bạn không có quyền xoá ô ca này';
  end if;
  delete from public.shift_slots where id = p_slot_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

grant execute on function public.delete_shift_slot(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. delete_shift_series_occurrences() — dọn cả ô trống
-- ---------------------------------------------------------------------------
-- Bản 0078 chỉ biết tới `shifts`. Sau Đợt 3 một series có thể còn ô trống
-- chưa gán, và "Xoá tất cả ca thuộc ca cố định này" mà để lại chúng thì mục
-- ô trống vẫn còn nguyên một loạt dòng của cái luật vừa bị xoá.
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
  v_slots_deleted  int := 0;
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
  if v_series.assignee_id is null then
    if not public.can_manage_shift_slots() then
      raise exception 'Bạn không có quyền xoá ca cố định này';
    end if;
  elsif not public.can_manage_shift_for(v_series.assignee_id) then
    raise exception 'Bạn không có quyền xoá ca của nhân viên này';
  end if;
  if p_scope = 'range' and (p_from is null or p_to is null) then
    raise exception 'Vui lòng chọn khoảng ngày' using errcode = '23514';
  end if;
  if p_scope = 'range' and p_to < p_from then
    raise exception 'Ngày kết thúc phải sau ngày bắt đầu' using errcode = '23514';
  end if;

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

  with removed_slots as (
    delete from public.shift_slots
    where series_id = p_series_id
      and (
        p_scope = 'all'
        or (start_at at time zone v_zone)::date between p_from and p_to
      )
    returning 1
  )
  select count(*) into v_slots_deleted from removed_slots;

  if p_scope = 'all' and v_kept = 0 then
    delete from public.shift_series where id = p_series_id;
    v_series_removed := true;
  end if;

  return jsonb_build_object(
    'assignee_id', v_series.assignee_id,
    'deleted', v_deleted,
    'kept', v_kept,
    'slots_deleted', v_slots_deleted,
    'series_removed', v_series_removed
  );
end;
$$;

grant execute on function public.delete_shift_series_occurrences(uuid, text, date, date) to authenticated;
