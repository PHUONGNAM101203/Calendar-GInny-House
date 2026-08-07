-- Atomic replace-the-set write, mirroring this codebase's existing
-- convention of pushing atomic multi-row writes into a SECURITY DEFINER
-- RPC rather than doing delete+insert as two round trips from a Server
-- Action (see e.g. respond_to_shift_request's insert+update pattern).
create or replace function public.set_profile_branches(p_profile_id uuid, p_branch_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then
    raise exception 'Chỉ quản lý mới được cập nhật cơ sở' using errcode = '42501';
  end if;

  delete from public.profile_branches where profile_id = p_profile_id;

  if p_branch_ids is not null and array_length(p_branch_ids, 1) > 0 then
    insert into public.profile_branches (profile_id, branch_id)
    select p_profile_id, unnest(p_branch_ids)
    on conflict (profile_id, branch_id) do nothing;
  end if;
end;
$$;

grant execute on function public.set_profile_branches(uuid, uuid[]) to authenticated;

-- handle_new_user(): reads a JSON array of branch ids from signup metadata
-- instead of a single scalar. Empty/missing array -> zero profile_branches
-- rows, same as today's branch_id = null case (front-line, not yet
-- assigned — the existing nag banner covers this, no exception raised).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.staff_role;
  v_branch_id uuid;
begin
  begin
    v_role := nullif(new.raw_user_meta_data ->> 'role', '')::public.staff_role;
  exception when invalid_text_representation then
    v_role := null;
  end;

  if v_role is null or v_role not in (
    'teacher', 'operations_staff', 'student_affairs', 'teaching_assistant', 'collaborator', 'customer_care'
  ) then
    v_role := 'teacher';
  end if;

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    v_role
  )
  on conflict (id) do nothing;

  for v_branch_id in
    select (value #>> '{}')::uuid
    from jsonb_array_elements(coalesce(new.raw_user_meta_data -> 'branch_ids', '[]'::jsonb))
  loop
    insert into public.profile_branches (profile_id, branch_id)
    values (new.id, v_branch_id)
    on conflict (profile_id, branch_id) do nothing;
  end loop;

  return new;
end;
$$;

-- request_leave(): branch_id is confirmed vestigial (no RLS policy or
-- approval RPC reads it). Drop the old 3-param dead overload (same
-- overload-duplication bug already fixed once this session for clock_in())
-- and stop deriving/requiring a branch on the live 6-param version.
drop function if exists public.request_leave(date, date, text);

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
  v_row public.leave_requests%rowtype;
  v_start_time time := p_start_time;
  v_end_time time := p_end_time;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
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
    (profile_id, start_date, end_date, reason, request_type, start_time, end_time)
  values
    (v_uid, p_start_date, p_end_date, nullif(p_reason, ''), p_request_type, v_start_time, v_end_time)
  returning * into v_row;

  return v_row;
end;
$$;
