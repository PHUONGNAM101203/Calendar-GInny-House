-- "Loại ca" (shift type): morning/afternoon/evening/remote, auto-suggested
-- client-side from the picked time range but freely editable — "remote"
-- doesn't change branch_id, every shift still belongs to one branch.
-- See docs/superpowers/specs/2026-08-05-shift-type-design.md.

do $$ begin
  create type public.shift_type as enum ('morning', 'afternoon', 'evening', 'remote');
exception when duplicate_object then null;
end $$;

alter table public.shifts
  add column if not exists shift_type public.shift_type not null default 'morning';

alter table public.shift_requests
  add column if not exists shift_type public.shift_type not null default 'morning';

-- request_shift(): gains p_shift_type. A new parameter list means Postgres
-- would otherwise keep the old 3-arg version around as a separate
-- overload — drop it explicitly instead of leaving a stale duplicate.
drop function if exists public.request_shift(timestamptz, timestamptz, text);

create or replace function public.request_shift(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_note text default null,
  p_shift_type public.shift_type default 'morning'
) returns public.shift_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_branch uuid;
  v_row public.shift_requests%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if p_end_at <= p_start_at then
    raise exception 'Giờ kết thúc phải sau giờ bắt đầu' using errcode = '23514';
  end if;

  select branch_id into v_branch from public.profiles where id = v_uid;

  insert into public.shift_requests (profile_id, branch_id, start_at, end_at, note, shift_type)
  values (v_uid, v_branch, p_start_at, p_end_at, nullif(p_note, ''), p_shift_type)
  returning * into v_row;

  return v_row;
end;
$$;

-- respond_to_shift_request(): copy shift_type onto the approved shifts row
-- instead of silently dropping it (the column didn't exist when this
-- function was first written).
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
    insert into public.shifts (assignee_id, start_at, end_at, note, created_by, shift_type)
    values (v_req.profile_id, v_req.start_at, v_req.end_at, v_req.note, v_uid, v_req.shift_type);
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

revoke all on function public.request_shift(timestamptz, timestamptz, text, public.shift_type) from public, anon;
grant execute on function public.request_shift(timestamptz, timestamptz, text, public.shift_type) to authenticated;
