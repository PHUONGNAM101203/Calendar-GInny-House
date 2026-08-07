-- Critical production bug: respond_to_swap_request() (0001_init.sql, never
-- revised since) still read `profiles.branch_id`, which
-- 0036_drop_legacy_branch_column.sql dropped as part of the multi-branch
-- cutover earlier this session. Every swap accept/reject has been failing
-- with "column branch_id does not exist" since 0036 shipped — found via
-- live end-to-end verification of Feature 3 (pending items on calendar),
-- not caused by it.
--
-- The old check ("actor's single branch == swap's branch") is replaced with
-- the same is_branch_member()-or-is_manager() pattern already used by
-- request_shift() (0033) — a swap participant now just needs membership in
-- the swap's branch, matching how every other multi-branch permission check
-- in this schema works post-cutover.
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

  if not public.is_manager() and not public.is_branch_member(v_uid, v_req.branch_id) then
    raise exception 'Yêu cầu không thuộc cơ sở của bạn';
  end if;

  if v_req.target_id is not null then
    if v_uid <> v_req.target_id then raise exception 'Bạn không phải người được yêu cầu'; end if;
  else
    if v_uid = v_req.requester_id then raise exception 'Không thể tự nhận ca của mình'; end if;
  end if;

  if not p_accept then
    update public.shift_swap_requests
       set status = 'rejected', responder_id = v_uid, resolved_at = now()
     where id = p_request_id;
    return;
  end if;

  v_taker := v_uid;

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
     set status = 'accepted', responder_id = v_taker, resolved_at = now()
   where id = p_request_id;

  update public.shift_swap_requests
     set status = 'cancelled', resolved_at = now()
   where status = 'pending'
     and id <> p_request_id
     and (requester_shift_id in (v_req.requester_shift_id, v_req.target_shift_id)
       or target_shift_id in (v_req.requester_shift_id, v_req.target_shift_id));
end;
$$;
