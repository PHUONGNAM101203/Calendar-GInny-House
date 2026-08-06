-- Auto check-out: once a shift's end_at has passed, close any still-open
-- attendance row tied to it, stamping check_out_at with the shift's exact
-- end_at (not now()) so worked-hours stay accurate even though the write
-- itself lands up to ~1 minute late. The manual "Chấm công ra" button
-- (actions/attendance.ts clockOutAction, unchanged) stays available for
-- anyone who legitimately leaves early.
create extension if not exists pg_cron with schema extensions;

create or replace function public.auto_checkout_expired_shifts()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.attendance a
  set check_out_at = s.end_at
  from public.shifts s
  where a.shift_id = s.id
    and a.check_out_at is null
    and s.end_at <= now()
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

revoke all on function public.auto_checkout_expired_shifts() from public, anon, authenticated;

-- Idempotent re-schedule — safe to re-run this migration.
select cron.unschedule(jobid) from cron.job where jobname = 'auto-checkout-expired-shifts';
select cron.schedule(
  'auto-checkout-expired-shifts',
  '* * * * *',
  $$select public.auto_checkout_expired_shifts();$$
);
