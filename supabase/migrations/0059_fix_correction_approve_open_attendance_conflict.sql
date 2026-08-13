-- Bug found in production: approving a "quên chấm công" (missed_check_in)
-- attendance correction always INSERTs a brand-new open attendance row
-- (check_out_at left NULL). If the employee has, in the meantime, actually
-- clocked in for real (a very plausible race — they realize they forgot,
-- clock in themselves, then a manager later reviews the older correction
-- request), that person already has an open attendance row, and this
-- INSERT collides with the `attendance_one_open_per_profile` partial
-- unique index (0046) — the RPC then bubbles up a raw, unmapped Postgres
-- "duplicate key value" error instead of succeeding or explaining why.
-- Pre-existing bug (attendance_one_open_per_profile predates this
-- session), just never triggered until this exact real-world sequence.
--
-- Fix: if an attendance row already exists for (profile_id, shift_id) at
-- approval time, update its check_in_at instead of inserting a duplicate
-- — the correction's intent ("check-in should read requested_check_in_at
-- for this shift") is still honored correctly either way. Mirrors how the
-- late_check_in branch already just updates an existing row.

create or replace function public.respond_to_attendance_correction(p_id uuid, p_approve boolean)
returns public.attendance_corrections
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.attendance_corrections%rowtype;
  v_existing_attendance_id uuid;
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
