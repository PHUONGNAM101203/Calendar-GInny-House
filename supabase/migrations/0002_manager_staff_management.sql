-- Lets managers see and assign branches for every staff member (including
-- people not yet assigned to any branch, who were previously invisible to
-- everyone under the branch-scoped SELECT policy), and lets a manager set
-- their own branch instead of being stuck behind a "contact your manager"
-- message that made no sense for a manager to see.

-- managers can see every profile, not just their own branch's
drop policy if exists profiles_select_branch on public.profiles;
create policy profiles_select_branch on public.profiles
  for select to authenticated
  using (id = auth.uid() or branch_id = public.current_branch_id() or public.is_manager());

-- managers can update any profile (role/branch_id assignment); employees
-- keep editing only their own full_name/phone via the existing self policy
drop policy if exists profiles_update_manager on public.profiles;
create policy profiles_update_manager on public.profiles
  for update to authenticated
  using (public.is_manager())
  with check (public.is_manager());

-- let the privilege-protecting trigger trust manager-driven writes too,
-- not just the service_role key
create or replace function public.protect_profile_privileges()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'service_role' or public.is_manager() then return new; end if;
  new.role := old.role;
  new.branch_id := old.branch_id;
  return new;
end;
$$;
