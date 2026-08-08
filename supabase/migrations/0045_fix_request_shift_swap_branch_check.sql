-- Same class of bug as 0039_fix_respond_to_swap_request_branch_check.sql,
-- but on the REQUEST side: request_shift_swap() (0001_init.sql, never
-- revised since) still read `profiles.branch_id`, dropped by
-- 0036_drop_legacy_branch_column.sql as part of the multi-branch cutover.
-- Every targeted swap request (p_target_id set) has been failing with
-- "column branch_id does not exist" since 0036 shipped — found via live
-- verification while testing the new swap-approval feature (0044), not
-- caused by it. Untargeted/open swap requests (p_target_id null) were
-- unaffected, since that branch of the function never touched
-- profiles.branch_id.
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
    if not public.is_branch_member(p_target_id, v_shift.branch_id) then
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

  insert into public.shift_swap_requests
    (branch_id, requester_id, requester_shift_id, target_id, target_shift_id, message)
  values
    (v_shift.branch_id, v_uid, p_shift_id, p_target_id, p_target_shift_id, nullif(p_message, ''))
  returning id into v_id;

  return v_id;
end;
$$;
