-- Adds "Đến muộn" (late arrival) / "Về sớm" (early leave) / "Nghỉ theo giờ"
-- (custom hourly) as leave-request types, alongside the existing full-day
-- request — same table, same approval flow, just an optional time window.

do $$ begin
  create type public.leave_request_type as enum ('full_day', 'late_arrival', 'early_leave', 'hourly');
exception when duplicate_object then null;
end $$;

alter table public.leave_requests add column if not exists request_type public.leave_request_type not null default 'full_day';
alter table public.leave_requests add column if not exists start_time time;
alter table public.leave_requests add column if not exists end_time time;

create or replace function public.request_leave(
  p_start_date date,
  p_end_date date,
  p_reason text default null,
  p_request_type public.leave_request_type default 'full_day',
  p_start_time time default null,
  p_end_time time default null
) returns public.leave_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_branch uuid;
  v_row public.leave_requests%rowtype;
  v_start_time time := p_start_time;
  v_end_time time := p_end_time;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  select branch_id into v_branch from public.profiles where id = v_uid;
  if v_branch is null then
    raise exception 'Bạn chưa được gán cơ sở làm việc' using errcode = '23514';
  end if;
  if p_end_date < p_start_date then
    raise exception 'Ngày kết thúc phải sau ngày bắt đầu' using errcode = '23514';
  end if;
  if p_request_type <> 'full_day' and p_end_date <> p_start_date then
    raise exception 'Đến muộn / về sớm / nghỉ theo giờ chỉ áp dụng cho 1 ngày' using errcode = '23514';
  end if;

  case p_request_type
    when 'full_day' then
      v_start_time := null;
      v_end_time := null;
    when 'late_arrival' then
      if p_start_time is null then
        raise exception 'Vui lòng chọn giờ có mặt' using errcode = '23514';
      end if;
      v_end_time := null;
    when 'early_leave' then
      if p_end_time is null then
        raise exception 'Vui lòng chọn giờ rời đi' using errcode = '23514';
      end if;
      v_start_time := null;
    when 'hourly' then
      if p_start_time is null or p_end_time is null then
        raise exception 'Vui lòng chọn giờ bắt đầu và kết thúc' using errcode = '23514';
      end if;
      if p_end_time <= p_start_time then
        raise exception 'Giờ kết thúc phải sau giờ bắt đầu' using errcode = '23514';
      end if;
  end case;

  insert into public.leave_requests
    (profile_id, branch_id, start_date, end_date, reason, request_type, start_time, end_time)
  values
    (v_uid, v_branch, p_start_date, p_end_date, nullif(p_reason, ''), p_request_type, v_start_time, v_end_time)
  returning * into v_row;

  return v_row;
end;
$$;
