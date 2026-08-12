-- Reverts the "nhiệm vụ trong ca" (duty_role) feature from 0052/0053.
-- Replaced by a simpler model (0056): a registered shift is now ALWAYS the
-- assignee's primary role, with no picker; a dual-role person's TA-side
-- work is instead recorded via a separate untied clock-in, not a per-shift
-- duty label.
--
-- Drops the columns entirely rather than just retiring the picker: nothing
-- reads or writes them once this migration lands, and their only rows in
-- production (2 shifts, 1 shift_request, checked before writing this
-- migration) carry no meaning under the new model regardless.

drop trigger if exists shifts_validate_duty_role on public.shifts;
drop trigger if exists shift_requests_validate_duty_role on public.shift_requests;
drop function if exists public.validate_shift_duty_role();
drop function if exists public.validate_shift_request_duty_role();

-- shift_requests_select/_delete_manager and shift_swap_requests_delete_manager
-- (see bottom of this file for their post-drop recreation) call the
-- duty-role overloads of can_approve_shift_request/can_approve_swap_request
-- in their USING clauses — Postgres won't drop a function a policy still
-- depends on, so the policies must go first.
drop policy if exists shift_requests_select on public.shift_requests;
drop policy if exists shift_requests_delete_manager on public.shift_requests;
drop policy if exists shift_swap_requests_delete_manager on public.shift_swap_requests;

-- can_approve_shift_request / can_approve_swap_request: drop the duty-role
-- overload before recreating the plain-role shape — CREATE OR REPLACE only
-- replaces a function with the exact same parameter list, so leaving the
-- duty-role signature undropped would leave both callable (same trap noted
-- in every duty_role migration this session).
drop function if exists public.can_approve_shift_request(uuid, public.staff_role);
drop function if exists public.can_approve_swap_request(uuid, uuid, public.staff_role, public.staff_role);

