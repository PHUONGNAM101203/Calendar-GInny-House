-- Reverts 0063's 24h window now that the Vercel project is on Pro and
-- attendance-reminders runs hourly (see vercel.json) instead of once daily.
-- Back to the original end_at-tied window from 0062: a shift only stays
-- "late" while it's still plausibly ongoing or just recently ended, not for
-- a full day after. Dedup (late_checkin_notified_at) is unaffected either
-- way — this only changes how wide the candidate window is per run.
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
