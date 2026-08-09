-- "Đã xem thông báo" moves from localStorage to the database.
--
-- NotificationsBell kept its last-seen timestamp in localStorage, which is
-- per-device and per-browser: reading the bell on a laptop left the phone
-- still showing the badge, and clearing Safari data reset it entirely.
-- Storing it on the profile makes "seen" follow the person across every
-- device they sign in on.
--
-- Nullable with no default on purpose: null means "never opened the bell",
-- which the app treats as "everything is unseen" — the same thing an empty
-- localStorage value did before, so existing users keep their current
-- behavior on first load instead of having every notification silently
-- marked as read by a backfill.
alter table public.profiles
  add column if not exists notifications_seen_at timestamptz;

-- profiles already has profiles_update_self (0001_init.sql):
--   using (id = auth.uid()) with check (id = auth.uid())
-- so a person can write their own notifications_seen_at with no new policy,
-- and cannot touch anyone else's.
