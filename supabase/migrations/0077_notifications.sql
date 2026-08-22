-- Stored per-person notifications.
--
-- Purely additive: a new table, its index and its policies. Nothing existing
-- is altered or dropped, so applying this to the live database cannot affect
-- any current behaviour.
--
-- Why a table at all, when the bell already derives its list from the four
-- request tables (lib/notifications.ts): derivation structurally cannot
-- represent an event whose evidence is gone. A deleted shift, a reassigned
-- shift, a reverted correction leave nothing behind to derive from. title/
-- body are therefore composed in Vietnamese at write time and stored, so the
-- notification still reads correctly after the thing it describes no longer
-- exists.
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  -- The recipient. on delete cascade: a deactivated/removed profile takes
  -- its notifications with it — they address nobody once the person is gone.
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- Discriminator: shift_assigned, shift_updated, shift_unassigned,
  -- shift_deleted, missed_check_in, stale_check_out, ... Deliberately text
  -- rather than an enum — new kinds ship without a migration, and nothing in
  -- SQL branches on the value.
  kind       text not null,
  title      text not null,
  body       text not null,
  -- Where clicking the notification navigates. Nullable: the bell falls back
  -- to /calendar.
  url        text,
  -- The shift/attendance/request row this concerns, for navigation and
  -- de-duplication. Intentionally NOT a foreign key — the whole point is that
  -- the row it names may already be deleted.
  related_id uuid,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

-- The only access pattern: this person's notifications, newest first.
create index notifications_profile_created_idx
  on public.notifications (profile_id, created_at desc);

alter table public.notifications enable row level security;

-- A person may read only their own notifications. There is no policy that
-- widens this for anyone — not managers, not technical. Seeing someone
-- else's notifications is never correct.
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (profile_id = auth.uid());

-- ...and mark their own as read. `with check` repeats the predicate so a row
-- cannot be updated into someone else's ownership.
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- No insert and no delete policy on purpose: there is no client write path.
-- Rows are written exclusively by the service-role client (lib/supabase/
-- admin.ts, which bypasses RLS), the same arrangement push_subscriptions
-- uses for its server-side sends (0041). Without an insert policy an
-- authenticated client cannot fabricate a notification for themselves or
-- anyone else.
