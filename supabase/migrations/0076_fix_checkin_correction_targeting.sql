-- Same targeting bug 0072/0074 fixed for the check-OUT RPC, still present in
-- the check-IN RPC. 0042's request_attendance_correction() resolves the
-- attendance row by DATE only:
--
--   where profile_id = v_uid
--     and (check_in_at at time zone 'Asia/Ho_Chi_Minh')::date = v_shift_date
--   order by check_in_at desc limit 1
--
-- Two shifts in one day are legal (shifts_no_overlap only forbids overlap,
-- and this roster really does run 08:00-12:00 plus 14:00-18:00 for the same
-- person), so `order by check_in_at desc` picks whichever session checked in
-- LATEST — not the one belonging to p_shift_id. Filing a correction for the
-- MORNING shift then stamps the EVENING row's id into
-- attendance_corrections.attendance_id with requested_check_in_at = the
-- morning start. On approval, respond_to_attendance_correction()'s
-- late_check_in branch writes that morning time onto the evening row
-- (`update attendance set check_in_at = requested_check_in_at where id =
-- v_row.attendance_id`), producing a 13-hour session in the hours report
-- while the genuinely late morning row is never corrected.
--
-- Fix: resolve by shift_id = p_shift_id, mirroring 0074's first step.
--
-- DELIBERATELY NO SHIFTLESS FALLBACK HERE — this is the one place this
-- migration diverges from 0074, and the divergence is the point:
--
--  1. The check-out RPC needs the fallback because a check-out correction
--     cannot invent a session: with no row it hard-errors ('Ca này chưa có
--     giờ vào...'), so a trợ giảng free clock-in would have no way to be
--     corrected at all. The check-in RPC has the opposite design — "no row
--     for this shift" is a *valid, intended* outcome that yields
--     missed_check_in, and respond_to_attendance_correction() then INSERTs a
--     fresh attendance row anchored to v_row.shift_id at approval time.
--     Not-found is a supported branch here, not a dead end.
--
--  2. Adding the fallback would actively BREAK legitimate missed_check_in.
--     clock_in() (0056) only leaves shift_id null when NO shift matched its
--     window, so a shiftless row and a real shift coexist on one day only
--     when the free session sits outside that shift's window — e.g. a TA
--     free-clocks-in at 06:00 and separately misses a 14:00 shift. A
--     fallback would resolve the 06:00 row, see 06:00 <= 14:00, and raise
--     'Ca này không có sai lệch cần giải trình', refusing a correction the
--     staff member is entitled to file.
--
--  3. Worse, if the free session happened to start after the named shift's
--     start, the fallback would classify it late_check_in and hand
--     approval the FREE session's id — so approving would rewrite an
--     unrelated trợ giảng session's check_in_at to a shift it was never
--     tied to. That is the exact bug class this migration exists to remove,
--     reintroduced through the back door.
--
-- So the check-in path resolves strictly by shift, and anything else
-- correctly falls through to missed_check_in.
--
-- `v_attendance is null` is kept verbatim from 0042 and is correct despite
-- 0074's warning: that warning was about `is NOT null` on a composite. An
-- all-null row (what `select ... into` leaves when nothing matched) does
-- satisfy `IS NULL`, so this test still means exactly "no row found".
--
-- Every other guard is carried across unchanged from 0042: the auth check,
-- the ownership check, the empty-reason check, the 7-day window, the
-- missed_check_in / late_check_in derivation, the INSERT column list, and
-- the unique_violation handler. No error string is added, changed or
-- removed — mapAttendanceCorrectionError() in
-- actions/attendance-corrections.ts whitelists by exact substring.
create or replace function public.request_attendance_correction(p_shift_id uuid, p_reason text)
returns public.attendance_corrections
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_shift_date date;
  v_attendance public.attendance%rowtype;
  v_issue public.attendance_correction_issue;
  v_row public.attendance_corrections%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'Vui lòng nhập lý do giải trình' using errcode = '23514';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id;
  if v_shift is null or v_shift.assignee_id <> v_uid then
    raise exception 'Không tìm thấy ca làm việc này';
  end if;

  v_shift_date := (v_shift.start_at at time zone 'Asia/Ho_Chi_Minh')::date;
  if (now() at time zone 'Asia/Ho_Chi_Minh')::date - v_shift_date > 7 then
    raise exception 'Đã quá hạn 1 tuần để giải trình ca này';
  end if;

  -- Resolve by shift, never by date: this is the row clock_in(p_shift_id)
  -- created for THIS shift. See the header comment for why there is
  -- deliberately no shiftless fallback on the check-in path.
  select * into v_attendance from public.attendance
  where profile_id = v_uid and shift_id = p_shift_id
  order by check_in_at desc
  limit 1;

  if v_attendance is null then
    v_issue := 'missed_check_in';
  elsif v_attendance.check_in_at > v_shift.start_at then
    v_issue := 'late_check_in';
  else
    raise exception 'Ca này không có sai lệch cần giải trình';
  end if;

  insert into public.attendance_corrections
    (profile_id, shift_id, attendance_id, issue_type, actual_check_in_at, requested_check_in_at, reason)
  values (
    v_uid, p_shift_id,
    case when v_issue = 'late_check_in' then v_attendance.id else null end,
    v_issue,
    case when v_issue = 'late_check_in' then v_attendance.check_in_at else null end,
    v_shift.start_at,
    p_reason
  )
  returning * into v_row;

  return v_row;
exception
  when unique_violation then
    raise exception 'Ca này đã có đơn giải trình đang chờ duyệt';
end;
$$;

grant execute on function public.request_attendance_correction(uuid, text) to authenticated;
