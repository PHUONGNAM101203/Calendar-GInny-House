-- Closes two SELECT-policy gaps left over from 0013's group-scoping pass:
-- profiles and shift_swap_requests still bypassed can_view_profile() via a
-- blanket `or is_manager()`, so coo/training_director could SELECT every
-- row in these two tables regardless of their group (hr/ceo/technical
-- were unaffected — hr was never is_manager(), and can_view_profile()
-- already returns true unconditionally for ceo/technical).
-- Mirrors the shifts_select_branch / attendance_select_branch /
-- leave_select_own_or_manager fix already applied in
-- 0013_group_scoped_visibility.sql — keep all of these in sync going
-- forward if can_view_profile() ever changes shape.

drop policy if exists profiles_select_branch on public.profiles;
create policy profiles_select_branch on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or branch_id = public.current_branch_id()
    or public.can_view_profile(id)
  );

drop policy if exists swaps_select_branch on public.shift_swap_requests;
create policy swaps_select_branch on public.shift_swap_requests
  for select to authenticated
  using (
    branch_id = public.current_branch_id()
    or public.can_view_profile(requester_id)
    or public.can_view_profile(target_id)
  );
