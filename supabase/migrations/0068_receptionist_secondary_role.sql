-- Generalizes 0051_staff_secondary_role.sql's CHECK constraint/trigger to a
-- second pair (customer_care/hr → receptionist, "kiêm lễ tân"), and exempts
-- receptionist-duty staff from the attendance-reminder finders entirely —
-- blanket, all the time, not per-shift (see lib/roles.ts's
-- isReceptionistExempt for the full rationale: the per-shift duty_role
-- model was tried for teaching_assistant in 0052 and reverted in 0055 for
-- being too fragile around swaps).

alter table public.profiles drop constraint profiles_secondary_role_valid_pair;
alter table public.profiles add constraint profiles_secondary_role_valid_pair check (
  secondary_role is null
  or (role = 'teacher' and secondary_role = 'teaching_assistant')
  or (role = 'student_affairs' and secondary_role = 'teaching_assistant')
  or (role = 'customer_care' and secondary_role = 'receptionist')
  or (role = 'hr' and secondary_role = 'receptionist')
);

create or replace function public.protect_profile_privileges()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'service_role' or public.is_manager() then
    if new.secondary_role is not null and not (
      (new.role = 'teacher' and new.secondary_role = 'teaching_assistant') or
      (new.role = 'student_affairs' and new.secondary_role = 'teaching_assistant') or
      (new.role = 'customer_care' and new.secondary_role = 'receptionist') or
      (new.role = 'hr' and new.secondary_role = 'receptionist')
    ) then
      new.secondary_role := null;
    end if;
    return new;
  end if;
  new.role := old.role;
  new.secondary_role := old.secondary_role;
  return new;
end;
$$;

-- `is distinct from`, not `<>` — same NULL trap already noted in 0053/0056:
-- for a profile with no secondary_role, `secondary_role <> 'receptionist'`
-- is NULL (falsy-but-not-false), which would silently exclude every
-- single-role profile from these finders too if written the naive way.
create or replace function public.find_late_checkin_shifts()
returns table (shift_id uuid, profile_id uuid, full_name text, start_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.assignee_id, p.full_name, s.start_at
  from public.shifts s
  join public.profiles p on p.id = s.assignee_id
  where s.late_checkin_notified_at is null
    and now() > s.start_at + interval '15 minutes'
    and now() < s.end_at + interval '2 hours'
    and p.secondary_role is distinct from 'receptionist'
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
    and p.secondary_role is distinct from 'receptionist'
    and (
      (a.shift_id is null and now() > a.check_in_at + interval '30 minutes')
      or (a.shift_id is not null and now() > s.end_at + interval '15 minutes')
    );
$$;
