-- Xin nghỉ phép (leave requests).

do $$ begin
  create type public.leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');
exception when duplicate_object then null;
end $$;

create table if not exists public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  branch_id     uuid not null references public.branches(id) on delete cascade,
  start_date    date not null,
  end_date      date not null,
  reason        text,
  status        public.leave_status not null default 'pending',
  responder_id  uuid references public.profiles(id) on delete set null,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint leave_dates_valid check (end_date >= start_date)
);
create index if not exists leave_branch_status_idx on public.leave_requests (branch_id, status, created_at desc);
create index if not exists leave_profile_idx on public.leave_requests (profile_id, created_at desc);

drop trigger if exists leave_requests_set_updated_at on public.leave_requests;
create trigger leave_requests_set_updated_at before update on public.leave_requests
  for each row execute function public.set_updated_at();

alter table public.leave_requests enable row level security;

-- privacy: an employee only ever sees their own leave requests (the reason
-- for absence is personal); a manager sees every request in their own
-- branch, same reach as their shift/swap management already has
drop policy if exists leave_select_own_or_manager on public.leave_requests;
create policy leave_select_own_or_manager on public.leave_requests
  for select to authenticated
  using (profile_id = auth.uid() or (public.is_manager() and branch_id = public.current_branch_id()));

-- all writes go through the RPCs below

create or replace function public.request_leave(
  p_start_date date,
  p_end_date date,
  p_reason text default null
) returns public.leave_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_branch uuid;
  v_row public.leave_requests%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  select branch_id into v_branch from public.profiles where id = v_uid;
  if v_branch is null then
    raise exception 'Bạn chưa được gán cơ sở làm việc' using errcode = '23514';
  end if;
  if p_end_date < p_start_date then
    raise exception 'Ngày kết thúc phải sau ngày bắt đầu' using errcode = '23514';
  end if;

  insert into public.leave_requests (profile_id, branch_id, start_date, end_date, reason)
  values (v_uid, v_branch, p_start_date, p_end_date, nullif(p_reason, ''))
  returning * into v_row;

  return v_row;
end;
$$;

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
  set status = case when p_approve then 'approved' else 'rejected' end,
      responder_id = v_uid,
      resolved_at = now()
  where id = p_id
    and status = 'pending'
    and branch_id = public.current_branch_id()
  returning * into v_row;

  if not found then
    raise exception 'Đơn nghỉ phép không hợp lệ hoặc đã được xử lý';
  end if;

  return v_row;
end;
$$;

create or replace function public.cancel_leave_request(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  update public.leave_requests
  set status = 'cancelled'
  where id = p_id
    and status = 'pending'
    and (profile_id = v_uid or (public.is_manager() and branch_id = public.current_branch_id()));

  if not found then
    raise exception 'Không thể huỷ đơn này';
  end if;
end;
$$;
