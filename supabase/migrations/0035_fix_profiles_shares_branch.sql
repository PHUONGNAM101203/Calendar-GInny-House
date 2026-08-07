-- Fixes a real bug in 0033: profiles_select_branch's `is_branch_member
-- (auth.uid(), branch_id)` clause compared the viewer against the TARGET
-- row's own `profiles.branch_id` column — the legacy single-branch scalar,
-- which 0034's handle_new_user() rewrite stopped writing (new signups have
-- it NULL) and set_profile_branches() never touches. That clause was
-- silently dead for anyone created/edited since 0034 shipped, confirmed by
-- a direct end-to-end test: two profiles sharing a branch via
-- profile_branches could not see each other's profile row.
--
-- The correct multi-branch analog of "same branch" is "shares at least one
-- branch membership row with the viewer" — compare profile_branches sets
-- for both people, not the target's stale scalar column.
create or replace function public.shares_branch_with(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profile_branches viewer_branch
    join public.profile_branches target_branch on target_branch.branch_id = viewer_branch.branch_id
    where viewer_branch.profile_id = auth.uid()
      and target_branch.profile_id = p_target_id
  );
$$;

grant execute on function public.shares_branch_with(uuid) to authenticated;

drop policy if exists profiles_select_branch on public.profiles;
create policy profiles_select_branch on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.shares_branch_with(id)
    or public.can_view_profile_calendar(id)
    or public.is_visible_via_roster(id)
  );
