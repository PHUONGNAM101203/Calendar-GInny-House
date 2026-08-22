-- Check-out giải trình công. Additive: every existing check-in column, RPC
-- and policy keeps its current behaviour — request_attendance_correction
-- (0042) is deliberately NOT touched. What is new is that the requested time
-- is supplied by the user instead of being forced to the shift boundary,
-- because a staff member who clocked out at 19:40 may legitimately need the
-- record to read 19:20.

alter table public.attendance_corrections
  add column if not exists actual_check_out_at timestamptz,
  add column if not exists requested_check_out_at timestamptz;

-- requested_check_in_at was NOT NULL back when every correction was a
-- check-in correction. Check-out rows legitimately have no requested
-- check-in, so the NOT NULL moves into the kind-aware CHECK below.
alter table public.attendance_corrections
  alter column requested_check_in_at drop not null;

-- Generated, not stored-by-hand, so it can never drift from issue_type.
alter table public.attendance_corrections
  add column if not exists kind text
  generated always as (
    case
      when issue_type in ('missed_check_out', 'adjust_check_out') then 'check_out'
      else 'check_in'
    end
  ) stored;

-- Written against issue_type, NOT against the generated kind column:
-- PostgreSQL forbids a CHECK constraint from referencing a generated column
-- on the same table.
alter table public.attendance_corrections
  drop constraint if exists attendance_corrections_time_by_issue;
alter table public.attendance_corrections
  add constraint attendance_corrections_time_by_issue check (
    case
      when issue_type in ('missed_check_out', 'adjust_check_out')
        then requested_check_out_at is not null
      else requested_check_in_at is not null
    end
  );

-- Was unique on shift_id alone, which would have made a pending check-in
-- correction block filing a check-out correction for the same shift. One
-- pending correction per shift PER KIND is the correct rule.
drop index if exists attendance_corrections_one_pending_per_shift;
create unique index if not exists attendance_corrections_one_pending_per_shift_kind
  on public.attendance_corrections (shift_id, kind) where status = 'pending';

-- Check-out counterpart of request_attendance_correction (0042). Separate
-- function rather than an overload: the check-in flow derives its requested
-- time server-side, this one accepts it from the user, so they share a table
-- but not a signature.
create or replace function public.request_attendance_correction_checkout(
  p_shift_id uuid,
  p_requested_check_out_at timestamptz,
  p_reason text
) returns public.attendance_corrections
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_shift_date date;
  v_attendance public.attendance%rowtype;
  v_issue public.attendance_correction_issue;
  v_row public.attendance_corrections%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'Vui lòng nhập lý do giải trình' using errcode = '23514';
  end if;
  if p_requested_check_out_at is null then
    raise exception 'Vui lòng chọn giờ ra ca' using errcode = '23514';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id;
  if v_shift is null or v_shift.assignee_id <> v_uid then
    raise exception 'Không tìm thấy ca làm việc này';
  end if;

  v_shift_date := (v_shift.start_at at time zone 'Asia/Ho_Chi_Minh')::date;
  if (now() at time zone 'Asia/Ho_Chi_Minh')::date - v_shift_date > 7 then
    raise exception 'Đã quá hạn 1 tuần để giải trình ca này';
  end if;

  select * into v_attendance from public.attendance
  where profile_id = v_uid
    and (check_in_at at time zone 'Asia/Ho_Chi_Minh')::date = v_shift_date
  order by check_in_at desc
  limit 1;

  -- A check-out correction closes an existing session; it cannot invent one.
  -- With no check-in there is nothing to close, so send them to the check-in
  -- flow instead of silently fabricating a session.
  if v_attendance is null then
    raise exception 'Ca này chưa có giờ vào — vui lòng giải trình giờ vào trước';
  end if;

  if p_requested_check_out_at <= v_attendance.check_in_at then
    raise exception 'Giờ ra phải sau giờ vào' using errcode = '23514';
  end if;
  if p_requested_check_out_at > now() then
    raise exception 'Giờ ra không được ở tương lai' using errcode = '23514';
  end if;
  if (p_requested_check_out_at at time zone 'Asia/Ho_Chi_Minh')::date <> v_shift_date then
    raise exception 'Giờ ra phải cùng ngày với ca làm việc' using errcode = '23514';
  end if;

  v_issue := case
    when v_attendance.check_out_at is null then 'missed_check_out'
    else 'adjust_check_out'
  end;

  insert into public.attendance_corrections
    (profile_id, shift_id, attendance_id, issue_type,
     actual_check_out_at, requested_check_out_at, reason)
  values
    (v_uid, p_shift_id, v_attendance.id, v_issue,
     v_attendance.check_out_at, p_requested_check_out_at, p_reason)
  returning * into v_row;

  return v_row;
exception
  when unique_violation then
    raise exception 'Ca này đã có đơn giải trình giờ ra đang chờ duyệt';
end;
$$;

grant execute on function public.request_attendance_correction_checkout(uuid, timestamptz, text) to authenticated;

