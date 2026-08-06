-- Restores the enum cast on respond_to_shift_request()'s status UPDATE.
--
-- 0011_fix_status_case_cast.sql originally fixed this exact error
-- ('column "status" is of type shift_request_status but expression is of
-- type text'): Postgres resolves a CASE expression's type from its
-- branches before assignment, and two plain string literals resolve to
-- `text`, not the enum. A single literal assigns fine (implicit
-- unknown->enum cast) — only the CASE form breaks.
--
-- Every later rewrite of this function (0019, 0021, 0023) re-typed the
-- UPDATE by hand and dropped the cast again, so the bug shipped back.
-- This restores 0023's body verbatim with only the cast re-added; if this
-- function gets rewritten again, keep the ::public.shift_request_status.
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
    insert into public.shifts (assignee_id, start_at, end_at, note, created_by, shift_type, branch_id)
    values (v_req.profile_id, v_req.start_at, v_req.end_at, v_req.note, v_uid, v_req.shift_type, v_req.branch_id);
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
