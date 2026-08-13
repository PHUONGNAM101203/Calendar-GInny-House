-- Adds the ability for role='technical' to revert a leave/shift-request/
-- swap/attendance-correction request from any resolved status back to
-- pending, undoing whatever an approval created if that's still safe to
-- undo. See docs/superpowers/specs/2026-08-13-request-status-revert-design.md
-- for the full design and why approving isn't just a status flip for 3 of
-- the 4 entity types.

-- 1. Traceability: which shift did approving THIS shift_request create?
-- Without this, a revert of an approved shift request has no way to find
-- (let alone safely delete) the shift it produced.
alter table public.shifts
  add column if not exists shift_request_id uuid references public.shift_requests(id) on delete set null;

-- 2. respond_to_shift_request: same signature as 0055's version (CREATE OR
-- REPLACE is enough, no DROP needed) — now also stamps shift_request_id.
create or replace function public.respond_to_shift_request(p_id uuid, p_approve boolean)
returns public.shift_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.shift_requests%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  select * into v_req from public.shift_requests where id = p_id for update;
  if not found or v_req.status <> 'pending' then
    raise exception 'Đơn đăng ký không còn hiệu lực';
  end if;

  if not public.can_approve_shift_request(v_req.profile_id) then
    raise exception 'Bạn không có quyền duyệt đăng ký ca này';
  end if;

  if p_approve then
    insert into public.shifts (assignee_id, start_at, end_at, note, created_by, shift_type, branch_id, shift_request_id)
    values (v_req.profile_id, v_req.start_at, v_req.end_at, v_req.note, v_uid, v_req.shift_type, v_req.branch_id, p_id);
  end if;

  update public.shift_requests
  set status = (case when p_approve then 'approved' else 'rejected' end)::public.shift_request_status,
      responder_id = v_uid,
      resolved_at = now()
  where id = p_id
  returning * into v_req;

  return v_req;
end;
$$;

grant execute on function public.respond_to_shift_request(uuid, boolean) to authenticated;

-- 3. respond_to_attendance_correction: same signature as 0055's version —
-- now backfills attendance_id for the missed_check_in case too (it was
-- only ever populated for late_check_in, at request time).
create or replace function public.respond_to_attendance_correction(p_id uuid, p_approve boolean)
returns public.attendance_corrections
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.attendance_corrections%rowtype;
  v_new_attendance_id uuid;
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
    if v_row.issue_type = 'missed_check_in' then
      insert into public.attendance (profile_id, branch_id, shift_id, check_in_at)
      select v_row.profile_id, s.branch_id, s.id, v_row.requested_check_in_at
      from public.shifts s where s.id = v_row.shift_id
      returning id into v_new_attendance_id;

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

-- 4. revert_leave_request: no side effects to undo, ever — trivial.
create or replace function public.revert_leave_request(p_id uuid)
returns public.leave_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.leave_requests%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if (select role from public.profiles where id = v_uid) <> 'technical' then
    raise exception 'Chỉ Kỹ thuật mới có thể khôi phục đơn';
  end if;

  update public.leave_requests
  set status = 'pending', responder_id = null, resolved_at = null
  where id = p_id and status <> 'pending'
  returning * into v_row;

  if not found then
    raise exception 'Đơn không hợp lệ hoặc đang chờ duyệt';
  end if;

  return v_row;
end;
$$;

grant execute on function public.revert_leave_request(uuid) to authenticated;

-- 5. revert_shift_request: if approved, delete the shift it created — but
-- only if nothing has touched that shift since (chấm công, đổi ca, giải
-- trình công đều CASCADE-xoá nếu ta xoá ca mà không kiểm tra trước — xem
-- 0001/0026 cho các ràng buộc FK on delete cascade liên quan). Also refuses
-- to revert data approved BEFORE this migration, since shift_request_id
-- didn't exist yet to link it — silently reverting the request's status
-- while leaving an untracked shift behind would be worse than refusing.
create or replace function public.revert_shift_request(p_id uuid)
returns public.shift_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.shift_requests%rowtype;
  v_shift public.shifts%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if (select role from public.profiles where id = v_uid) <> 'technical' then
    raise exception 'Chỉ Kỹ thuật mới có thể khôi phục đơn';
  end if;

  select * into v_req from public.shift_requests where id = p_id for update;
  if not found or v_req.status = 'pending' then
    raise exception 'Đơn không hợp lệ hoặc đang chờ duyệt';
  end if;

  if v_req.status = 'approved' then
    select * into v_shift from public.shifts where shift_request_id = p_id;
    if not found then
      raise exception 'Đơn duyệt trước khi có tính năng khôi phục — không thể khôi phục tự động' using errcode = '23514';
    end if;

    if v_shift.assignee_id <> v_req.profile_id then
      raise exception 'Ca đã bị đổi cho người khác — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if exists (select 1 from public.attendance where shift_id = v_shift.id) then
      raise exception 'Ca đã có chấm công — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if exists (select 1 from public.shift_swap_requests
               where requester_shift_id = v_shift.id or target_shift_id = v_shift.id) then
      raise exception 'Ca đã liên quan đến yêu cầu đổi ca — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if exists (select 1 from public.attendance_corrections where shift_id = v_shift.id) then
      raise exception 'Ca đã liên quan đến giải trình công — không thể khôi phục tự động' using errcode = '23514';
    end if;

    delete from public.shifts where id = v_shift.id;
  end if;

  update public.shift_requests
  set status = 'pending', responder_id = null, resolved_at = null
  where id = p_id
  returning * into v_req;

  return v_req;
