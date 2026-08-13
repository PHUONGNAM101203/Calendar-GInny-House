-- Bug found in production: revert_attendance_correction and
-- revert_swap_request each set status back to 'pending' without checking
-- attendance_corrections_one_pending_per_shift / swap_one_pending_per_shift
-- (0026/0001) — a partial unique index allowing at most one 'pending' row
-- per shift. If a newer request for the same shift is already pending when
-- Kỹ thuật reverts an older resolved one, the revert's own UPDATE violates
-- that index and raises a raw, unmapped Postgres error ("duplicate key
-- value violates unique constraint ...") instead of a clear Vietnamese
-- message — same "guard before mutating" gap the rest of 0057 was designed
-- to avoid. Fix: check for a conflicting pending sibling first and refuse
-- with a proper message, same pattern as every other guard in 0057.

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
    where shift_id = v_row.shift_id and id <> p_id and status = 'pending'
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

  if exists (
    select 1 from public.shift_swap_requests
    where requester_shift_id = v_req.requester_shift_id and id <> p_request_id and status = 'pending'
  ) then
    raise exception 'Ca này đã có yêu cầu đổi ca khác đang chờ duyệt — không thể khôi phục tự động' using errcode = '23514';
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
