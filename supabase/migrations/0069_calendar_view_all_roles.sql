-- 2026-08: every role now gets full calendar-view scope (see
-- getCalendarScope() in lib/roles.ts, now unconditionally "all"). This is
-- the SQL mirror, deliberately scoped ONLY to the tables the shift
-- calendar itself reads (shifts, attendance, profiles) — a brand-new
-- function rather than widening the existing can_view_profile_calendar()
-- (0048), because that function is also the live gate behind
-- shift_swap_requests (swaps_select_branch, 0033) and leave_requests
-- (leave_select_own_or_manager, 0029). Those two feed /swaps' "Lịch sử cơ
-- sở" section and the header notification bell's manager-tier fallback
-- (lib/notifications.ts), neither of which re-scopes what it fetches —
-- widening the shared function would have leaked swap-request history and
-- coo/training_director's pending-request notifications from group-scoped
-- to fully org-wide, well beyond "chỉ tính năng xem lịch." Leaving
-- can_view_profile_calendar() untouched keeps swap/leave visibility, and
-- everything downstream of it, exactly as before.
create or replace function public.can_view_shift_calendar(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select true;
$$;

drop policy if exists shifts_select_branch on public.shifts;
create policy shifts_select_branch on public.shifts
  for select to authenticated
  using (public.is_branch_member(auth.uid(), branch_id) or public.can_view_shift_calendar(assignee_id));

drop policy if exists attendance_select_branch on public.attendance;
create policy attendance_select_branch on public.attendance
  for select to authenticated
  using (public.is_branch_member(auth.uid(), branch_id) or public.can_view_shift_calendar(profile_id));

drop policy if exists profiles_select_branch on public.profiles;
create policy profiles_select_branch on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.shares_branch_with(id)
    or public.can_view_shift_calendar(id)
    or public.is_visible_via_roster(id)
  );
