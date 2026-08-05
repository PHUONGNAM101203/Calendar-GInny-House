-- Fixes "column status is of type X but expression is of type text" on
-- every approve/reject RPC. Postgres resolves a CASE expression's type from
-- its branches before assignment — two plain string literals resolve to
-- `text`, not the enum, so the UPDATE fails. A single literal assigns fine
-- (implicit unknown->enum cast), only the CASE form breaks. Casting the
-- whole CASE expression to the enum type fixes it.

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
  set status = (case when p_approve then 'approved' else 'rejected' end)::public.leave_status,
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

create or replace function public.respond_to_shift_request(p_id uuid, p_approve boolean)
returns public.shift_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.shift_requests%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if not public.is_ceo() then
    raise exception 'Chỉ Tổng giám đốc mới được duyệt đăng ký ca';
  end if;

  select * into v_req from public.shift_requests where id = p_id for update;
  if not found or v_req.status <> 'pending' then
    raise exception 'Đơn đăng ký không còn hiệu lực';
  end if;

  if p_approve then
    insert into public.shifts (assignee_id, start_at, end_at, note, created_by)
    values (v_req.profile_id, v_req.start_at, v_req.end_at, v_req.note, v_uid);
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
