-- Lịch làm việc / shift scheduling — initial schema
-- Replaces the previous MeetAgain (dating app) schema entirely.

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ============================================================
-- 0. Teardown of the previous (dating app) schema
-- ============================================================
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user() cascade;
drop table if exists public.connections cascade;
drop table if exists public.qr_tokens cascade;
drop table if exists public.profiles cascade;

-- ============================================================
-- 1. Enums
-- ============================================================
create type public.user_role as enum ('employee', 'manager');
create type public.swap_status as enum ('pending', 'accepted', 'rejected', 'cancelled');

-- ============================================================
-- 2. Tables
-- ============================================================
create table public.branches (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,          -- CS1 / CS2 / CS3
  name        text not null,                 -- "Cơ sở 1"
  address     text,
  color_token text not null default 'chart-1',
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  phone      text,
  role       public.user_role not null default 'employee',
  branch_id  uuid references public.branches(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_branch_idx on public.profiles (branch_id);

create table public.shifts (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references public.branches(id) on delete cascade,
  assignee_id uuid not null references public.profiles(id) on delete cascade,
  start_at    timestamptz not null,
  end_at      timestamptz not null,
  note        text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint shifts_time_valid check (end_at > start_at),
  constraint shifts_no_overlap exclude using gist (
    assignee_id with =,
    tstzrange(start_at, end_at) with &&
  ) deferrable initially deferred
);
create index shifts_branch_start_idx on public.shifts (branch_id, start_at);
create index shifts_assignee_start_idx on public.shifts (assignee_id, start_at);

create table public.shift_swap_requests (
  id                 uuid primary key default gen_random_uuid(),
  branch_id          uuid not null references public.branches(id) on delete cascade,
  requester_id       uuid not null references public.profiles(id) on delete cascade,
  requester_shift_id uuid not null references public.shifts(id) on delete cascade,
  -- target_id NULL  => "nhường ca" (open giveaway, anyone in branch may take it)
  target_id          uuid references public.profiles(id) on delete cascade,
  -- target_shift_id NULL => one-way handover; NOT NULL => mutual swap
  target_shift_id    uuid references public.shifts(id) on delete cascade,
  status             public.swap_status not null default 'pending',
  message            text,
  responder_id       uuid references public.profiles(id) on delete set null,
  resolved_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint swap_target_shift_needs_target
    check (target_shift_id is null or target_id is not null),
  constraint swap_distinct_shifts
    check (target_shift_id is null or target_shift_id <> requester_shift_id),
  constraint swap_not_self
    check (target_id is null or target_id <> requester_id)
);
create unique index swap_one_pending_per_shift
  on public.shift_swap_requests (requester_shift_id) where status = 'pending';
create index swap_branch_status_idx on public.shift_swap_requests (branch_id, status, created_at desc);
create index swap_target_pending_idx on public.shift_swap_requests (target_id) where status = 'pending';

-- ============================================================
-- 3. Triggers
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger shifts_set_updated_at before update on public.shifts
  for each row execute function public.set_updated_at();
create trigger swaps_set_updated_at before update on public.shift_swap_requests
  for each row execute function public.set_updated_at();

-- auto-create profile on signup, reading the branch chosen at registration
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, branch_id)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'branch_id', '')::uuid
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- an employee can edit full_name/phone but never their own role or branch
create or replace function public.protect_profile_privileges()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  new.role := old.role;
  new.branch_id := old.branch_id;
  return new;
end;
$$;
create trigger profiles_protect_privileges before update on public.profiles
  for each row execute function public.protect_profile_privileges();

-- a shift always belongs to the assignee's branch
create or replace function public.sync_shift_branch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select p.branch_id into new.branch_id from public.profiles p where p.id = new.assignee_id;
  if new.branch_id is null then
    raise exception 'Nhân viên chưa được gán cơ sở' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger shifts_sync_branch before insert or update of assignee_id on public.shifts
  for each row execute function public.sync_shift_branch();