end;
$$;

grant execute on function public.revert_shift_request(uuid) to authenticated;

-- 6. revert_swap_request: if accepted, swap assignee_id back. requester_id/
-- target_id on the row itself already tell us the "before" state — no new
-- column needed. Auto-cancelled sibling swaps (from the original accept's
-- cascade) are deliberately left cancelled — see spec §Phạm vi.
create or replace function public.revert_swap_request(p_request_id uuid)
returns public.shift_swap_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.shift_swap_requests%rowtype;
  v_taker uuid;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if (select role from public.profiles where id = v_uid) <> 'technical' then
    raise exception 'Chỉ Kỹ thuật mới có thể khôi phục đơn';
  end if;

  select * into v_req from public.shift_swap_requests where id = p_request_id for update;
  if not found or v_req.status = 'pending' then
    raise exception 'Đơn không hợp lệ hoặc đang chờ duyệt';
  end if;

  if v_req.status = 'accepted' then
    v_taker := coalesce(v_req.target_id, v_req.responder_id);
    if v_taker is null then
      raise exception 'Không xác định được người đã nhận ca — không thể khôi phục tự động' using errcode = '23514';
    end if;

    if not exists (select 1 from public.shifts where id = v_req.requester_shift_id and assignee_id = v_taker) then
      raise exception 'Ca đã bị thay đổi tiếp — không thể khôi phục tự động' using errcode = '23514';
    end if;

    if v_req.target_shift_id is not null then
      if not exists (select 1 from public.shifts where id = v_req.target_shift_id and assignee_id = v_req.requester_id) then
        raise exception 'Ca đã bị thay đổi tiếp — không thể khôi phục tự động' using errcode = '23514';
      end if;
      update public.shifts set assignee_id = v_req.requester_id where id = v_req.requester_shift_id;
      update public.shifts set assignee_id = v_taker where id = v_req.target_shift_id;
    else
      update public.shifts set assignee_id = v_req.requester_id where id = v_req.requester_shift_id;
    end if;
  end if;

  update public.shift_swap_requests
  set status = 'pending', responder_id = null, resolved_at = null
  where id = p_request_id
  returning * into v_req;

  return v_req;
end;
$$;

grant execute on function public.revert_swap_request(uuid) to authenticated;

-- 7. revert_attendance_correction: if approved, undo the attendance write
-- — delete the inserted row (missed_check_in) or restore the prior
-- check_in_at (late_check_in, using actual_check_in_at already stored at
-- request time). Refuses on data approved before this migration (see
-- respond_to_attendance_correction's backfill above) and whenever the
-- attendance row has since been checked out or touched by another
-- approved correction.
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

  if v_row.status = 'approved' then
    if v_row.attendance_id is null then
      raise exception 'Đơn duyệt trước khi có tính năng khôi phục — không thể khôi phục tự động' using errcode = '23514';
    end if;

    select * into v_att from public.attendance where id = v_row.attendance_id;
    if not found then
      raise exception 'Không tìm thấy bản ghi chấm công liên quan — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if v_att.check_out_at is not null then
      raise exception 'Bản ghi chấm công đã có giờ ra — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.attendance_corrections
      where attendance_id = v_row.attendance_id and id <> p_id and status = 'approved'
    ) then
      raise exception 'Bản ghi chấm công đã bị sửa bởi đơn giải trình khác — không thể khôi phục tự động' using errcode = '23514';
    end if;

    if v_row.issue_type = 'missed_check_in' then
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
