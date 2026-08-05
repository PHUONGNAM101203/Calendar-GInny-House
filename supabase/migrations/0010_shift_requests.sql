-- Splits "manager-tier" (is_manager(): ceo, coo, training_director,
-- technical — full read + branch/staff management) from "can author a
-- shift directly" (ceo, coo, technical only). training_director keeps
-- every other manager privilege but no longer creates/edits/deletes shifts
-- outright — they go through the same "Đăng ký ca làm" request flow as
-- front-line staff, approved by the CEO alone.

create or replace function public.is_shift_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role in ('ceo', 'coo', 'technical') from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.is_ceo()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'ceo' from public.profiles where id = auth.uid()), false);
$$;

grant execute on function public.is_shift_manager() to authenticated;
grant execute on function public.is_ceo() to authenticated;

drop policy if exists shifts_insert_manager on public.shifts;
create policy shifts_insert_manager on public.shifts
  for insert to authenticated
  with check (public.is_shift_manager());

drop policy if exists shifts_update_manager on public.shifts;
create policy shifts_update_manager on public.shifts
  for update to authenticated
  using (public.is_shift_manager())
  with check (public.is_shift_manager());

drop policy if exists shifts_delete_manager on public.shifts;
create policy shifts_delete_manager on public.shifts
  for delete to authenticated
  using (public.is_shift_manager());

-- ============================================================
-- shift_requests: front-line + training_director "đăng ký ca làm",
-- CEO-only approval. Approving inserts the real row into shifts (going
-- through the existing shifts_sync_branch trigger and no-overlap
-- constraint), so an approved request becomes a normal schedulable shift.
-- ============================================================
do $$ begin
  create type public.shift_request_status as enum ('pending', 'approved', 'rejected', 'cancelled');
exception when duplicate_object then null;
end $$;

create table if not exists public.shift_requests (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  branch_id    uuid references public.branches(id) on delete cascade,
  start_at     timestamptz not null,
  end_at       timestamptz not null,
  note         text,
  status       public.shift_request_status not null default 'pending',
  responder_id uuid references public.profiles(id) on delete set null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint shift_requests_time_valid check (end_at > start_at)
);
create index if not exists shift_requests_profile_idx on public.shift_requests (profile_id, created_at desc);
create index if not exists shift_requests_status_idx on public.shift_requests (status, created_at desc);

alter table public.shift_requests enable row level security;

drop policy if exists shift_requests_select on public.shift_requests;
create policy shift_requests_select on public.shift_requests
  for select to authenticated
  using (profile_id = auth.uid() or public.is_ceo());

create or replace function public.request_shift(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_note text default null
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

  insert into public.shift_requests (profile_id, branch_id, start_at, end_at, note)
  values (v_uid, v_branch, p_start_at, p_end_at, nullif(p_note, ''))
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.cancel_shift_request(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  update public.shift_requests
  set status = 'cancelled'
  where id = p_id
    and status = 'pending'
    and (profile_id = v_uid or public.is_ceo());

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
  set status = case when p_approve then 'approved' else 'rejected' end,
      responder_id = v_uid,
      resolved_at = now()
  where id = p_id
  returning * into v_req;

  return v_req;
end;
$$;

revoke all on function public.request_shift(timestamptz, timestamptz, text) from public, anon;
revoke all on function public.cancel_shift_request(uuid) from public, anon;
revoke all on function public.respond_to_shift_request(uuid, boolean) from public, anon;
grant execute on function public.request_shift(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.cancel_shift_request(uuid) to authenticated;
grant execute on function public.respond_to_shift_request(uuid, boolean) to authenticated;