-- ============================================================
-- 4. Auth helpers (SECURITY DEFINER to avoid RLS recursion on profiles)
-- ============================================================
create or replace function public.current_branch_id()
returns uuid language sql stable security definer set search_path = public as $$
  select branch_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'manager' from public.profiles where id = auth.uid()), false);
$$;

-- ============================================================
-- 5. RLS
-- ============================================================
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.shifts enable row level security;
alter table public.shift_swap_requests enable row level security;

-- branches: readable by anon too (the registration branch picker runs pre-auth)
create policy branches_select_all on public.branches
  for select to anon, authenticated using (true);

-- profiles: self + coworkers in the same branch
create policy profiles_select_branch on public.profiles
  for select to authenticated
  using (id = auth.uid() or branch_id = public.current_branch_id());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- shifts: whole branch readable (needed for swap picking + coworker coloring)
create policy shifts_select_branch on public.shifts
  for select to authenticated
  using (branch_id = public.current_branch_id());

create policy shifts_insert_manager on public.shifts
  for insert to authenticated
  with check (public.is_manager() and branch_id = public.current_branch_id());

create policy shifts_update_manager on public.shifts
  for update to authenticated
  using (public.is_manager() and branch_id = public.current_branch_id())
  with check (public.is_manager() and branch_id = public.current_branch_id());

create policy shifts_delete_manager on public.shifts
  for delete to authenticated
  using (public.is_manager() and branch_id = public.current_branch_id());

-- swap requests: read-only via RLS; every write goes through the RPCs below
create policy swaps_select_branch on public.shift_swap_requests
  for select to authenticated
  using (branch_id = public.current_branch_id());

-- ============================================================
-- 6. Swap RPCs
-- ============================================================
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
    if not exists (select 1 from public.profiles
                   where id = p_target_id and branch_id = v_shift.branch_id) then
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

create or replace function public.respond_to_swap_request(
  p_request_id uuid,
  p_accept boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.shift_swap_requests%rowtype;
  v_actor_branch uuid;
  v_taker uuid;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  select * into v_req from public.shift_swap_requests where id = p_request_id for update;
  if not found or v_req.status <> 'pending' then
    raise exception 'Yêu cầu không còn hiệu lực';
  end if;

  select branch_id into v_actor_branch from public.profiles where id = v_uid;
  if v_actor_branch is distinct from v_req.branch_id then
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

create or replace function public.cancel_swap_request(p_request_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.shift_swap_requests%rowtype;
begin
  select * into v_req from public.shift_swap_requests where id = p_request_id for update;
  if not found or v_req.status <> 'pending' then raise exception 'Yêu cầu không còn hiệu lực'; end if;

  if v_req.requester_id <> v_uid
     and not (public.is_manager() and v_req.branch_id = public.current_branch_id()) then
    raise exception 'Không có quyền huỷ yêu cầu này';
  end if;

  update public.shift_swap_requests
     set status = 'cancelled', responder_id = v_uid, resolved_at = now()
   where id = p_request_id;
end;
$$;

revoke all on function public.request_shift_swap(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.respond_to_swap_request(uuid, boolean) from public, anon;
revoke all on function public.cancel_swap_request(uuid) from public, anon;
grant execute on function public.request_shift_swap(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.respond_to_swap_request(uuid, boolean) to authenticated;
grant execute on function public.cancel_swap_request(uuid) to authenticated;
grant execute on function public.current_branch_id() to authenticated;
grant execute on function public.is_manager() to authenticated;

-- ============================================================
-- 7. Seed: 3 cơ sở
-- ============================================================
insert into public.branches (code, name, address, color_token, sort_order) values
  ('CS1', 'Cơ sở 1', null, 'chart-1', 1),
  ('CS2', 'Cơ sở 2', null, 'chart-2', 2),
  ('CS3', 'Cơ sở 3', null, 'chart-3', 3)
on conflict (code) do nothing;
