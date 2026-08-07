-- Final cutover step — only run after every branch-reading surface (Register,
-- Staff Table, shift creation, shift requests, nag banner, dashboard KPI)
-- has been manually verified working off profile_branches (see
-- docs/superpowers/plans/2026-08-07-multi-branch-staff-cutover.md Task 12,
-- and the profiles_select_branch fix in
-- 0035_fix_profiles_shares_branch.sql that Task 12's real end-to-end
-- testing caught).
alter table public.profiles drop column branch_id;
drop function if exists public.current_branch_id();
