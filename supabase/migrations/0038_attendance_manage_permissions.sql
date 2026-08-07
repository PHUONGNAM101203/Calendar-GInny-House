-- Lets group-scoped managers (coo/training_director/hr) edit/delete
-- attendance for staff in their own group, and ceo/technical edit/delete
-- for everyone (including old records) to clean up erroneous check-ins.
-- Mirrors canManageAttendanceFor() in lib/roles.ts — keep both in sync.
--
-- attendance previously had no update/delete policy at all (writes only
-- ever went through clock_in()/clock_out()/respond_to_attendance_correction()
-- as security definer functions) — this adds the first direct-write RLS
-- surface for the table.
create or replace function public.can_manage_attendance_for(p_target_id uuid)
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

grant execute on function public.can_manage_attendance_for(uuid) to authenticated;

drop policy if exists attendance_update_manager on public.attendance;
create policy attendance_update_manager on public.attendance
  for update to authenticated
  using (public.can_manage_attendance_for(profile_id))
  with check (public.can_manage_attendance_for(profile_id));

drop policy if exists attendance_delete_manager on public.attendance;
create policy attendance_delete_manager on public.attendance
  for delete to authenticated
  using (public.can_manage_attendance_for(profile_id));
