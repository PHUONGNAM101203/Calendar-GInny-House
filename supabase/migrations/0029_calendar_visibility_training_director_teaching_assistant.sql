-- Lets training_director follow teaching_assistant's calendar (shifts,
-- attendance, leave, swaps, profile) without granting any approval rights
-- over them — HR remains the sole approver for teaching_assistant's leave
-- and shift requests.
--
-- can_view_profile() is not just a visibility filter: it's the literal
-- authorization check embedded inside respond_to_leave_request() and
-- respond_to_attendance_correction(). Widening it directly would silently
-- grant training_director approval rights over teaching_assistant, which
-- is not wanted. So this adds a separate, additive-superset function used
-- ONLY by the 5 SELECT policies below — the approval RPCs keep calling the
-- original can_view_profile(), untouched.
--
-- can_view_profile_calendar() is identical to can_view_profile() for every
-- role except training_director, who gains exactly one more visible role
-- (teaching_assistant) — a pure addition, so swapping it into these SELECT
-- policies cannot regress any existing visibility for any other role.
create or replace function public.can_view_profile_calendar(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() = p_target_id then true
    when (select role from public.profiles where id = auth.uid()) in ('ceo', 'technical') then true
    when (select role from public.profiles where id = auth.uid()) = 'coo' then
      (select role from public.profiles where id = p_target_id) in ('hr', 'customer_care', 'operations_staff')
    when (select role from public.profiles where id = auth.uid()) = 'training_director' then
      (select role from public.profiles where id = p_target_id) in ('teacher', 'collaborator', 'teaching_assistant')
    when (select role from public.profiles where id = auth.uid()) = 'hr' then
      (select role from public.profiles where id = p_target_id) in ('student_affairs', 'teaching_assistant')
    else false
  end;
$$;

grant execute on function public.can_view_profile_calendar(uuid) to authenticated;

drop policy if exists profiles_select_branch on public.profiles;
create policy profiles_select_branch on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or branch_id = public.current_branch_id()
    or public.can_view_profile_calendar(id)
    or public.is_visible_via_roster(id)
  );

drop policy if exists shifts_select_branch on public.shifts;
create policy shifts_select_branch on public.shifts
  for select to authenticated
  using (branch_id = public.current_branch_id() or public.can_view_profile_calendar(assignee_id));

drop policy if exists attendance_select_branch on public.attendance;
create policy attendance_select_branch on public.attendance
  for select to authenticated
  using (branch_id = public.current_branch_id() or public.can_view_profile_calendar(profile_id));

drop policy if exists leave_select_own_or_manager on public.leave_requests;
create policy leave_select_own_or_manager on public.leave_requests
  for select to authenticated
  using (profile_id = auth.uid() or public.can_view_profile_calendar(profile_id));

drop policy if exists swaps_select_branch on public.shift_swap_requests;
create policy swaps_select_branch on public.shift_swap_requests
  for select to authenticated
  using (
    branch_id = public.current_branch_id()
    or public.can_view_profile_calendar(requester_id)
    or public.can_view_profile_calendar(target_id)
  );

-- respond_to_leave_request(), respond_to_attendance_correction(), and
-- can_approve_shift_request() are intentionally NOT touched here — they
-- keep calling can_view_profile() unchanged, so training_director still
-- cannot approve anything for teaching_assistant.
