-- Chỉ cho phép 1 quản sinh (student_affairs) mỗi ca/cơ sở — mọi role khác vẫn
-- được đăng ký trùng giờ nhau như bình thường (shifts_no_overlap chỉ chặn
-- cùng 1 người trùng ca với chính họ, không chặn giữa 2 người khác nhau).
--
-- student_affairs_slot_taken() kiểm tra cả 2 nguồn: ca đã được duyệt
-- (shifts) và đơn đăng ký đang chờ duyệt (shift_requests, status='pending')
-- — vì đơn chờ duyệt chưa có trong bảng shifts nhưng vẫn cần chặn để tránh
-- 2 quản sinh cùng nộp đơn trùng giờ rồi một trong hai bị từ chối muộn.
create or replace function public.student_affairs_slot_taken(
  p_branch_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_exclude_shift_id uuid default null,
  p_exclude_request_id uuid default null
) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.shifts s
    join public.profiles p on p.id = s.assignee_id
    where p.role = 'student_affairs'
      and s.branch_id = p_branch_id
      and tstzrange(s.start_at, s.end_at) && tstzrange(p_start_at, p_end_at)
      and (p_exclude_shift_id is null or s.id <> p_exclude_shift_id)
  ) or exists (
    select 1 from public.shift_requests r
    join public.profiles p on p.id = r.profile_id
    where p.role = 'student_affairs'
      and r.status = 'pending'
      and r.branch_id = p_branch_id
      and tstzrange(r.start_at, r.end_at) && tstzrange(p_start_at, p_end_at)
      and (p_exclude_request_id is null or r.id <> p_exclude_request_id)
  );
$$;

grant execute on function public.student_affairs_slot_taken(uuid, timestamptz, timestamptz, uuid, uuid) to authenticated;

-- Chặn tại nguồn ghi cuối cùng: tạo/sửa ca trực tiếp (manager) và insert từ
-- respond_to_shift_request() khi duyệt đơn — cả 2 đường đều đi qua bảng
-- shifts nên 1 trigger là đủ, không cần sửa respond_to_shift_request().
create or replace function public.enforce_student_affairs_single_slot()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.staff_role;
begin
  select role into v_role from public.profiles where id = new.assignee_id;
  if v_role = 'student_affairs' and public.student_affairs_slot_taken(
    new.branch_id, new.start_at, new.end_at, new.id, null
  ) then
    raise exception 'Ca này đã có đăng ký quản sinh' using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_student_affairs_single_slot on public.shifts;
create trigger trg_student_affairs_single_slot
  before insert or update on public.shifts
  for each row execute function public.enforce_student_affairs_single_slot();

-- Chặn ngay từ bước đăng ký (self-service) để báo lỗi sớm, tránh chờ tới lúc
-- duyệt mới biết bị trùng. Giữ nguyên toàn bộ logic gốc, chỉ thêm 1 kiểm tra.
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
  v_role public.staff_role;
  v_row public.shift_requests%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if p_end_at <= p_start_at then
    raise exception 'Giờ kết thúc phải sau giờ bắt đầu' using errcode = '23514';
  end if;
  if p_branch_id is null then
    raise exception 'Vui lòng chọn cơ sở' using errcode = '23514';
  end if;
  if not public.is_manager() and not public.is_branch_member(v_uid, p_branch_id) then
    raise exception 'Bạn không thuộc cơ sở này' using errcode = '23514';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role = 'student_affairs' and public.student_affairs_slot_taken(
    p_branch_id, p_start_at, p_end_at, null, null
  ) then
    raise exception 'Ca này đã có đăng ký quản sinh' using errcode = '23505';
  end if;

  insert into public.shift_requests (profile_id, branch_id, start_at, end_at, note, shift_type)
  values (v_uid, p_branch_id, p_start_at, p_end_at, nullif(p_note, ''), p_shift_type)
  returning * into v_row;

  return v_row;
end;
$$;