create or replace function public.can_approve_shift_request(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_ceo() then true
    else exists (
      select 1 from public.group_permissions gp
      where gp.manager_role = (select role from public.profiles where id = auth.uid())
        and gp.target_role = (select role from public.profiles where id = p_target_id)
        and gp.permission = 'approve_shift_request'
    )
  end;
$$;

grant execute on function public.can_approve_shift_request(uuid) to authenticated;

create or replace function public.can_approve_swap_request(p_requester_id uuid, p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_ceo() then true
    else
      exists (
        select 1 from public.group_permissions gp
        where gp.manager_role = (select role from public.profiles where id = auth.uid())
          and gp.target_role = (select role from public.profiles where id = p_requester_id)
          and gp.permission = 'approve_swap'
      )
      and exists (
        select 1 from public.group_permissions gp
        where gp.manager_role = (select role from public.profiles where id = auth.uid())
          and gp.target_role = (select role from public.profiles where id = p_target_id)
          and gp.permission = 'approve_swap'
      )
  end;
$$;

grant execute on function public.can_approve_swap_request(uuid, uuid) to authenticated;

create or replace function public.respond_to_shift_request(p_id uuid, p_approve boolean)
returns public.shift_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.shift_requests%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  select * into v_req from public.shift_requests where id = p_id for update;
  if not found or v_req.status <> 'pending' then
    raise exception 'Đơn đăng ký không còn hiệu lực';
  end if;

  if not public.can_approve_shift_request(v_req.profile_id) then
    raise exception 'Bạn không có quyền duyệt đăng ký ca này';
  end if;

  if p_approve then
    insert into public.shifts (assignee_id, start_at, end_at, note, created_by, shift_type, branch_id)
    values (v_req.profile_id, v_req.start_at, v_req.end_at, v_req.note, v_uid, v_req.shift_type, v_req.branch_id);
  end if;

  update public.shift_requests
  set status = (case when p_approve then 'approved' else 'rejected' end)::public.shift_request_status,
      responder_id = v_uid,
      resolved_at = now()
  where id = p_id
  returning * into v_req;

  return v_req;
end;
$$;

grant execute on function public.respond_to_shift_request(uuid, boolean) to authenticated;

create or replace function public.respond_to_swap_request(
  p_request_id uuid,
  p_accept boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.shift_swap_requests%rowtype;
  v_taker uuid;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  select * into v_req from public.shift_swap_requests where id = p_request_id for update;
  if not found or v_req.status <> 'pending' then
    raise exception 'Yêu cầu không còn hiệu lực';
  end if;

  if not public.is_manager()
     and not public.is_branch_member(v_uid, v_req.branch_id)
     and not (v_req.target_id is not null and public.can_approve_swap_request(v_req.requester_id, v_req.target_id)) then
    raise exception 'Yêu cầu không thuộc cơ sở của bạn';
  end if;

  if v_req.target_id is not null then
    if v_uid <> v_req.target_id and not public.can_approve_swap_request(v_req.requester_id, v_req.target_id) then
      raise exception 'Bạn không phải người được yêu cầu';
    end if;
  else
    if v_uid = v_req.requester_id then raise exception 'Không thể tự nhận ca của mình'; end if;
  end if;

  if not p_accept then
    update public.shift_swap_requests
       set status = 'rejected', responder_id = v_uid, resolved_at = now()
     where id = p_request_id;
    return;
  end if;

  if v_req.target_id is not null then
    v_taker := v_req.target_id;
  else
    v_taker := v_uid;
  end if;

  if not exists (select 1 from public.shifts
                 where id = v_req.requester_shift_id and assignee_id = v_req.requester_id) then
    raise exception 'Ca gốc đã thay đổi, yêu cầu không còn hợp lệ';
  end if;

  if v_req.target_shift_id is not null then
    if not exists (select 1 from public.shifts
                   where id = v_req.target_shift_id and assignee_id = v_taker) then
      raise exception 'Ca đối ứng đã thay đổi, yêu cầu không còn hợp lệ';
    end if;
    update public.shifts set assignee_id = v_taker where id = v_req.requester_shift_id;
    update public.shifts set assignee_id = v_req.requester_id where id = v_req.target_shift_id;
  else
    update public.shifts set assignee_id = v_taker where id = v_req.requester_shift_id;
  end if;

  update public.shift_swap_requests
     set status = 'accepted', responder_id = v_uid, resolved_at = now()
   where id = p_request_id;

  update public.shift_swap_requests
     set status = 'cancelled', resolved_at = now()
   where status = 'pending'
     and id <> p_request_id
     and (requester_shift_id in (v_req.requester_shift_id, v_req.target_shift_id)
       or target_shift_id in (v_req.requester_shift_id, v_req.target_shift_id));
end;
$$;

grant execute on function public.respond_to_swap_request(uuid, boolean) to authenticated;

-- student_affairs_slot_taken / enforce_student_affairs_single_slot / request_shift:
-- keep 0053's "same start time only" rule and its self-exclusion fix, drop
-- only the duty_role reads — a shift is always the assignee's own role now.
create or replace function public.student_affairs_slot_taken(
  p_branch_id uuid,
  p_start_at timestamptz,
  p_exclude_shift_id uuid default null,
  p_exclude_request_id uuid default null,
  p_exclude_profile_id uuid default null
) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.shifts s
    join public.profiles p on p.id = s.assignee_id
    where p.role = 'student_affairs'
      and s.branch_id = p_branch_id
      and s.start_at = p_start_at
      and (p_exclude_shift_id is null or s.id <> p_exclude_shift_id)
      and (p_exclude_profile_id is null or s.assignee_id <> p_exclude_profile_id)
  ) or exists (
    select 1 from public.shift_requests r
    join public.profiles p on p.id = r.profile_id
    where p.role = 'student_affairs'
      and r.status = 'pending'
      and r.branch_id = p_branch_id
      and r.start_at = p_start_at
      and (p_exclude_request_id is null or r.id <> p_exclude_request_id)
      and (p_exclude_profile_id is null or r.profile_id <> p_exclude_profile_id)
  );
$$;

grant execute on function public.student_affairs_slot_taken(uuid, timestamptz, uuid, uuid, uuid) to authenticated;

create or replace function public.enforce_student_affairs_single_slot()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.staff_role;
begin
  select role into v_role from public.profiles where id = new.assignee_id;
  if v_role = 'student_affairs' and public.student_affairs_slot_taken(
    new.branch_id, new.start_at, new.id, null, new.assignee_id
  ) then
    raise exception 'Đã có quản sinh khác trực ca bắt đầu cùng giờ này' using errcode = '23505';
  end if;
  return new;
end;
$$;

drop function if exists public.request_shift(timestamptz, timestamptz, uuid, text, public.shift_type, public.staff_role);

create or replace function public.request_shift(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_branch_id uuid,
  p_note text default null,
  p_shift_type public.shift_type default 'morning'
) returns public.shift_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role public.staff_role;
  v_row public.shift_requests%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if p_end_at <= p_start_at then
    raise exception 'Giờ kết thúc phải sau giờ bắt đầu' using errcode = '23514';
  end if;
  if p_branch_id is null then
    raise exception 'Vui lòng chọn cơ sở' using errcode = '23514';
  end if;
  if not public.is_manager() and not public.is_branch_member(v_uid, p_branch_id) then
    raise exception 'Bạn không thuộc cơ sở này' using errcode = '23514';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role = 'student_affairs' and public.student_affairs_slot_taken(
    p_branch_id, p_start_at, null, null, v_uid
  ) then
    raise exception 'Đã có quản sinh khác trực ca bắt đầu cùng giờ này' using errcode = '23505';
  end if;

  insert into public.shift_requests (profile_id, branch_id, start_at, end_at, note, shift_type)
  values (v_uid, p_branch_id, p_start_at, p_end_at, nullif(p_note, ''), p_shift_type)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.request_shift(timestamptz, timestamptz, uuid, text, public.shift_type) to authenticated;

-- respond_to_attendance_correction: back to the shared can_view_profile()
-- gate — a correction's shift no longer has a duty_role to read, so there
-- is nothing left to override it with.
create or replace function public.respond_to_attendance_correction(p_id uuid, p_approve boolean)
returns public.attendance_corrections
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.attendance_corrections%rowtype;
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
    if v_row.issue_type = 'missed_check_in' then
      insert into public.attendance (profile_id, branch_id, shift_id, check_in_at)
      select v_row.profile_id, s.branch_id, s.id, v_row.requested_check_in_at
      from public.shifts s where s.id = v_row.shift_id;
    else
      update public.attendance
      set check_in_at = v_row.requested_check_in_at
      where id = v_row.attendance_id;
    end if;
  end if;

  return v_row;
end;
$$;

grant execute on function public.respond_to_attendance_correction(uuid, boolean) to authenticated;

-- shift_requests / shift_swap_requests RLS: recreate against the plain-role
-- functions now that duty_role is gone (dropped above, before the function
-- drops that needed them out of the way first).
create policy shift_requests_select on public.shift_requests
  for select to authenticated
  using (
    profile_id = auth.uid()
    or public.can_approve_shift_request(profile_id)
  );

create policy shift_requests_delete_manager on public.shift_requests
  for delete to authenticated
  using (status = 'pending' and public.can_approve_shift_request(profile_id));

create policy shift_swap_requests_delete_manager on public.shift_swap_requests
  for delete to authenticated
  using (
    status = 'pending'
    and target_id is not null
    and public.can_approve_swap_request(requester_id, target_id)
  );

alter table public.shifts drop column if exists duty_role;
alter table public.shift_requests drop column if exists duty_role;
