-- Shift duty role: which of their 2 roles a dual-role staff member (see
-- 0051_staff_secondary_role.sql) is covering for a SPECIFIC shift/request —
-- vs. secondary_role, which is a person-level label with no effect on
-- approval routing. This column DOES drive approval routing for the 3
-- request types tied to an actual shift (đăng ký ca, đổi ca, giải trình
-- công); leave_requests has no shift reference and is untouched.
alter table public.shifts add column if not exists duty_role public.staff_role;
alter table public.shift_requests add column if not exists duty_role public.staff_role;

-- Self-healing always; the hard "must pick one" requirement only applies
-- on INSERT. respond_to_swap_request() reassigns shifts via a bare UPDATE
-- with no UI moment to ask the incoming (possibly dual-role) owner which
-- duty applies — blocking that UPDATE would break swaps outright for any
-- dual-role participant. INSERT is the only path a real person creates a
-- shift through (ShiftFormDialog / respond_to_shift_request), and both
-- already collect duty_role before reaching Postgres — this trigger is the
-- real boundary for THAT path, same spirit as protect_profile_privileges()
-- (0001/0040), which also only guards against invalid states rather than
-- blocking every UPDATE unconditionally.
create or replace function public.validate_shift_duty_role()
returns trigger language plpgsql as $$
declare
  v_role public.staff_role;
  v_secondary public.staff_role;
begin
  select role, secondary_role into v_role, v_secondary
  from public.profiles where id = new.assignee_id;

  if new.duty_role is not null and new.duty_role not in (v_role, v_secondary) then
    new.duty_role := null;
  end if;

  if TG_OP = 'INSERT' and v_secondary is not null and new.duty_role is null then
    raise exception 'Vui lòng chọn nhiệm vụ trong ca cho nhân viên kiêm nhiệm này';
  end if;

  return new;
end;
$$;

drop trigger if exists shifts_validate_duty_role on public.shifts;
create trigger shifts_validate_duty_role
  before insert or update on public.shifts
  for each row execute function public.validate_shift_duty_role();

-- Same logic, but keyed off shift_requests.profile_id (the requester) —
-- separate function because the column name differs (profile_id vs.
-- assignee_id) and a shared one would need dynamic SQL for no real benefit.
create or replace function public.validate_shift_request_duty_role()
returns trigger language plpgsql as $$
declare
  v_role public.staff_role;
  v_secondary public.staff_role;
begin
  select role, secondary_role into v_role, v_secondary
  from public.profiles where id = new.profile_id;

  if new.duty_role is not null and new.duty_role not in (v_role, v_secondary) then
    new.duty_role := null;
  end if;

  if TG_OP = 'INSERT' and v_secondary is not null and new.duty_role is null then
    raise exception 'Vui lòng chọn nhiệm vụ trong ca cho nhân viên kiêm nhiệm này';
  end if;

  return new;
end;
$$;

drop trigger if exists shift_requests_validate_duty_role on public.shift_requests;
create trigger shift_requests_validate_duty_role
  before insert or update on public.shift_requests
  for each row execute function public.validate_shift_request_duty_role();

-- can_approve_shift_request/can_approve_swap_request: add a trailing,
-- defaulted duty-role override param each. Every existing caller that
-- doesn't pass it keeps resolving to the target's plain profiles.role,
-- identical to today's behavior — this is purely additive.
create or replace function public.can_approve_shift_request(
  p_target_id uuid,
  p_duty_role public.staff_role default null
)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_ceo() then true
    else exists (
      select 1 from public.group_permissions gp
      where gp.manager_role = (select role from public.profiles where id = auth.uid())
        and gp.target_role = coalesce(p_duty_role, (select role from public.profiles where id = p_target_id))
        and gp.permission = 'approve_shift_request'
    )
  end;
$$;

grant execute on function public.can_approve_shift_request(uuid, public.staff_role) to authenticated;

create or replace function public.can_approve_swap_request(
  p_requester_id uuid,
  p_target_id uuid,
  p_requester_duty_role public.staff_role default null,
  p_target_duty_role public.staff_role default null
)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_ceo() then true
    else
      exists (
        select 1 from public.group_permissions gp
        where gp.manager_role = (select role from public.profiles where id = auth.uid())
          and gp.target_role = coalesce(p_requester_duty_role, (select role from public.profiles where id = p_requester_id))
          and gp.permission = 'approve_swap'
      )
      and exists (
        select 1 from public.group_permissions gp
        where gp.manager_role = (select role from public.profiles where id = auth.uid())
          and gp.target_role = coalesce(p_target_duty_role, (select role from public.profiles where id = p_target_id))
          and gp.permission = 'approve_swap'
      )
  end;
$$;

grant execute on function public.can_approve_swap_request(uuid, uuid, public.staff_role, public.staff_role) to authenticated;

