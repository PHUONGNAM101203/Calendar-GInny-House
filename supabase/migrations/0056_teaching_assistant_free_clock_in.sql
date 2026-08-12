-- Trợ giảng-only free clock-in: teaching_assistant staff (primary role, or
-- secondary_role on a dual-role teacher/student_affairs profile) may clock
-- in with no matching shift — the shift-window requirement from
-- 0030_clock_in_shift_window.sql still applies to everyone else unchanged.
--
-- A shift found in the usual window still wins and is attached as before —
-- that's simply the person's primary-role work, since duty_role no longer
-- exists (0055). Only when NO shift matches does the new branch open up,
-- and only for TA-eligible profiles: the attendance row is inserted with
-- shift_id = null, which the app reads as "trợ giảng, không gắn ca".
--
-- attendance.branch_id is NOT NULL (0003_attendance.sql) and a shift-less
-- clock-in has no shift to source it from, so the caller must supply one —
-- validated against their own profile_branches, same as request_shift().
-- p_branch_id is ignored whenever a matching shift IS found, so the normal
-- zero-arg call from the UI keeps working unchanged for every non-TA staff
-- member and for TA staff clocking into a real shift.
drop function if exists public.clock_in();

create or replace function public.clock_in(p_branch_id uuid default null)
returns public.attendance
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_role public.staff_role;
  v_secondary public.staff_role;
  v_row public.attendance%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  if exists (select 1 from public.attendance where profile_id = v_uid and check_out_at is null) then
    raise exception 'Bạn đã chấm công vào rồi';
  end if;

  select * into v_shift from public.shifts s
  where s.assignee_id = v_uid
    and now() >= s.start_at - interval '1 hour'
    and now() <= s.end_at
    and not exists (select 1 from public.attendance a where a.shift_id = s.id)
  order by s.start_at asc
  limit 1;

  if v_shift.id is not null then
    insert into public.attendance (profile_id, branch_id, shift_id)
    values (v_uid, v_shift.branch_id, v_shift.id)
    returning * into v_row;
    return v_row;
  end if;

  select role, secondary_role into v_role, v_secondary from public.profiles where id = v_uid;

  -- `is distinct from`, not `<>`/`not in` — the same NULL trap fixed in
  -- 0053: for a single-role profile v_secondary is NULL, and NULL <> x is
  -- NULL (falsy-but-not-false), which would silently let this branch fall
  -- straight to the "no shift" rejection for a pure teaching_assistant
  -- profile too if written the naive way.
  if v_role <> 'teaching_assistant' and v_secondary is distinct from 'teaching_assistant' then
    raise exception 'Bạn không có ca làm việc nào trong khung giờ này' using errcode = '23514';
  end if;

  if p_branch_id is null then
    raise exception 'Vui lòng chọn cơ sở' using errcode = '23514';
  end if;
  if not public.is_branch_member(v_uid, p_branch_id) then
    raise exception 'Bạn không thuộc cơ sở này' using errcode = '23514';
  end if;

  insert into public.attendance (profile_id, branch_id, shift_id)
  values (v_uid, p_branch_id, null)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.clock_in(uuid) to authenticated;

-- Manual attendance backfill — technical only (explicit user decision, not
-- the broader 'manage_attendance' group permission other managers may
-- hold: this is a narrower, role-hardcoded exception, not a relaxation of
-- technical's usual read-only charter). Motivated by trợ giảng's new
-- untied clock-in having no shift to anchor a "giải trình công" correction
-- to — this is the fallback when someone forgets to clock in or out of a
-- free session and technical needs to add the record by hand, both times
-- included, for whatever past date it actually happened.
create or replace function public.create_attendance_manual(
  p_profile_id uuid,
  p_branch_id uuid,
  p_check_in_at timestamptz,
  p_check_out_at timestamptz,
  p_shift_id uuid default null
) returns public.attendance
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.attendance%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if (select role from public.profiles where id = v_uid) <> 'technical' then
    raise exception 'Bạn không có quyền tạo chấm công thủ công';
  end if;
  if p_check_out_at <= p_check_in_at then
    raise exception 'Giờ ra phải sau giờ vào' using errcode = '23514';
  end if;
  if not public.is_branch_member(p_profile_id, p_branch_id) then
    raise exception 'Nhân viên này không thuộc cơ sở đã chọn' using errcode = '23514';
  end if;

  insert into public.attendance (profile_id, branch_id, shift_id, check_in_at, check_out_at)
  values (p_profile_id, p_branch_id, p_shift_id, p_check_in_at, p_check_out_at)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_attendance_manual(uuid, uuid, timestamptz, timestamptz, uuid) to authenticated;
