-- Widen the giải trình công deadline from 2 days to 1 week from shift start
-- (business-rule change, requested directly). Only this one `if` guard
-- changes; the rest of request_attendance_correction() is unchanged from
-- 0026_attendance_corrections.sql.

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
  if (now() at time zone 'Asia/Ho_Chi_Minh')::date - v_shift_date > 7 then
    raise exception 'Đã quá hạn 1 tuần để giải trình ca này';
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
