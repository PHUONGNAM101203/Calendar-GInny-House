-- profiles.deactivated_at: soft-delete for staff accounts. Nullable — null
-- means active. Blocking happens app-side in requireProfile() (lib/auth.ts),
-- not in RLS, because the block must fire on every request including the
-- one that reads the profile row itself.
alter table public.profiles add column if not exists deactivated_at timestamptz;

-- Manager-side hard delete for PENDING requests only — resolved/cancelled
-- rows stay as history. Reuses the exact predicates that already gate
-- respond_to_*() RPCs (0048_group_permissions_sql_functions.sql), so delete
-- authority never exceeds approve authority for the same resource.
drop policy if exists leave_requests_delete_manager on public.leave_requests;
create policy leave_requests_delete_manager on public.leave_requests
  for delete to authenticated
  using (status = 'pending' and public.can_view_profile(profile_id));

drop policy if exists shift_requests_delete_manager on public.shift_requests;
create policy shift_requests_delete_manager on public.shift_requests
  for delete to authenticated
  using (status = 'pending' and public.can_approve_shift_request(profile_id));

-- Mirrors canApproveSwapRequestFor's own restriction: only requests with a
-- specific target_id are manager-approvable/deletable — "open" requests
-- (target_id null) stay peer-claim-only, per the existing respond flow.
drop policy if exists shift_swap_requests_delete_manager on public.shift_swap_requests;
create policy shift_swap_requests_delete_manager on public.shift_swap_requests
  for delete to authenticated
  using (
    status = 'pending'
    and target_id is not null
    and public.can_approve_swap_request(requester_id, target_id)
  );

drop policy if exists attendance_corrections_delete_manager on public.attendance_corrections;
create policy attendance_corrections_delete_manager on public.attendance_corrections
  for delete to authenticated
  using (status = 'pending' and public.can_view_profile(profile_id));
