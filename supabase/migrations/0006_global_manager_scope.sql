-- Finishes the manager-tier rollout started in 0002/0003: profiles and
-- attendance already let is_manager() see/act across every branch, but
-- shifts, shift_swap_requests and leave_requests were left branch-locked
-- even for managers. The 4 manager-tier roles (ceo, coo, training_director,
-- technical) run operations across every cơ sở, not just one, so they no
-- longer pick a branch for themselves — which means every manager-gated
-- policy/RPC that still required branch_id = current_branch_id() needs that
-- restriction dropped in favor of is_manager() alone.

-- attendance.branch_id and leave_requests.branch_id must accept NULL now,
-- since a manager with no assigned branch can still clock in / request leave.
alter table public.attendance alter column branch_id drop not null;
alter table public.leave_requests alter column branch_id drop not null;

-- ============================================================
-- shifts
-- ============================================================
drop policy if exists shifts_select_branch on public.shifts;
create policy shifts_select_branch on public.shifts
  for select to authenticated
  using (branch_id = public.current_branch_id() or public.is_manager());

drop policy if exists shifts_insert_manager on public.shifts;
create policy shifts_insert_manager on public.shifts
  for insert to authenticated
  with check (public.is_manager());

drop policy if exists shifts_update_manager on public.shifts;
create policy shifts_update_manager on public.shifts
  for update to authenticated
  using (public.is_manager())
  with check (public.is_manager());

drop policy if exists shifts_delete_manager on public.shifts;
create policy shifts_delete_manager on public.shifts
  for delete to authenticated
  using (public.is_manager());

-- ============================================================
-- shift_swap_requests
-- ============================================================
drop policy if exists swaps_select_branch on public.shift_swap_requests;
create policy swaps_select_branch on public.shift_swap_requests
  for select to authenticated
  using (branch_id = public.current_branch_id() or public.is_manager());

create or replace function public.cancel_swap_request(p_request_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.shift_swap_requests%rowtype;
begin
  select * into v_req from public.shift_swap_requests where id = p_request_id for update;
  if not found or v_req.status <> 'pending' then raise exception 'Yêu cầu không còn hiệu lực'; end if;

  if v_req.requester_id <> v_uid and not public.is_manager() then
    raise exception 'Không có quyền huỷ yêu cầu này';
  end if;

  update public.shift_swap_requests
     set status = 'cancelled', responder_id = v_uid, resolved_at = now()
   where id = p_request_id;
end;
$$;

-- ============================================================
-- leave_requests
-- ============================================================
drop policy if exists leave_select_own_or_manager on public.leave_requests;
create policy leave_select_own_or_manager on public.leave_requests
  for select to authenticated
  using (profile_id = auth.uid() or public.is_manager());

create or replace function public.request_leave(
  p_start_date date,
  p_end_date date,
  p_reason text default null
) returns public.leave_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_branch uuid;
  v_row public.leave_requests%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  select branch_id into v_branch from public.profiles where id = v_uid;
  if v_branch is null and not public.is_manager() then
    raise exception 'Bạn chưa được gán cơ sở làm việc' using errcode = '23514';
  end if;
  if p_end_date < p_start_date then
    raise exception 'Ngày kết thúc phải sau ngày bắt đầu' using errcode = '23514';
  end if;

  insert into public.leave_requests (profile_id, branch_id, start_date, end_date, reason)
  values (v_uid, v_branch, p_start_date, p_end_date, nullif(p_reason, ''))
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.respond_to_leave_request(p_id uuid, p_approve boolean)
returns public.leave_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.leave_requests%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if not public.is_manager() then
    raise exception 'Chỉ quản lý mới được duyệt đơn nghỉ phép';
  end if;

  update public.leave_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      responder_id = v_uid,
      resolved_at = now()
  where id = p_id
    and status = 'pending'
  returning * into v_row;

  if not found then
    raise exception 'Đơn nghỉ phép không hợp lệ hoặc đã được xử lý';
  end if;

  return v_row;
end;
$$;

create or replace function public.cancel_leave_request(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  update public.leave_requests
  set status = 'cancelled'
  where id = p_id
    and status = 'pending'
    and (profile_id = v_uid or public.is_manager());

  if not found then
    raise exception 'Không thể huỷ đơn này';
  end if;
end;
$$;

-- ============================================================
-- attendance: allow manager clock-ins with no assigned branch
-- ============================================================
create or replace function public.clock_in(p_shift_id uuid default null)
returns public.attendance
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_branch uuid;
  v_row public.attendance%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  select branch_id into v_branch from public.profiles where id = v_uid;
  if v_branch is null and not public.is_manager() then
    raise exception 'Bạn chưa được gán cơ sở làm việc' using errcode = '23514';
  end if;

  if exists (select 1 from public.attendance where profile_id = v_uid and check_out_at is null) then
    raise exception 'Bạn đã chấm công vào rồi';
  end if;

  insert into public.attendance (profile_id, branch_id, shift_id)
  values (v_uid, v_branch, p_shift_id)
  returning * into v_row;

  return v_row;
end;
$$;
