-- 0024_profile_branches.sql
-- Many-to-many staff <-> branch membership. Additive only: profiles.branch_id
-- stays untouched and fully functional here — 0025 does the cutover once
-- this data is verified.

create table if not exists public.profile_branches (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  branch_id  uuid not null references public.branches(id) on delete cascade,
  primary key (profile_id, branch_id)
);
create index if not exists profile_branches_branch_idx on public.profile_branches (branch_id);

alter table public.profile_branches enable row level security;

drop policy if exists profile_branches_select on public.profile_branches;
create policy profile_branches_select on public.profile_branches
  for select to authenticated
  using (true); -- branch membership isn't sensitive; same "select true" as branches table

drop policy if exists profile_branches_write_manager on public.profile_branches;
create policy profile_branches_write_manager on public.profile_branches
  for all to authenticated
  using (public.is_manager())
  with check (public.is_manager());

-- Backfill: one row per profile that currently has a single branch_id set.
-- Management-tier profiles (branch_id already null) correctly get zero rows —
-- they're treated as "all branches" via role checks, not membership rows.
insert into public.profile_branches (profile_id, branch_id)
select id, branch_id from public.profiles
where branch_id is not null
on conflict do nothing;

-- Membership-check helper used by every rewritten RLS policy/RPC in 0025.
create or replace function public.is_branch_member(p_profile_id uuid, p_branch_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profile_branches
    where profile_id = p_profile_id and branch_id = p_branch_id
  );
$$;
grant execute on function public.is_branch_member(uuid, uuid) to authenticated;
