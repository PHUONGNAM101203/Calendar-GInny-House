-- Splits student_affairs/teaching_assistant out of training_director's
-- group into their own group, approved/viewed by HR instead. Mirrors
-- lib/roles.ts HR_GROUP_ROLES/canApproveLeaveFor/getCalendarScope — keep
-- both in sync.

create or replace function public.can_view_profile(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() = p_target_id then true
    when (select role from public.profiles where id = auth.uid()) in ('ceo', 'technical') then true
    when (select role from public.profiles where id = auth.uid()) = 'coo' then
      (select role from public.profiles where id = p_target_id) in ('hr', 'customer_care', 'operations_staff')
    when (select role from public.profiles where id = auth.uid()) = 'training_director' then
      (select role from public.profiles where id = p_target_id) in ('teacher', 'collaborator')
    when (select role from public.profiles where id = auth.uid()) = 'hr' then
      (select role from public.profiles where id = p_target_id) in ('student_affairs', 'teaching_assistant')
    else false
  end;
$$;

grant execute on function public.can_view_profile(uuid) to authenticated;

-- HR isn't is_manager() (no full staff-edit bypass — deliberately not
-- granted), so without this it could only see its own branch's profiles,
-- not its group org-wide. can_view_profile() is a no-op addition for the
-- existing is_manager() roles (already true via is_manager()) but is what
-- actually grants HR org-wide visibility of student_affairs/teaching_assistant.
drop policy if exists profiles_select_branch on public.profiles;
create policy profiles_select_branch on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or branch_id = public.current_branch_id()
    or public.is_manager()
    or public.can_view_profile(id)
  );

create or replace function public.is_leave_approver()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role in ('ceo', 'coo', 'training_director', 'hr') from public.profiles where id = auth.uid()),
    false
  );
$$;

grant execute on function public.is_leave_approver() to authenticated;

-- ============================================================
-- shift_requests approval: was CEO-only (is_ceo()), now also lets HR
-- approve student_affairs/teaching_assistant requesters.
-- ============================================================
create or replace function public.can_approve_shift_request(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_ceo() then true
    when (select role from public.profiles where id = auth.uid()) = 'hr' then
      (select role from public.profiles where id = p_target_id) in ('student_affairs', 'teaching_assistant')
    else false
  end;
$$;

grant execute on function public.can_approve_shift_request(uuid) to authenticated;

drop policy if exists shift_requests_select on public.shift_requests;
create policy shift_requests_select on public.shift_requests
  for select to authenticated
  using (profile_id = auth.uid() or public.can_approve_shift_request(profile_id));

create or replace function public.cancel_shift_request(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.shift_requests%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  select * into v_req from public.shift_requests where id = p_id for update;
  if not found then
    raise exception 'Không thể huỷ đơn này';
  end if;

  if not (v_req.profile_id = v_uid or public.can_approve_shift_request(v_req.profile_id)) then
    raise exception 'Không thể huỷ đơn này';
  end if;

  update public.shift_requests
  set status = 'cancelled'
  where id = p_id
    and status = 'pending';

  if not found then
    raise exception 'Không thể huỷ đơn này';
  end if;
end;
$$;

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
    insert into public.shifts (assignee_id, start_at, end_at, note, created_by)
    values (v_req.profile_id, v_req.start_at, v_req.end_at, v_req.note, v_uid);
  end if;

  update public.shift_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      responder_id = v_uid,
      resolved_at = now()
  where id = p_id
  returning * into v_req;

  return v_req;
end;
$$;

revoke all on function public.cancel_shift_request(uuid) from public, anon;
revoke all on function public.respond_to_shift_request(uuid, boolean) from public, anon;
grant execute on function public.cancel_shift_request(uuid) to authenticated;
grant execute on function public.respond_to_shift_request(uuid, boolean) to authenticated;
