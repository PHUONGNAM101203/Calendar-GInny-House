-- One row per browser/device push subscription (a person can have several —
-- phone home-screen PWA, desktop browser, etc). endpoint is the natural
-- unique key: re-subscribing the same device/browser combo replaces its row
-- instead of accumulating duplicates.
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_profile_id_idx on public.push_subscriptions (profile_id);

alter table public.push_subscriptions enable row level security;

-- A user manages only their own device subscriptions — subscribe (insert)
-- and unsubscribe (delete) both happen client-side via the authenticated
-- session, no admin/service-role step needed for either.
create policy push_subscriptions_owner on public.push_subscriptions
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- Sending a push is server-only (service-role, via lib/push.ts) — no
-- SELECT-for-sending policy needed for the authenticated role beyond the
-- owner policy above, which already lets a user list/manage their own rows.
