-- Vercel Hobby (this project's plan) only allows cron jobs to run once a
-- day, not every 15 minutes — the cadence 0061/0062 were designed around.
-- Reverted the cron schedule back to once daily (see vercel.json). With a
-- single run at 21:00, the old `now() < end_at + interval '2 hours'` upper
-- bound on find_late_checkin_shifts would silently skip any shift whose
-- 2-hour post-end window had already closed before the cron even ran,
-- missing exactly the no-shows this feature exists to catch. Widened to a
-- flat 24-hour window from start_at instead — dedup (late_checkin_notified_at)
-- still guarantees each shift is only ever flagged once, so there's no
-- risk of this resurfacing old/historical shifts on every run.
create or replace function public.find_late_checkin_shifts()
returns table (shift_id uuid, profile_id uuid, full_name text, start_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.assignee_id, p.full_name, s.start_at
  from public.shifts s
  join public.profiles p on p.id = s.assignee_id
  where s.late_checkin_notified_at is null
    and now() > s.start_at + interval '15 minutes'
    and now() < s.start_at + interval '24 hours'
    and not exists (select 1 from public.attendance a where a.shift_id = s.id);
$$;
