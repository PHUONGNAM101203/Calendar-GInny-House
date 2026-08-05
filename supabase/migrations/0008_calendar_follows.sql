-- "Follow lịch" — lets ceo/coo/technical (see lib/roles.ts
-- CALENDAR_FOLLOW_ALL_ROLES) pin specific people in the calendar sidebar.
-- These 3 roles already see every shift org-wide via the is_manager() RLS
-- bypass in 0006_global_manager_scope.sql; this table only persists which
-- people they've chosen to pin/highlight, it does not gate visibility.
create table if not exists public.calendar_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint calendar_follows_not_self check (follower_id <> followee_id)
);
create index if not exists calendar_follows_follower_idx on public.calendar_follows (follower_id);

alter table public.calendar_follows enable row level security;

drop policy if exists calendar_follows_self on public.calendar_follows;
create policy calendar_follows_self on public.calendar_follows
  for all to authenticated
  using (follower_id = auth.uid())
  with check (follower_id = auth.uid());