-- 0059 + a check_out branch. The check-in branches are unchanged.
create or replace function public.respond_to_attendance_correction(p_id uuid, p_approve boolean)
returns public.attendance_corrections
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.attendance_corrections%rowtype;
  v_existing_attendance_id uuid;
  v_new_attendance_id uuid;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if not public.is_leave_approver() then
    raise exception 'Chỉ quản lý mới được duyệt đơn giải trình công';
  end if;

  select * into v_row from public.attendance_corrections where id = p_id;
  if v_row is null or not public.can_view_profile(v_row.profile_id) then
    raise exception 'Bạn không có quyền duyệt đơn của nhân viên này';
  end if;

  update public.attendance_corrections
  set status = (case when p_approve then 'approved' else 'rejected' end)::attendance_correction_status,
      responder_id = v_uid,
      resolved_at = now()
  where id = p_id and status = 'pending'
  returning * into v_row;

  if not found then
    raise exception 'Đơn giải trình công không hợp lệ hoặc đã được xử lý';
  end if;

  if p_approve then
    if v_row.kind = 'check_out' then
      update public.attendance
      set check_out_at = v_row.requested_check_out_at
      where id = v_row.attendance_id;
    elsif v_row.issue_type = 'missed_check_in' then
      select id into v_existing_attendance_id
      from public.attendance
      where profile_id = v_row.profile_id and shift_id = v_row.shift_id
      order by check_in_at desc
      limit 1;

      if v_existing_attendance_id is not null then
        update public.attendance
        set check_in_at = v_row.requested_check_in_at
        where id = v_existing_attendance_id;
        v_new_attendance_id := v_existing_attendance_id;
      else
        insert into public.attendance (profile_id, branch_id, shift_id, check_in_at)
        select v_row.profile_id, s.branch_id, s.id, v_row.requested_check_in_at
        from public.shifts s where s.id = v_row.shift_id
        returning id into v_new_attendance_id;
      end if;

      update public.attendance_corrections
      set attendance_id = v_new_attendance_id
      where id = p_id;
      v_row.attendance_id := v_new_attendance_id;
    else
      update public.attendance
      set check_in_at = v_row.requested_check_in_at
      where id = v_row.attendance_id;
    end if;
  end if;

  return v_row;
end;
$$;

-- 0058 + kind awareness. Two specific fixes:
--   1. The "another pending sibling" guard filtered on shift_id alone. Now
--      that one shift may legitimately hold both a pending check-in and a
--      pending check-out correction, that guard has to be kind-scoped or
--      reverting one would be wrongly blocked by the other.
--   2. The `check_out_at is not null` bail-out only makes sense for check-in
--      corrections. An approved check-out correction ALWAYS leaves a
--      check-out set, so applying that guard to it would refuse every revert.
create or replace function public.revert_attendance_correction(p_id uuid)
returns public.attendance_corrections
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.attendance_corrections%rowtype;
  v_att public.attendance%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if (select role from public.profiles where id = v_uid) <> 'technical' then
    raise exception 'Chỉ Kỹ thuật mới có thể khôi phục đơn';
  end if;

  select * into v_row from public.attendance_corrections where id = p_id for update;
  if not found or v_row.status = 'pending' then
    raise exception 'Đơn không hợp lệ hoặc đang chờ duyệt';
  end if;

  if exists (
    select 1 from public.attendance_corrections
    where shift_id = v_row.shift_id and kind = v_row.kind and id <> p_id and status = 'pending'
  ) then
    raise exception 'Ca này đã có đơn giải trình khác đang chờ duyệt — không thể khôi phục tự động' using errcode = '23514';
  end if;

  if v_row.status = 'approved' then
    if v_row.attendance_id is null then
      raise exception 'Đơn duyệt trước khi có tính năng khôi phục — không thể khôi phục tự động' using errcode = '23514';
    end if;

    select * into v_att from public.attendance where id = v_row.attendance_id;
    if not found then
      raise exception 'Không tìm thấy bản ghi chấm công liên quan — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if v_row.kind = 'check_in' and v_att.check_out_at is not null then
      raise exception 'Bản ghi chấm công đã có giờ ra — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.attendance_corrections
      where attendance_id = v_row.attendance_id and kind = v_row.kind and id <> p_id and status = 'approved'
    ) then
      raise exception 'Bản ghi chấm công đã bị sửa bởi đơn giải trình khác — không thể khôi phục tự động' using errcode = '23514';
    end if;

    if v_row.kind = 'check_out' then
      -- Restores the previous check-out, or reopens the session when the
      -- correction had supplied a missing one (actual_check_out_at is NULL).
      update public.attendance set check_out_at = v_row.actual_check_out_at where id = v_row.attendance_id;
    elsif v_row.issue_type = 'missed_check_in' then
      delete from public.attendance where id = v_row.attendance_id;
    else
      update public.attendance set check_in_at = v_row.actual_check_in_at where id = v_row.attendance_id;
    end if;
  end if;

  update public.attendance_corrections
  set status = 'pending', responder_id = null, resolved_at = null
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.revert_attendance_correction(uuid) to authenticated;
