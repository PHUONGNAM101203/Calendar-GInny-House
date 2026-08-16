-- shift_requests_select (0055) only grants read access to the requester
-- themself or someone who can *approve* the request (can_approve_shift_request)
-- — unlike attendance_corrections_select/swaps_select_branch, it never got
-- the read-only ('ceo','technical') blanket-visibility carve-out every other
-- request table's SELECT policy already has (see can_view_profile /
-- can_view_profile_calendar, 0048). Kỹ thuật is read-only here, not an
-- approver, so this widens SELECT only — can_approve_shift_request (which
-- also gates the delete policy and the approve/reject RPC) is untouched.
drop policy if exists shift_requests_select on public.shift_requests;
create policy shift_requests_select on public.shift_requests
  for select to authenticated
  using (
    profile_id = auth.uid()
    or public.can_approve_shift_request(profile_id)
    or (select role from public.profiles where id = auth.uid()) = 'technical'
  );
