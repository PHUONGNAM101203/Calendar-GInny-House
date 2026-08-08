-- Two related "who can approve X" widenings, grouped in one migration since
-- both extend approval rights from {ceo, hr} to also cover coo/
-- training_director scoped to their own group — same pattern as
-- is_leave_approver()/can_view_profile() already use for leave and giải
-- trình công (0013, 0019).

-- Feature 2: shift-request approval widens from {ceo, hr} to also include
-- coo/training_director, each scoped to their own group. Mirrors
-- canApproveShiftRequestFor() in lib/roles.ts — keep both in sync.
-- respond_to_shift_request() (0027) calls this function indirectly and
-- needs no change itself.
create or replace function public.can_approve_shift_request(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_ceo() then true
    when (select role from public.profiles where id = auth.uid()) = 'coo' then
      (select role from public.profiles where id = p_target_id) in ('hr', 'customer_care', 'operations_staff')
    when (select role from public.profiles where id = auth.uid()) = 'training_director' then
      (select role from public.profiles where id = p_target_id) in ('teacher', 'collaborator')
    when (select role from public.profiles where id = auth.uid()) = 'hr' then
      (select role from public.profiles where id = p_target_id) in ('student_affairs', 'teaching_assistant')
    else false
  end;
$$;

-- Feature 3: swap-request manager approval (net new capability). ONLY
-- applies to TARGETED swaps (p_target_id not null) — untargeted/open swaps
-- keep their pure peer-claim mechanics unchanged, callers must check
-- target_id is not null before invoking this. Requires BOTH the requester
-- and the chosen target to be in the approver's own group — safer than
-- requester-only, avoids a manager reassigning a shift belonging to
-- someone entirely outside their nominal authority. technical is
-- deliberately excluded (view-only everywhere in this app). Mirrors
-- canApproveSwapRequestFor() in lib/roles.ts — keep both in sync.
create or replace function public.can_approve_swap_request(p_requester_id uuid, p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_ceo() then true
    when (select role from public.profiles where id = auth.uid()) = 'coo' then
      (select role from public.profiles where id = p_requester_id) in ('hr', 'customer_care', 'operations_staff')
      and (select role from public.profiles where id = p_target_id) in ('hr', 'customer_care', 'operations_staff')
    when (select role from public.profiles where id = auth.uid()) = 'training_director' then
      (select role from public.profiles where id = p_requester_id) in ('teacher', 'collaborator')
      and (select role from public.profiles where id = p_target_id) in ('teacher', 'collaborator')
    when (select role from public.profiles where id = auth.uid()) = 'hr' then
      (select role from public.profiles where id = p_requester_id) in ('student_affairs', 'teaching_assistant')
      and (select role from public.profiles where id = p_target_id) in ('student_affairs', 'teaching_assistant')
    else false
  end;
$$;

grant execute on function public.can_approve_swap_request(uuid, uuid) to authenticated;

-- respond_to_swap_request() rewrite — two changes that must ship together:
--
-- 1. The identity/branch checks now also accept a scoped manager approving
--    a TARGETED swap on the requester's/target's behalf.
--
-- 2. CRITICAL FIX: v_taker was unconditionally `:= v_uid`, which was only
--    ever correct because until now, only the literal target_id could reach
--    that line. Once a manager can approve on someone else's behalf, v_uid
--    (the acting manager) and the shift's rightful new assignee
--    (v_req.target_id) diverge — without this fix, a manager approving a
--    targeted swap would incorrectly become the new shift assignee
--    themselves (stealing the colleague's shift instead of approving it
--    for them).
--
-- responder_id on acceptance also changes from v_taker to v_uid, so it
-- always records who actually took the action (matters once approver and
-- taker can differ).
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

  -- Always the invited colleague for a targeted swap, whether they accepted
  -- themselves or a scoped manager approved on their behalf — never the
  -- acting approver. For an open swap, the acceptor becomes the assignee
  -- (unchanged).
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

  update public.shift_swap_requests
     set status = 'cancelled', resolved_at = now()
   where status = 'pending'
     and id <> p_request_id
     and (requester_shift_id in (v_req.requester_shift_id, v_req.target_shift_id)
       or target_shift_id in (v_req.requester_shift_id, v_req.target_shift_id));
end;
$$;
