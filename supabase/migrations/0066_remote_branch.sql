-- Ca remote không còn bắt buộc chọn 1 trong 3 cơ sở thật khi đăng ký/tạo ca
-- (shifts.branch_id/shift_requests.branch_id vẫn not null — 0001_init.sql).
-- Thay vì làm branch_id nullable (đụng RLS, mọi join branch:branches!branch_id,
-- và có thể phải đụng lại /calendar đang khoá), thêm 1 dòng cơ sở ảo "Remote"
-- và tự động gán ca remote vào đó ở tầng app (actions/shifts.ts,
-- actions/shift-requests.ts) — mọi RLS/join hiện có giữ nguyên không đổi.
--
-- Cơ sở này bị lọc khỏi getBranches() (lib/branches.ts) nên không xuất hiện
-- trong bất kỳ dropdown chọn-cơ-sở-thật nào (StaffTable, ShiftFormDialog/
-- ShiftRequestDialog cho ca không-remote, trang đăng ký tài khoản).
insert into public.branches (code, name, address, color_token, sort_order)
values ('REMOTE', 'Remote', null, 'chart-4', 99)
on conflict (code) do nothing;

create or replace function public.is_remote_branch(p_branch_id uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.branches where id = p_branch_id and code = 'REMOTE'
  );
$$;
grant execute on function public.is_remote_branch(uuid) to authenticated;

-- 4 RPC dưới đây chặn theo is_branch_member(...) khi cơ sở của ca/yêu cầu
-- không khớp với cơ sở người thao tác — không ai thực sự "thuộc" cơ sở ảo
-- Remote, nên mỗi chỗ thêm carve-out or is_remote_branch(...) vào đúng điều
-- kiện OR đang có sẵn. clock_in() (0056) và respond_to_shift_request()
-- (0057) không cần sửa: đã xác minh cả hai chỉ copy branch_id có sẵn từ
-- shift/request, không tự kiểm tra is_branch_member.

