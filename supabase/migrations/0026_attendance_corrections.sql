-- "Giải trình công": lets an employee request a correction to a missed or
-- late check-in. Mirrors leave_requests' shape (0004/0013) — same
-- pending/responder_id/resolved_at lifecycle, same is_leave_approver()/
-- can_view_profile() approval gate, same atomic `where status = 'pending'`
-- race guard. Only ever touches attendance.check_in_at — check-out
-- correction is explicitly out of scope (see design spec §2).

create type public.attendance_correction_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.attendance_correction_issue as enum ('missed_check_in', 'late_check_in');

create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  attendance_id uuid references public.attendance(id) on delete set null,
  issue_type public.attendance_correction_issue not null,
  actual_check_in_at timestamptz,
  requested_check_in_at timestamptz not null,
  reason text not null,
  status public.attendance_correction_status not null default 'pending',
  responder_id uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index attendance_corrections_profile_idx on public.attendance_corrections (profile_id, created_at desc);
create unique index attendance_corrections_one_pending_per_shift
  on public.attendance_corrections (shift_id) where status = 'pending';

alter table public.attendance_corrections enable row level security;

create policy attendance_corrections_select on public.attendance_corrections
  for select to authenticated
  using (profile_id = auth.uid() or public.can_view_profile(profile_id));

create or replace function public.request_attendance_correction(p_shift_id uuid, p_reason text)
returns public.attendance_corrections
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_shift_date date;
  v_attendance public.attendance%rowtype;
  v_issue public.attendance_correction_issue;
  v_row public.attendance_corrections%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'Vui lòng nhập lý do giải trình' using errcode = '23514';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id;
  if v_shift is null or v_shift.assignee_id <> v_uid then
    raise exception 'Không tìm thấy ca làm việc này';
  end if;

  v_shift_date := (v_shift.start_at at time zone 'Asia/Ho_Chi_Minh')::date;
  if (now() at time zone 'Asia/Ho_Chi_Minh')::date - v_shift_date > 2 then
    raise exception 'Đã quá hạn 2 ngày để giải trình ca này';
  end if;

  select * into v_attendance from public.attendance
  where profile_id = v_uid
    and (check_in_at at time zone 'Asia/Ho_Chi_Minh')::date = v_shift_date
  order by check_in_at desc
  limit 1;

  if v_attendance is null then
    v_issue := 'missed_check_in';
  elsif v_attendance.check_in_at > v_shift.start_at then
    v_issue := 'late_check_in';
  else
    raise exception 'Ca này không có sai lệch cần giải trình';
  end if;

  insert into public.attendance_corrections
    (profile_id, shift_id, attendance_id, issue_type, actual_check_in_at, requested_check_in_at, reason)
  values (
    v_uid, p_shift_id,
    case when v_issue = 'late_check_in' then v_attendance.id else null end,
    v_issue,
    case when v_issue = 'late_check_in' then v_attendance.check_in_at else null end,
    v_shift.start_at,
    p_reason
  )
  returning * into v_row;

  return v_row;
exception
  when unique_violation then
    raise exception 'Ca này đã có đơn giải trình đang chờ duyệt';
end;
$$;

grant execute on function public.request_attendance_correction(uuid, text) to authenticated;

create or replace function public.respond_to_attendance_correction(p_id uuid, p_approve boolean)
returns public.attendance_corrections
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.attendance_corrections%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if not public.is_leave_approver() then
    raise exception 'Chỉ quản lý mới được duyệt đơn giải trình công';
  end if;

  select * into v_row from public.attendance_corrections where id = p_id;
  if v_row is null or not public.can_view_profile(v_row.profile_id) then
    raise exception 'Bạn không có quyền duyệt đơn của nhân viên này';
  end if;

  update public.attendance_corrections
  set status = (case when p_approve then 'approved' else 'rejected' end)::attendance_correction_status,
      responder_id = v_uid,
      resolved_at = now()
  where id = p_id and status = 'pending'
  returning * into v_row;

  if not found then
    raise exception 'Đơn giải trình công không hợp lệ hoặc đã được xử lý';
  end if;

  if p_approve then
    if v_row.issue_type = 'missed_check_in' then
      insert into public.attendance (profile_id, branch_id, shift_id, check_in_at)
      select v_row.profile_id, s.branch_id, s.id, v_row.requested_check_in_at
      from public.shifts s where s.id = v_row.shift_id;
    else
      update public.attendance
      set check_in_at = v_row.requested_check_in_at
      where id = v_row.attendance_id;
    end if;
  end if;

  return v_row;
end;
$$;

grant execute on function public.respond_to_attendance_correction(uuid, boolean) to authenticated;

create or replace function public.cancel_attendance_correction(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  update public.attendance_corrections
  set status = 'cancelled'
  where id = p_id
    and status = 'pending'
    and (profile_id = v_uid or public.is_leave_approver());

  if not found then
    raise exception 'Không thể huỷ đơn này';
  end if;
end;
$$;

grant execute on function public.cancel_attendance_correction(uuid) to authenticated;
