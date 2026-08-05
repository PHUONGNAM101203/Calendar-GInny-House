-- Chấm công (attendance / clock in-out).

create table if not exists public.attendance (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  branch_id     uuid not null references public.branches(id) on delete cascade,
  shift_id      uuid references public.shifts(id) on delete set null,
  check_in_at   timestamptz not null default now(),
  check_out_at  timestamptz,
  created_at    timestamptz not null default now(),
  constraint attendance_checkout_after_checkin check (check_out_at is null or check_out_at > check_in_at)
);
create index if not exists attendance_profile_idx on public.attendance (profile_id, check_in_at desc);
create index if not exists attendance_branch_idx on public.attendance (branch_id, check_in_at desc);
-- one open (not-yet-checked-out) attendance row per person at a time
create unique index if not exists attendance_one_open_per_profile
  on public.attendance (profile_id) where check_out_at is null;

alter table public.attendance enable row level security;

drop policy if exists attendance_select_branch on public.attendance;
create policy attendance_select_branch on public.attendance
  for select to authenticated
  using (branch_id = public.current_branch_id() or public.is_manager());

-- all writes go through the RPCs below, which validate sequencing
-- (can't clock in twice, can't clock out without an open clock-in)

create or replace function public.clock_in(p_shift_id uuid default null)
returns public.attendance
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_branch uuid;
  v_row public.attendance%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  select branch_id into v_branch from public.profiles where id = v_uid;
  if v_branch is null then
    raise exception 'Bạn chưa được gán cơ sở làm việc' using errcode = '23514';
  end if;

  if exists (select 1 from public.attendance where profile_id = v_uid and check_out_at is null) then
    raise exception 'Bạn đã chấm công vào rồi';
  end if;

  insert into public.attendance (profile_id, branch_id, shift_id)
  values (v_uid, v_branch, p_shift_id)
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.clock_out()
returns public.attendance
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.attendance%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  update public.attendance
  set check_out_at = now()
  where profile_id = v_uid and check_out_at is null
  returning * into v_row;

  if not found then
    raise exception 'Bạn chưa chấm công vào';
  end if;

  return v_row;
end;
$$;
