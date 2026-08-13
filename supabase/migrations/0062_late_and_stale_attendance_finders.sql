-- Two read-only finders backing the extended /api/cron/attendance-reminders
-- route. Deliberately NOT granted to `authenticated` — being
-- `security definer`, they bypass RLS entirely and would otherwise let any
-- logged-in employee see every branch's late-arrival/attendance status.
-- Only the service-role client (supabaseAdmin, used exclusively from the
-- cron route) can call them; Postgres superuser/service_role bypasses
-- grants, so no explicit grant is needed for that path.

create or replace function public.find_late_checkin_shifts()
returns table (shift_id uuid, profile_id uuid, full_name text, start_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.assignee_id, p.full_name, s.start_at
  from public.shifts s
  join public.profiles p on p.id = s.assignee_id
  where s.late_checkin_notified_at is null
    and now() > s.start_at + interval '15 minutes'
    and now() < s.end_at + interval '2 hours'
    and not exists (select 1 from public.attendance a where a.shift_id = s.id);
$$;

create or replace function public.find_stale_checkout_sessions()
returns table (attendance_id uuid, profile_id uuid, full_name text, check_in_at timestamptz, shift_id uuid)
language sql stable security definer set search_path = public as $$
  select a.id, a.profile_id, p.full_name, a.check_in_at, a.shift_id
  from public.attendance a
  join public.profiles p on p.id = a.profile_id
  left join public.shifts s on s.id = a.shift_id
  where a.check_out_at is null
    and a.stale_checkout_notified_at is null
    and (
      (a.shift_id is null and now() > a.check_in_at + interval '30 minutes')
      or (a.shift_id is not null and now() > s.end_at + interval '15 minutes')
    );
$$;
