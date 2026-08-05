-- Separate migration from 0017: Postgres disallows using a freshly-added
-- enum value in the same transaction that added it, so the can_view_profile()
-- update (which references the new values) has to land in its own file.
--
-- Puts student_affairs/teaching_assistant into training_director's group,
-- same as teacher/collaborator. Mirrors lib/roles.ts TRAINING_GROUP_ROLES.

create or replace function public.can_view_profile(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() = p_target_id then true
    when (select role from public.profiles where id = auth.uid()) in ('ceo', 'technical') then true
    when (select role from public.profiles where id = auth.uid()) = 'coo' then
      (select role from public.profiles where id = p_target_id) in ('hr', 'customer_care', 'operations_staff')
    when (select role from public.profiles where id = auth.uid()) = 'training_director' then
      (select role from public.profiles where id = p_target_id) in ('teacher', 'collaborator', 'student_affairs', 'teaching_assistant')
    else false
  end;
$$;

grant execute on function public.can_view_profile(uuid) to authenticated;