-- request_shift() — đăng ký ca tự phục vụ (0055's version).
create or replace function public.request_shift(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_branch_id uuid,
  p_note text default null,
  p_shift_type public.shift_type default 'morning'
) returns public.shift_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role public.staff_role;
  v_row public.shift_requests%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if p_end_at <= p_start_at then
    raise exception 'Giờ kết thúc phải sau giờ bắt đầu' using errcode = '23514';
  end if;
  if p_branch_id is null then
    raise exception 'Vui lòng chọn cơ sở' using errcode = '23514';
  end if;
  if not public.is_manager()
     and not public.is_branch_member(v_uid, p_branch_id)
     and not public.is_remote_branch(p_branch_id) then
    raise exception 'Bạn không thuộc cơ sở này' using errcode = '23514';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role = 'student_affairs' and public.student_affairs_slot_taken(
    p_branch_id, p_start_at, null, null, v_uid
  ) then
    raise exception 'Đã có quản sinh khác trực ca bắt đầu cùng giờ này' using errcode = '23505';
  end if;

  insert into public.shift_requests (profile_id, branch_id, start_at, end_at, note, shift_type)
  values (v_uid, p_branch_id, p_start_at, p_end_at, nullif(p_note, ''), p_shift_type)
  returning * into v_row;

  return v_row;
end;
$$;

-- request_shift_swap() — 0045's version.
create or replace function public.request_shift_swap(
  p_shift_id uuid,
  p_target_id uuid default null,
  p_target_shift_id uuid default null,
  p_message text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_target_shift public.shifts%rowtype;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found or v_shift.assignee_id <> v_uid then
    raise exception 'Bạn chỉ có thể yêu cầu đổi ca của chính mình';
  end if;
  if v_shift.start_at <= now() then
    raise exception 'Không thể đổi ca đã bắt đầu';
  end if;
  if exists (select 1 from public.shift_swap_requests
             where requester_shift_id = p_shift_id and status = 'pending') then
    raise exception 'Ca này đã có yêu cầu đổi đang chờ';
  end if;

  if p_target_id is not null then
    if p_target_id = v_uid then raise exception 'Không thể đổi ca với chính mình'; end if;
    if not public.is_branch_member(p_target_id, v_shift.branch_id)
       and not public.is_remote_branch(v_shift.branch_id) then
      raise exception 'Đồng nghiệp không thuộc cơ sở của bạn';
    end if;
  end if;

  if p_target_shift_id is not null then
    select * into v_target_shift from public.shifts where id = p_target_shift_id;
    if not found
       or v_target_shift.assignee_id <> p_target_id
       or v_target_shift.branch_id <> v_shift.branch_id
       or v_target_shift.start_at <= now() then
      raise exception 'Ca được chọn không hợp lệ';
    end if;
  end if;

  insert into public.shift_swap_requests (requester_id, requester_shift_id, target_id, target_shift_id, branch_id, message)
  values (v_uid, p_shift_id, p_target_id, p_target_shift_id, v_shift.branch_id, nullif(p_message, ''))
  returning id into v_id;

  return v_id;
end;
$$;

-- respond_to_swap_request() — 0055's version.
create or replace function public.respond_to_swap_request(
  p_request_id uuid,
  p_accept boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.shift_swap_requests%rowtype;
  v_taker uuid;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  select * into v_req from public.shift_swap_requests where id = p_request_id for update;
  if not found or v_req.status <> 'pending' then
    raise exception 'Yêu cầu không còn hiệu lực';
  end if;

  if not public.is_manager()
     and not public.is_branch_member(v_uid, v_req.branch_id)
     and not public.is_remote_branch(v_req.branch_id)
     and not (v_req.target_id is not null and public.can_approve_swap_request(v_req.requester_id, v_req.target_id)) then
    raise exception 'Yêu cầu không thuộc cơ sở của bạn';
  end if;

  if v_req.target_id is not null then
    if v_uid <> v_req.target_id and not public.can_approve_swap_request(v_req.requester_id, v_req.target_id) then
      raise exception 'Bạn không phải người được yêu cầu';
    end if;
  else
    if v_uid = v_req.requester_id then raise exception 'Không thể tự nhận ca của mình'; end if;
  end if;

  if not p_accept then
    update public.shift_swap_requests
       set status = 'rejected', responder_id = v_uid, resolved_at = now()
     where id = p_request_id;
    return;
  end if;

  if v_req.target_id is not null then
    v_taker := v_req.target_id;
  else
    v_taker := v_uid;
  end if;

  if not exists (select 1 from public.shifts
                 where id = v_req.requester_shift_id and assignee_id = v_req.requester_id) then
    raise exception 'Ca gốc đã thay đổi, yêu cầu không còn hợp lệ';
  end if;

  if v_req.target_shift_id is not null then
    if not exists (select 1 from public.shifts
                   where id = v_req.target_shift_id and assignee_id = v_taker) then
      raise exception 'Ca đối ứng đã thay đổi, yêu cầu không còn hợp lệ';
    end if;
    update public.shifts set assignee_id = v_taker where id = v_req.requester_shift_id;
    update public.shifts set assignee_id = v_req.requester_id where id = v_req.target_shift_id;
  else
    update public.shifts set assignee_id = v_taker where id = v_req.requester_shift_id;
  end if;

  update public.shift_swap_requests
     set status = 'accepted', responder_id = v_uid, resolved_at = now()
   where id = p_request_id;
end;
$$;

-- create_attendance_manual() — 0056's version.
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
  if not public.is_branch_member(p_profile_id, p_branch_id)
     and not public.is_remote_branch(p_branch_id) then
    raise exception 'Nhân viên này không thuộc cơ sở đã chọn' using errcode = '23514';
  end if;

  insert into public.attendance (profile_id, branch_id, shift_id, check_in_at, check_out_at)
  values (p_profile_id, p_branch_id, p_shift_id, p_check_in_at, p_check_out_at)
  returning * into v_row;

  return v_row;
end;
$$;
