-- Fixes a live crash: "Cannot read properties of null (reading 'full_name')"
-- on /calendar for front-line staff.
--
-- Root cause is an RLS scope mismatch, not app code. The calendar's queries
-- embed a profiles relation:
--     .select("*, profile:profiles!profile_id(id, full_name)")
-- but the parent row and the embedded profile are gated by DIFFERENT
-- predicates:
--     shifts/attendance/swaps  -> visible when THE ROW's branch_id is mine
--     profiles                 -> visible when THE PERSON's home branch is mine
-- Those diverge whenever a row crosses branches — most commonly for
-- management-tier staff, who have profiles.branch_id NULL ("Toàn hệ thống")
-- by design but still clock in and take shifts at a specific branch. 0023
-- made this reachable on purpose by letting anyone be scheduled at a branch
-- other than their home one.
--
-- When they diverge Postgres returns the row with `profile: null`, and
-- types/index.ts declares that embed non-nullable, so the client dereferences
-- null and the page dies. Front-line roles are the ones that break because
-- managers have a client-side visiblePersonIds filter that happens to screen
-- the bad rows out first.
--
-- The fix restores the invariant the app already assumes: if you can see a
-- row that names a person, you can see that person's name. Fixing it here
-- covers all the embed sites at once and needs no change to /calendar.
create or replace function public.is_visible_via_roster(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.shifts s
    where s.assignee_id = p_target_id
      and s.branch_id = public.current_branch_id()
  ) or exists (
    select 1 from public.attendance a
    where a.profile_id = p_target_id
      and a.branch_id = public.current_branch_id()
  ) or exists (
    select 1 from public.shift_swap_requests w
    where (w.requester_id = p_target_id or w.target_id = p_target_id)
      and w.branch_id = public.current_branch_id()
  );
$$;

revoke all on function public.is_visible_via_roster(uuid) from public, anon;
grant execute on function public.is_visible_via_roster(uuid) to authenticated;

-- Mirrors 0025's policy with one added arm. Keep this in sync with
-- shifts_select_branch / attendance_select_branch / swaps_select_branch —
-- this arm exists precisely to stay a superset of what those three expose.
drop policy if exists profiles_select_branch on public.profiles;
create policy profiles_select_branch on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or branch_id = public.current_branch_id()
    or public.can_view_profile(id)
    or public.is_visible_via_roster(id)
  );
