-- Reconciles profile_branches with the current single-branch reality.
-- 0024's one-time backfill ran before any of today's real accounts existed
-- (confirmed via direct query: profile_branches has 0 rows while 8 of 12
-- live profiles have a non-null branch_id) — this catches that drift up.
-- Idempotent: safe to re-run, on conflict does nothing.
insert into public.profile_branches (profile_id, branch_id)
select id, branch_id from public.profiles where branch_id is not null
on conflict (profile_id, branch_id) do nothing;
