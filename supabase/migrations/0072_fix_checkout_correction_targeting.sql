-- Design review of 0071 (still unshipped — no UI calls these yet, but the
-- functions are live) found five real defects. Fixing all of them here
-- rather than editing 0071 directly, since 0071 is already applied.
--
-- 1. CRITICAL — request_attendance_correction_checkout resolved the
--    attendance row to correct by "profile_id + Vietnam-local date, latest
--    check-in", not by the shift the caller actually named. An employee
--    with two same-day shifts (e.g. 08:00-12:00 and 17:00-21:00) filing a
--    correction against the morning shift would silently target and
--    overwrite the evening shift's check-out instead — every guard passes,
--    nothing errors, the wrong session loses its hours. Fix: resolve by
--    (profile_id, shift_id) first — that is the row clock_in(p_shift_id)
--    actually created (0030 L55, 0056 L69) — and only fall back to the
--    date heuristic for shiftless trợ giảng free clock-ins (shift_id is
--    null there), so a date match can never steal another shift's row.
--    Also tightens the "same day" guard into "after the shift's start_at",
--    which is what the date check was really trying to express.
--
-- 2. IMPORTANT — respond_to_attendance_correction's check_out branch
--    updated `where id = v_row.attendance_id` with no existence check.
--    attendance_id is ON DELETE SET NULL; if a sibling check-in correction
--    for the same shift is reverted (which deletes the attendance row for
--    a missed_check_in), this correction's attendance_id silently becomes
--    NULL and the UPDATE matches zero rows while the correction still
--    flips to 'approved'. Fix: guard with `if not found`.
--
-- 3. IMPORTANT — approval never re-checked check_out_at > check_in_at
--    before writing. attendance has `check (check_out_at is null or
--    check_out_at > check_in_at)` (0003). If a check-in correction for the
--    same attendance row is approved between this correction's filing and
--    its approval, check_in_at can move past the already-requested
--    check-out, and the UPDATE below raises a raw, unmapped Postgres
--    constraint violation. Fix: re-validate and raise a proper message.
--
-- 4. IMPORTANT — reverting a missed_check_out correction restores
--    actual_check_out_at, which is NULL, reopening the session.
--    attendance_one_open_per_profile (0046) is a partial unique index on
--    (profile_id) where check_out_at is null; if the employee already has
--    another open session by revert time, the UPDATE raises a raw
--    unique-violation. Fix: check for that conflict first.
--
-- 5. IMPORTANT — check-out revert wrote back the request-time
--    actual_check_out_at unconditionally, discarding any manual fix made
--    to the row after approval. Fix: mirror the existing
--    "bị sửa bởi đơn giải trình khác" guard's style — refuse if
--    check_out_at no longer matches what this correction wrote.

-- Check-in branches below are carried over byte-identical from 0059/0071 —
-- only the check_out branch and its surrounding guards changed.
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
      select * into v_att from public.attendance where id = v_row.attendance_id;
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

-- Resolves by shift first (see fix 1 above); date-only matching is now a
-- fallback restricted to shiftless rows. The "same day" time guard is
-- replaced with "after the shift's start_at", which is what it was really
-- trying to express and doesn't depend on the (now shift-scoped) attendance
-- lookup being date-shaped.
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
  -- created for this shift. Falling back straight to date-only matching (as
  -- 0071 always did) can grab an unrelated same-day session — e.g. an
  -- employee with a morning and an evening shift, filing a correction
  -- against the morning one, would silently overwrite the evening
  -- session's check-out. Date-only matching is now only a fallback for
  -- shiftless trợ giảng free clock-ins (attendance.shift_id is null
  -- there), and even then it must not steal a row another shift claims.
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
  if p_requested_check_out_at <= v_shift.start_at then
    raise exception 'Giờ ra không khớp với ca làm việc này' using errcode = '23514';
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

-- 0058/0071 + two more guards on the check_out branch (fixes 4 and 5
-- above): refuse to reopen a session that would collide with
-- attendance_one_open_per_profile, and refuse to overwrite a check_out_at
-- that no longer matches what this correction wrote at approval time.
create or replace function public.revert_attendance_correction(p_id uuid)
returns public.attendance_corrections
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.attendance_corrections%rowtype;
  v_att public.attendance%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if (select role from public.profiles where id = v_uid) <> 'technical' then
    raise exception 'Chỉ Kỹ thuật mới có thể khôi phục đơn';
  end if;

  select * into v_row from public.attendance_corrections where id = p_id for update;
  if not found or v_row.status = 'pending' then
    raise exception 'Đơn không hợp lệ hoặc đang chờ duyệt';
  end if;

  if exists (
    select 1 from public.attendance_corrections
    where shift_id = v_row.shift_id and kind = v_row.kind and id <> p_id and status = 'pending'
  ) then
    raise exception 'Ca này đã có đơn giải trình khác đang chờ duyệt — không thể khôi phục tự động' using errcode = '23514';
  end if;

  if v_row.status = 'approved' then
    if v_row.attendance_id is null then
      raise exception 'Đơn duyệt trước khi có tính năng khôi phục — không thể khôi phục tự động' using errcode = '23514';
    end if;

    select * into v_att from public.attendance where id = v_row.attendance_id;
    if not found then
      raise exception 'Không tìm thấy bản ghi chấm công liên quan — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if v_row.kind = 'check_in' and v_att.check_out_at is not null then
      raise exception 'Bản ghi chấm công đã có giờ ra — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.attendance_corrections
      where attendance_id = v_row.attendance_id and kind = v_row.kind and id <> p_id and status = 'approved'
    ) then
      raise exception 'Bản ghi chấm công đã bị sửa bởi đơn giải trình khác — không thể khôi phục tự động' using errcode = '23514';
    end if;

    if v_row.kind = 'check_out' then
      -- Guards against silently discarding a manual fix made after
      -- approval: if check_out_at no longer matches what this correction
      -- wrote, someone else has touched the row since, and overwriting it
      -- would clobber that edit.
      if v_att.check_out_at is distinct from v_row.requested_check_out_at then
        raise exception 'Bản ghi chấm công đã bị sửa sau khi duyệt — không thể khôi phục tự động' using errcode = '23514';
      end if;

      -- Reverting a missed_check_out correction restores actual_check_out_at,
      -- which is NULL — reopening the session. attendance_one_open_per_profile
      -- (0046) is a partial unique index on (profile_id) where check_out_at
      -- is null, so this must be checked explicitly or a raw unique-violation
      -- would reach the user unmapped.
      if v_row.actual_check_out_at is null and exists (
        select 1 from public.attendance
        where profile_id = v_row.profile_id
          and check_out_at is null
          and id <> v_row.attendance_id
      ) then
        raise exception 'Nhân viên đang có ca chưa chấm công ra — không thể khôi phục tự động' using errcode = '23514';
      end if;

      -- Restores the previous check-out, or reopens the session when the
      -- correction had supplied a missing one (actual_check_out_at is NULL).
      update public.attendance set check_out_at = v_row.actual_check_out_at where id = v_row.attendance_id;
    elsif v_row.issue_type = 'missed_check_in' then
      delete from public.attendance where id = v_row.attendance_id;
    else
      update public.attendance set check_in_at = v_row.actual_check_in_at where id = v_row.attendance_id;
    end if;
  end if;

  update public.attendance_corrections
  set status = 'pending', responder_id = null, resolved_at = null
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.revert_attendance_correction(uuid) to authenticated;
