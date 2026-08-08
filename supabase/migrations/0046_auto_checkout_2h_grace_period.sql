-- Widen auto-checkout from "the instant the shift ends" to "2 hours after
-- the shift ends" — staff working overtime need room to keep working past
-- end_at and clock out themselves with their real hours, without the
-- per-minute cron force-closing their attendance row first and forcing a
-- giải trình công (attendance correction) request just to fix it. A shift
-- that runs normally (no overtime) still relies on the person clicking
-- "Chấm công ra" themselves — auto-checkout is now purely a 2h-later
-- safety net for forgotten checkouts, not an at-the-minute cutoff. Still
-- stamps check_out_at with the shift's exact end_at (not now()), so a
-- forgotten-but-normal shift records accurate scheduled hours instead of
-- ~2 extra phantom hours from the grace window itself.
create or replace function public.auto_checkout_expired_shifts()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.attendance a
  set check_out_at = s.end_at
  from public.shifts s
  where a.shift_id = s.id
    and a.check_out_at is null
    and s.end_at + interval '2 hours' <= now()
    -- attendance_checkout_after_checkin (0003_attendance.sql) requires
    -- check_out_at > check_in_at strictly. clock_in()'s window allows
    -- now() == s.end_at at the boundary, so a check_in_at == s.end_at row
    -- is possible (rare). Without this guard, that one row would violate
    -- the constraint and abort this entire batch UPDATE — Postgres has no
    -- partial-statement application — silently disabling auto-checkout
    -- for everyone, every tick, until someone noticed. With the guard,
    -- that one pathological row is simply left open; manual checkout
    -- remains its fallback.
    and a.check_in_at < s.end_at;
end;
$$;
