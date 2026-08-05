-- Splits the flat "is_manager() sees everything" bypass into group-scoped
-- visibility for the calendar/follow feature and leave approval:
--   ceo, technical      -> see/approve everyone
--   coo                 -> operations group only (hr, customer_care, operations_staff)
--   training_director   -> training group only (teacher, collaborator)
--   everyone else       -> unchanged (own branch only)
-- Mirrors lib/roles.ts getCalendarScope()/canApproveLeaveFor() — keep in sync.

create or replace function public.can_view_profile(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() = p_target_id then true
    when (select role from public.profiles where id = auth.uid()) in ('ceo', 'technical') then true
    when (select role from public.profiles where id = auth.uid()) = 'coo' then
      (select role from public.profiles where id = p_target_id) in ('hr', 'customer_care', 'operations_staff')
    when (select role from public.profiles where id = auth.uid()) = 'training_director' then
      (select role from public.profiles where id = p_target_id) in ('teacher', 'collaborator')
    else false
  end;
$$;

grant execute on function public.can_view_profile(uuid) to authenticated;

create or replace function public.is_leave_approver()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role in ('ceo', 'coo', 'training_director') from public.profiles where id = auth.uid()),
    false
  );
$$;

grant execute on function public.is_leave_approver() to authenticated;

-- ============================================================
-- shifts / attendance / leave_requests: is_manager() bypass -> scoped
-- ============================================================
drop policy if exists shifts_select_branch on public.shifts;
create policy shifts_select_branch on public.shifts
  for select to authenticated
  using (branch_id = public.current_branch_id() or public.can_view_profile(assignee_id));

drop policy if exists attendance_select_branch on public.attendance;
create policy attendance_select_branch on public.attendance
  for select to authenticated
  using (branch_id = public.current_branch_id() or public.can_view_profile(profile_id));

drop policy if exists leave_select_own_or_manager on public.leave_requests;
create policy leave_select_own_or_manager on public.leave_requests
  for select to authenticated
  using (profile_id = auth.uid() or public.can_view_profile(profile_id));

-- ============================================================
-- leave approval — was is_manager() (any of the 4), now group-scoped
-- ============================================================
create or replace function public.respond_to_leave_request(p_id uuid, p_approve boolean)
returns public.leave_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_target_role public.staff_role;
  v_row public.leave_requests%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if not public.is_leave_approver() then
    raise exception 'Chỉ quản lý mới được duyệt đơn nghỉ phép';
  end if;

  select p.role into v_target_role
  from public.leave_requests r join public.profiles p on p.id = r.profile_id
  where r.id = p_id;

  if v_target_role is null or not public.can_view_profile((select profile_id from public.leave_requests where id = p_id)) then
    raise exception 'Bạn không có quyền duyệt đơn của nhân viên này';
  end if;

  update public.leave_requests
  set status = (case when p_approve then 'approved' else 'rejected' end)::public.leave_status,
      responder_id = v_uid,
      resolved_at = now()
  where id = p_id
    and status = 'pending'
  returning * into v_row;

  if not found then
    raise exception 'Đơn nghỉ phép không hợp lệ hoặc đã được xử lý';
  end if;

  return v_row;
end;
$$;

-- ============================================================
-- calendar_follows: personal color override, viewer-specific (not a
-- global profiles.color change) — matches how Google Calendar lets each
-- viewer pick their own color for someone else's shared calendar.
-- ============================================================
alter table public.calendar_follows add column if not exists color text;
alter table public.calendar_follows drop constraint if exists calendar_follows_color_valid;
alter table public.calendar_follows add constraint calendar_follows_color_valid
  check (color is null or color in ('--chart-3', '--chart-4', '--chart-5', '--chart-6', '--gold', '--success'));
