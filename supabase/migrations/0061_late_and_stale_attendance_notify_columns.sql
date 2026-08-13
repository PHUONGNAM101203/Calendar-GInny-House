-- Dedup tracking for the two new "quá giờ chấm công" alerts (see
-- app/api/cron/attendance-reminders/route.ts): without these, a cron that
-- runs every 15 minutes would re-notify Kỹ thuật about the SAME late
-- shift or unclosed session on every single tick until it resolves.
--
-- late_checkin_notified_at lives on shifts because there's no attendance
-- row yet to hang the flag on for a no-show. stale_checkout_notified_at
-- lives on attendance because "chưa chấm ra" applies uniformly to both
-- shift-tied and free (shiftless) open sessions — one flag covers both,
-- unifying what used to be a free-clock-in-only check.
alter table public.shifts
  add column if not exists late_checkin_notified_at timestamptz;

alter table public.attendance
  add column if not exists stale_checkout_notified_at timestamptz;