-- respond_to_shift_request(): pass the request's own duty_role into the
-- approval check, and copy it forward onto the shift created on approval —
-- otherwise a shift born from an approved dual-role request would silently
-- lose its duty_role and any later swap/correction on it would fall back
-- to the requester's primary role.
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

  if not public.can_approve_shift_request(v_req.profile_id, v_req.duty_role) then
    raise exception 'Bạn không có quyền duyệt đăng ký ca này';
  end if;

  if p_approve then
    insert into public.shifts (assignee_id, start_at, end_at, note, created_by, shift_type, branch_id, duty_role)
    values (v_req.profile_id, v_req.start_at, v_req.end_at, v_req.note, v_uid, v_req.shift_type, v_req.branch_id, v_req.duty_role);
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

-- respond_to_swap_request(): look up each side's shift duty_role (via
-- requester_shift_id/target_shift_id) and pass both into
-- can_approve_swap_request — body otherwise identical to 0044's version.
create or replace function public.respond_to_swap_request(
  p_request_id uuid,
  p_accept boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.shift_swap_requests%rowtype;
  v_taker uuid;
  v_requester_duty public.staff_role;
  v_target_duty public.staff_role;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  select * into v_req from public.shift_swap_requests where id = p_request_id for update;
  if not found or v_req.status <> 'pending' then
    raise exception 'Yêu cầu không còn hiệu lực';
  end if;

  select duty_role into v_requester_duty from public.shifts where id = v_req.requester_shift_id;
  if v_req.target_shift_id is not null then
    select duty_role into v_target_duty from public.shifts where id = v_req.target_shift_id;
  end if;

  if not public.is_manager()
     and not public.is_branch_member(v_uid, v_req.branch_id)
     and not (v_req.target_id is not null and public.can_approve_swap_request(v_req.requester_id, v_req.target_id, v_requester_duty, v_target_duty)) then
    raise exception 'Yêu cầu không thuộc cơ sở của bạn';
  end if;

  if v_req.target_id is not null then
    if v_uid <> v_req.target_id and not public.can_approve_swap_request(v_req.requester_id, v_req.target_id, v_requester_duty, v_target_duty) then
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

-- request_shift(): add a trailing, defaulted p_duty_role param and persist
-- it — otherwise a dual-role requester's INSERT always lands with
-- duty_role null, and validate_shift_request_duty_role() (above) rejects
-- it outright. Body is 0037_student_affairs_single_slot.sql's version
-- verbatim except the signature (+1 param) and the INSERT (+1 column/value).
create or replace function public.request_shift(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_branch_id uuid,
  p_note text default null,
  p_shift_type public.shift_type default 'morning',
  p_duty_role public.staff_role default null
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
    p_branch_id, p_start_at, p_end_at, null, null
  ) then
    raise exception 'Ca này đã có đăng ký quản sinh' using errcode = '23505';
  end if;

  insert into public.shift_requests (profile_id, branch_id, start_at, end_at, note, shift_type, duty_role)
  values (v_uid, p_branch_id, p_start_at, p_end_at, nullif(p_note, ''), p_shift_type, p_duty_role)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.request_shift(timestamptz, timestamptz, uuid, text, public.shift_type, public.staff_role) to authenticated;

-- respond_to_attendance_correction(): replace the can_view_profile() gate
-- (shared, primary-role-only, used by many other RLS policies — must NOT
-- change) with an inline duty-aware check scoped to this function alone.
-- Same 'approve_leave' permission literal as before (attendance-correction
-- approval has always shared the leave-approver group).
create or replace function public.respond_to_attendance_correction(p_id uuid, p_approve boolean)
returns public.attendance_corrections
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.attendance_corrections%rowtype;
  v_duty_role public.staff_role;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if not public.is_leave_approver() then
    raise exception 'Chỉ quản lý mới được duyệt đơn giải trình công';
  end if;

  select * into v_row from public.attendance_corrections where id = p_id;
  if v_row is null then
    raise exception 'Bạn không có quyền duyệt đơn của nhân viên này';
  end if;

  select duty_role into v_duty_role from public.shifts where id = v_row.shift_id;

  if not (
    (select role from public.profiles where id = auth.uid()) = 'ceo'
    or exists (
      select 1 from public.group_permissions gp
      where gp.manager_role = (select role from public.profiles where id = auth.uid())
        and gp.target_role = coalesce(v_duty_role, (select role from public.profiles where id = v_row.profile_id))
        and gp.permission = 'approve_leave'
    )
  ) then
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

-- shift_requests visibility RLS: duty_role lives on this same table, so it
-- can be read directly in the USING clause without a join.
drop policy if exists shift_requests_select on public.shift_requests;
create policy shift_requests_select on public.shift_requests
  for select to authenticated
  using (
    profile_id = auth.uid()
    or public.can_approve_shift_request(profile_id, duty_role)
  );

drop policy if exists shift_requests_delete_manager on public.shift_requests;
create policy shift_requests_delete_manager on public.shift_requests
  for delete to authenticated
  using (status = 'pending' and public.can_approve_shift_request(profile_id, duty_role));

drop policy if exists shift_swap_requests_delete_manager on public.shift_swap_requests;
create policy shift_swap_requests_delete_manager on public.shift_swap_requests
  for delete to authenticated
  using (
    status = 'pending'
    and target_id is not null
    and public.can_approve_swap_request(
      requester_id,
      target_id,
      (select duty_role from public.shifts where id = requester_shift_id),
      (select duty_role from public.shifts where id = target_shift_id)
    )
  );
