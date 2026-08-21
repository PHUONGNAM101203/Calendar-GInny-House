-- Round-2 review of 0072 found one regression and two follow-on gaps, all
-- in request_attendance_correction_checkout except the last item. 0072 is
-- already applied, so these are amendments via create or replace, not an
-- edit to 0072.
--
-- 1. IMPORTANT — 0072 removed the only upper bound on the requested
--    check-out time (the "same Vietnam-local date as the shift" rule, which
--    correctly needed to go: it rejected legitimate overnight shifts) and
--    replaced it with a lower bound only (`> v_shift.start_at`). Nothing
--    capped how far *after* the shift the time could be, and the filing
--    window is 7 days. Concrete failure: shift Monday 08:00-12:00,
--    correction filed Thursday requesting checkout Thursday 09:00 — every
--    remaining guard (`> check_in_at`, `<= now()`, `> start_at`) passes,
--    recording 73 hours on one session. Fix: reject when
--    `p_requested_check_out_at > v_shift.end_at + interval '6 hours'`,
--    reusing the existing 'Giờ ra không khớp với ca làm việc này' message —
--    one string covers "doesn't match this shift" on both bounds.
--
-- 2. MINOR — those same shift-anchored bounds misfire on the shiftless
--    fallback path (trợ giảng free clock-in, attendance.shift_id is null).
--    When the fallback resolves a shiftless row, v_shift describes a shift
--    that session was never tied to, so anchoring bounds to it is wrong.
--    Concrete: TA free-clocks-in 06:00, works to 07:30, files a correction
--    naming an unrelated 09:00-12:00 shift S — 07:30 <= 09:00 would reject
--    the correct time as "không khớp với ca làm việc này". Fix: track which
--    branch resolved the row (v_used_shiftless_fallback) and apply the two
--    shift-anchored bounds only when the row is actually shift-tied; the
--    existing check_in_at / now() / 7-day guards remain sufficient for the
--    shiftless path.
--
-- 3. MINOR — respond_to_attendance_correction's Finding-3 re-validation
--    (0072) selected v_att without a row lock, then updated. Under
--    read-committed, a concurrent approval of a sibling check-in correction
--    landing between the select and the update could still let the raw
--    attendance check_out_at > check_in_at constraint violation through —
--    exactly what that guard exists to prevent. Fix: `select ... for
--    update`.

-- Check-in branches unchanged, carried over byte-identical from 0059/0072.
create or replace function public.respond_to_attendance_correction(p_id uuid, p_approve boolean)
returns public.attendance_corrections
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.attendance_corrections%rowtype;
  v_existing_attendance_id uuid;
  v_new_attendance_id uuid;
  v_att public.attendance%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if not public.is_leave_approver() then
    raise exception 'Chỉ quản lý mới được duyệt đơn giải trình công';
  end if;

  select * into v_row from public.attendance_corrections where id = p_id;
  if v_row is null or not public.can_view_profile(v_row.profile_id) then
    raise exception 'Bạn không có quyền duyệt đơn của nhân viên này';
  end if;

  update public.attendance_corrections
  set status = (case when p_approve then 'approved' else 'rejected' end)::attendance_correction_status,
      responder_id = v_uid,
      resolved_at = now()
  where id = p_id and status = 'pending'
  returning * into v_row;

  if not found then
    raise exception 'Đơn giải trình công không hợp lệ hoặc đã được xử lý';
  end if;

  if p_approve then
    if v_row.kind = 'check_out' then
      -- attendance_id is ON DELETE SET NULL; if a sibling check-in
      -- correction for this shift was reverted (deleting a missed_check_in
      -- row) since this correction was filed, attendance_id is now NULL and
      -- the update below would silently match nothing.
      -- `for update` locks the row across the re-validation and the write
      -- below, closing the TOCTOU window where a concurrently approved
      -- check-in correction could move check_in_at between the select and
      -- the update and let the raw constraint violation through.
      select * into v_att from public.attendance where id = v_row.attendance_id for update;
      if not found then
        raise exception 'Không tìm thấy bản ghi chấm công liên quan — vui lòng gửi lại đơn';
      end if;

      -- check_in_at may have moved forward since this correction was filed
      -- (via a separately approved check-in correction on the same row);
      -- without re-checking, the update below could violate attendance's
      -- `check_out_at > check_in_at` constraint and surface a raw error.
      if v_row.requested_check_out_at <= v_att.check_in_at then
        raise exception 'Giờ ra không còn hợp lệ so với giờ vào đã được sửa — vui lòng gửi lại đơn';
      end if;

      update public.attendance
      set check_out_at = v_row.requested_check_out_at
      where id = v_row.attendance_id;
    elsif v_row.issue_type = 'missed_check_in' then
      select id into v_existing_attendance_id
      from public.attendance
      where profile_id = v_row.profile_id and shift_id = v_row.shift_id
      order by check_in_at desc
      limit 1;

      if v_existing_attendance_id is not null then
        update public.attendance
        set check_in_at = v_row.requested_check_in_at
        where id = v_existing_attendance_id;
        v_new_attendance_id := v_existing_attendance_id;
      else
        insert into public.attendance (profile_id, branch_id, shift_id, check_in_at)
        select v_row.profile_id, s.branch_id, s.id, v_row.requested_check_in_at
        from public.shifts s where s.id = v_row.shift_id
        returning id into v_new_attendance_id;
      end if;

      update public.attendance_corrections
      set attendance_id = v_new_attendance_id
      where id = p_id;
      v_row.attendance_id := v_new_attendance_id;
    else
      update public.attendance
      set check_in_at = v_row.requested_check_in_at
      where id = v_row.attendance_id;
    end if;
  end if;

  return v_row;
end;
$$;

grant execute on function public.respond_to_attendance_correction(uuid, boolean) to authenticated;

-- Adds the missing upper bound (fix 1) and scopes both shift-anchored
-- bounds to the shift-tied path only (fix 2). Attendance resolution and
-- every other guard are unchanged from 0072.
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
    if v_attendance is not null then
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
