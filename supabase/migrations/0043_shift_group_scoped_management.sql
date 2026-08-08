-- Extends direct shift create/edit/delete from {ceo, coo, technical} to also
-- include training_director and hr, each scoped to their own group's staff
-- (getViewableGroupRoles' SQL twin) — and narrows coo from unrestricted
-- org-wide to the same group-scoped shape, for consistency. ceo/technical
-- keep unrestricted access. Mirrors canCreateShiftFor() in lib/roles.ts —
-- keep both in sync.
--
-- is_shift_manager() (0010_shift_requests.sql) is intentionally left in
-- place, now unreferenced — matches this project's convention of not
-- deleting superseded helper functions (e.g. can_view_profile_calendar from
-- 0029 is still present alongside can_view_profile).

create or replace function public.can_manage_shift_for(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when (select role from public.profiles where id = auth.uid()) in ('ceo', 'technical') then true
    when (select role from public.profiles where id = auth.uid()) = 'coo' then
      (select role from public.profiles where id = p_target_id) in ('hr', 'customer_care', 'operations_staff')
    when (select role from public.profiles where id = auth.uid()) = 'training_director' then
      (select role from public.profiles where id = p_target_id) in ('teacher', 'collaborator')
    when (select role from public.profiles where id = auth.uid()) = 'hr' then
      (select role from public.profiles where id = p_target_id) in ('student_affairs', 'teaching_assistant')
    else false
  end;
$$;

grant execute on function public.can_manage_shift_for(uuid) to authenticated;

-- USING checks the row's CURRENT assignee_id (a group-scoped manager can't
-- touch a shift currently outside their group, even to edit it); WITH CHECK
-- checks the NEW assignee_id after the write (can't reassign a shift to
-- someone outside their group either). Both directions must hold.
drop policy if exists shifts_insert_manager on public.shifts;
create policy shifts_insert_manager on public.shifts
  for insert to authenticated
  with check (public.can_manage_shift_for(assignee_id));

drop policy if exists shifts_update_manager on public.shifts;
create policy shifts_update_manager on public.shifts
  for update to authenticated
  using (public.can_manage_shift_for(assignee_id))
  with check (public.can_manage_shift_for(assignee_id));

drop policy if exists shifts_delete_manager on public.shifts;
create policy shifts_delete_manager on public.shifts
  for delete to authenticated
  using (public.can_manage_shift_for(assignee_id));
