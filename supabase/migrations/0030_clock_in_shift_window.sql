-- Chấm công vào now requires a registered shift: the caller must have a
-- `shifts` row whose window [start_at - 1h, end_at] contains "now". No
-- matching shift -> no clock-in, no exceptions (including managers — see
-- below).
--
-- Drops the p_shift_id parameter entirely: it was accepted but never
-- populated by the UI (ClockWidget always called clock_in() with zero
-- args), so this is a pure simplification, not a breaking change for real
-- usage — the RPC now derives the matching shift itself instead of
-- trusting a client-supplied id.
--
-- Also drops the old `branch_id is null and not is_manager()` bypass —
-- obsolete, since shifts.branch_id is `not null` (0001_init.sql), so any
-- matched shift always carries a branch. Managers get no special case
-- anymore, matching the product decision that attendance always requires
-- a registered shift.
-- clock_in(uuid) and clock_in() are different overloads in Postgres —
-- `create or replace` with a new signature does NOT replace the old one,
-- it would leave both callable and ambiguous for PostgREST's rpc("clock_in")
-- resolution (the old param has a default, so it's also callable with zero
-- args). Drop the old signature explicitly first.
drop function if exists public.clock_in(uuid);

create or replace function public.clock_in()
returns public.attendance
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_row public.attendance%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  if exists (select 1 from public.attendance where profile_id = v_uid and check_out_at is null) then
    raise exception 'Bạn đã chấm công vào rồi';
  end if;

  -- Excludes shifts that already have an attendance row (open or closed) —
  -- blocks re-clocking into a shift already covered, including one an
  -- approved "giải trình công" correction already stamped a shift_id onto
  -- (see respond_to_attendance_correction() in
  -- 0026_attendance_corrections.sql).
  select * into v_shift from public.shifts s
  where s.assignee_id = v_uid
    and now() >= s.start_at - interval '1 hour'
    and now() <= s.end_at
    and not exists (select 1 from public.attendance a where a.shift_id = s.id)
  order by s.start_at asc
  limit 1;

  if v_shift is null then
    raise exception 'Bạn không có ca làm việc nào trong khung giờ này' using errcode = '23514';
  end if;

  insert into public.attendance (profile_id, branch_id, shift_id)
  values (v_uid, v_shift.branch_id, v_shift.id)
  returning * into v_row;

  return v_row;
end;
$$;
