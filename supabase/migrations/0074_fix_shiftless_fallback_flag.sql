-- Bug found in review of 0073: `if v_attendance is not null then` at the end
-- of the shiftless-fallback SELECT can never be true, because
-- v_attendance is public.attendance%rowtype — a composite. PostgreSQL's row
-- IS NOT NULL is NOT the negation of IS NULL for composites: a row value
-- satisfies IS NOT NULL only if EVERY field is non-null, and satisfies
-- IS NULL only if EVERY field is null (SQL-standard row-null semantics).
-- The fallback SELECT's own predicate is `shift_id is null`, so the row it
-- resolves always has at least one null field — v_attendance is not null is
-- therefore always false, v_used_shiftless_fallback never becomes true, and
-- both shift-anchored bounds (added in 0073) kept applying to shiftless
-- trợ giảng rows. That made 0073 strictly worse than 0072 for that case: a
-- legitimate shiftless correction naming an unrelated shift could now be
-- rejected by the *new* upper bound too, where 0072 would have accepted it.
--
-- v_attendance is null two lines above (checking the row wasn't found at
-- all) is correct as-is — an all-null composite does satisfy IS NULL. Only
-- the IS NOT NULL form is wrong. Fix: use FOUND, which `select ... into`
-- sets directly from the row count of the preceding SELECT and isn't
-- subject to row-null semantics at all.
--
-- Redefines request_attendance_correction_checkout only; every other guard,
-- branch and message is carried over verbatim from 0073.
create or replace function public.request_attendance_correction_checkout(
  p_shift_id uuid,
  p_requested_check_out_at timestamptz,
  p_reason text
) returns public.attendance_corrections
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_shift_date date;
  v_attendance public.attendance%rowtype;
  v_issue public.attendance_correction_issue;
  v_row public.attendance_corrections%rowtype;
  v_used_shiftless_fallback boolean := false;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'Vui lòng nhập lý do giải trình' using errcode = '23514';
  end if;
  if p_requested_check_out_at is null then
    raise exception 'Vui lòng chọn giờ ra ca' using errcode = '23514';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id;
  if v_shift is null or v_shift.assignee_id <> v_uid then
    raise exception 'Không tìm thấy ca làm việc này';
  end if;

  v_shift_date := (v_shift.start_at at time zone 'Asia/Ho_Chi_Minh')::date;
  if (now() at time zone 'Asia/Ho_Chi_Minh')::date - v_shift_date > 7 then
    raise exception 'Đã quá hạn 1 tuần để giải trình ca này';
  end if;

  -- Resolve by shift first: this is the row clock_in(p_shift_id) actually
  -- created for this shift. Falling back straight to date-only matching can
  -- grab an unrelated same-day session, so date-only matching is only a
  -- fallback for shiftless trợ giảng free clock-ins (attendance.shift_id is
  -- null there), and even then it must not steal a row another shift
  -- claims. v_used_shiftless_fallback records which branch fired, so the
  -- shift-anchored bounds below can be skipped when the row was never tied
  -- to this shift in the first place.
  select * into v_attendance from public.attendance
  where profile_id = v_uid and shift_id = p_shift_id
  order by check_in_at desc
  limit 1;

  if v_attendance is null then
    select * into v_attendance from public.attendance
    where profile_id = v_uid
      and shift_id is null
      and (check_in_at at time zone 'Asia/Ho_Chi_Minh')::date = v_shift_date
    order by check_in_at desc
    limit 1;
    if found then
      v_used_shiftless_fallback := true;
    end if;
  end if;

  -- A check-out correction closes an existing session; it cannot invent one.
  -- With no check-in there is nothing to close, so send them to the check-in
  -- flow instead of silently fabricating a session.
  if v_attendance is null then
    raise exception 'Ca này chưa có giờ vào — vui lòng giải trình giờ vào trước';
  end if;

  if p_requested_check_out_at <= v_attendance.check_in_at then
    raise exception 'Giờ ra phải sau giờ vào' using errcode = '23514';
  end if;
  if p_requested_check_out_at > now() then
    raise exception 'Giờ ra không được ở tương lai' using errcode = '23514';
  end if;

  -- Shift-anchored bounds only make sense when the resolved row actually
  -- belongs to this shift. On the shiftless fallback path, v_shift
  -- describes a shift the session was never tied to, so anchoring bounds to
  -- it would wrongly reject a correct time (e.g. a 06:00-07:30 free
  -- session corrected while naming an unrelated 09:00 shift). The
  -- check_in_at / now() / 7-day guards above are sufficient there.
  if not v_used_shiftless_fallback then
    if p_requested_check_out_at <= v_shift.start_at then
      raise exception 'Giờ ra không khớp với ca làm việc này' using errcode = '23514';
    end if;
    -- Upper bound restored after 0072 dropped the old same-day check (which
    -- had to go — it broke overnight shifts) without replacing it. 6 hours
    -- of slack past the shift's end covers legitimate overnight/late
    -- checkouts without allowing a correction filed days later, within the
    -- 7-day window, to attribute a wildly late time to this shift.
    if p_requested_check_out_at > v_shift.end_at + interval '6 hours' then
      raise exception 'Giờ ra không khớp với ca làm việc này' using errcode = '23514';
    end if;
  end if;

  v_issue := case
    when v_attendance.check_out_at is null then 'missed_check_out'
    else 'adjust_check_out'
  end;

  insert into public.attendance_corrections
    (profile_id, shift_id, attendance_id, issue_type,
     actual_check_out_at, requested_check_out_at, reason)
  values
    (v_uid, p_shift_id, v_attendance.id, v_issue,
     v_attendance.check_out_at, p_requested_check_out_at, p_reason)
  returning * into v_row;

  return v_row;
exception
  when unique_violation then
    raise exception 'Ca này đã có đơn giải trình giờ ra đang chờ duyệt';
end;
$$;

grant execute on function public.request_attendance_correction_checkout(uuid, timestamptz, text) to authenticated;
