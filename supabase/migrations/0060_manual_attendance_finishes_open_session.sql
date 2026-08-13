-- "Tạo chấm công thủ công" (create_attendance_manual, 0056) only ever
-- inserted a fresh row, and never took a shift_id from the UI — it was
-- built for backfilling a missed trợ giảng FREE (shiftless) clock-in/out.
-- Real gap found in production: an employee with a normal, shift-tied open
-- attendance row (e.g. a "quên chấm công" correction that only fixed
-- check-in — see 0059 — or a plain forgotten check-out) has no way to get
-- their check-out time fixed through this tool: inserting a second row
-- would leave the real open one stuck open forever (still shows "đang
-- làm" indefinitely), and would never violate attendance_one_open_per_profile
-- (0046) because the NEW row has a check_out_at set, so it isn't "open" —
-- the constraint doesn't catch this mistake, it just silently produces two
-- rows, one of them permanently wrong.
--
-- Fix: attendance_one_open_per_profile guarantees at most one open session
-- per person at any time — so if Kỹ thuật submits this form for someone
-- who already has an open row (from any source: a shift, a correction, a
-- free clock-in), the correct move is always to finish/correct THAT
-- session, not add a second one. Update in place instead of inserting.

create or replace function public.create_attendance_manual(
  p_profile_id uuid, p_branch_id uuid, p_check_in_at timestamptz,
  p_check_out_at timestamptz, p_shift_id uuid default null
) returns public.attendance
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.attendance%rowtype;
  v_existing_id uuid;
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

  select id into v_existing_id from public.attendance
  where profile_id = p_profile_id and check_out_at is null
  limit 1;

  if v_existing_id is not null then
    update public.attendance
    set check_in_at = p_check_in_at, check_out_at = p_check_out_at, branch_id = p_branch_id
    where id = v_existing_id
    returning * into v_row;
  else
    insert into public.attendance (profile_id, branch_id, shift_id, check_in_at, check_out_at)
    values (p_profile_id, p_branch_id, p_shift_id, p_check_in_at, p_check_out_at)
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

grant execute on function public.create_attendance_manual(uuid, uuid, timestamptz, timestamptz, uuid) to authenticated;
