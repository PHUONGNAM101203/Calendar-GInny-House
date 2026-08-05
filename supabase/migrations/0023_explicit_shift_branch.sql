-- Branch on a shift becomes explicitly creator-chosen instead of always
-- auto-derived from the assignee's single profiles.branch_id — the old
-- derive-only trigger meant a management-tier assignee (branch_id null,
-- "Toàn hệ thống") could never be scheduled at all ("Nhân viên chưa được
-- gán cơ sở"), and there was no way to schedule anyone at a branch other
-- than their own home branch.
--
-- sync_shift_branch() becomes a fallback, not an override: it only fills
-- branch_id when the caller didn't already supply one. Every app code path
-- now supplies it explicitly (ShiftFormDialog, ShiftRequestDialog), so in
-- practice this trigger no longer fires — kept as defense-in-depth for any
-- other insert path.
create or replace function public.sync_shift_branch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.branch_id is not null then
    return new;
  end if;
  select p.branch_id into new.branch_id from public.profiles p where p.id = new.assignee_id;
  if new.branch_id is null then
    raise exception 'Nhân viên chưa được gán cơ sở' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- request_shift(): branch_id is now a required, explicit param instead of
-- derived from the requester's own profile (which is null for
-- management-tier requesters, and didn't let anyone request a shift at a
-- branch other than their own).
drop function if exists public.request_shift(timestamptz, timestamptz, text, public.shift_type);

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
  v_row public.shift_requests%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if p_end_at <= p_start_at then
    raise exception 'Giờ kết thúc phải sau giờ bắt đầu' using errcode = '23514';
  end if;
  if p_branch_id is null then
    raise exception 'Vui lòng chọn cơ sở' using errcode = '23514';
  end if;

  insert into public.shift_requests (profile_id, branch_id, start_at, end_at, note, shift_type)
  values (v_uid, p_branch_id, p_start_at, p_end_at, nullif(p_note, ''), p_shift_type)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.request_shift(timestamptz, timestamptz, uuid, text, public.shift_type) from public, anon;
grant execute on function public.request_shift(timestamptz, timestamptz, uuid, text, public.shift_type) to authenticated;

-- respond_to_shift_request(): pass the request's own branch_id straight
-- through to the approved shifts row instead of letting the trigger try
-- (and possibly fail) to derive it from the assignee's profile.
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
  set status = case when p_approve then 'approved' else 'rejected' end,
      responder_id = v_uid,
      resolved_at = now()
  where id = p_id
  returning * into v_req;

  return v_req;
end;
$$;
