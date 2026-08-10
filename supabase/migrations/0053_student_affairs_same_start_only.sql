-- ---------------------------------------------------------------------------
-- PHẦN 1 — Vá lỗ ba trị NULL trong 2 trigger duty_role của 0052.
-- ---------------------------------------------------------------------------
-- 0052 viết điều kiện tự dọn là:
--
--     if new.duty_role is not null and new.duty_role not in (v_role, v_secondary)
--
-- Với người CHỈ CÓ 1 vai trò, v_secondary là NULL, nên `x not in (a, NULL)`
-- rút gọn thành `x <> a and x <> NULL` = `TRUE and NULL` = NULL — tức là
-- KHÔNG phải TRUE, nên nhánh tự dọn không bao giờ chạy. Kết quả: một giá trị
-- duty_role sai hoàn toàn vẫn được ghi vào DB cho người không kiêm nhiệm
-- (đã kiểm chứng thực tế trên DB trước khi viết migration này).
--
-- Hệ quả nặng nhất là lệch phân quyền: một giáo viên thuần mang
-- duty_role = 'student_affairs' sẽ khiến các đơn gắn với ca đó được định tuyến
-- sang HR thay vì GĐ đào tạo (effectiveRole trong lib/roles.ts đọc thẳng
-- duty_role).
--
-- `is distinct from` là toán tử an toàn với NULL: 'teaching_assistant' is
-- distinct from NULL = TRUE, nên nhánh tự dọn chạy đúng cho cả 2 trường hợp
-- (kiêm nhiệm và không kiêm nhiệm).
--
-- Không cần dọn dữ liệu cũ: đã kiểm tra, hiện chưa có dòng nào trong shifts
-- hay shift_requests có duty_role khác NULL.
create or replace function public.validate_shift_duty_role()
returns trigger language plpgsql as $$
declare
  v_role public.staff_role;
  v_secondary public.staff_role;
begin
  select role, secondary_role into v_role, v_secondary
  from public.profiles where id = new.assignee_id;

  if new.duty_role is not null
     and new.duty_role is distinct from v_role
     and new.duty_role is distinct from v_secondary then
    new.duty_role := null;
  end if;

  if TG_OP = 'INSERT' and v_secondary is not null and new.duty_role is null then
    raise exception 'Vui lòng chọn nhiệm vụ trong ca cho nhân viên kiêm nhiệm này';
  end if;

  return new;
end;
$$;

create or replace function public.validate_shift_request_duty_role()
returns trigger language plpgsql as $$
declare
  v_role public.staff_role;
  v_secondary public.staff_role;
begin
  select role, secondary_role into v_role, v_secondary
  from public.profiles where id = new.profile_id;

  if new.duty_role is not null
     and new.duty_role is distinct from v_role
     and new.duty_role is distinct from v_secondary then
    new.duty_role := null;
  end if;

  if TG_OP = 'INSERT' and v_secondary is not null and new.duty_role is null then
    raise exception 'Vui lòng chọn nhiệm vụ trong ca cho nhân viên kiêm nhiệm này';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- PHẦN 2 — Nới luật "1 quản sinh / ca" + sửa 2 lỗi của luật cũ.
-- ---------------------------------------------------------------------------
-- Thay đổi chính: luật cũ (0037_student_affairs_single_slot.sql) chặn theo
-- CHỒNG LẤN khoảng thời gian, nên ca sáng 04:00–07:30 và ca chiều 07:00–10:00
-- (bàn giao 30 phút — lịch hoàn toàn bình thường) không tạo được. Luật mới chỉ
-- chặn khi 2 ca quản sinh cùng cơ sở có CÙNG GIỜ BẮT ĐẦU, tức đúng trường hợp
-- xếp nhầm 2 người vào cùng một suất trực.
--
-- Nhân tiện sửa 2 lỗi của bản cũ, cả hai đều nằm trong chính hàm này:
--
--   (a) TÍNH THEO NHIỆM VỤ CA. Bản cũ đọc profiles.role, nên người kiêm nhiệm
--       Quản sinh + Trợ giảng làm ca với nhiệm vụ 'teaching_assistant' vẫn bị
--       tính là chiếm suất quản sinh. Nay dùng coalesce(duty_role, p.role).
--
--   (b) LOẠI TRỪ CHÍNH MÌNH (p_exclude_profile_id — tham số mới). Bản cũ đếm
--       cả dòng của chính người đang được xét, nên đơn ĐĂNG KÝ CA của một quản
--       sinh KHÔNG BAO GIỜ duyệt được: respond_to_shift_request() insert vào
--       shifts TRƯỚC rồi mới đổi status đơn sang 'approved', nên lúc trigger
--       chạy thì đơn nguồn vẫn còn 'pending' và tự khớp với chính nó. Đã kiểm
--       chứng trên DB thật: duyệt đơn quản sinh luôn trả về lỗi trùng suất.
--       Loại trừ theo người cũng đúng với câu thông báo — luật là "đã có quản
--       sinh KHÁC", không phải "có bất kỳ dòng nào".
--
-- p_end_at bị bỏ khỏi chữ ký vì luật mới không còn nhìn giờ kết thúc. Đổi chữ
-- ký buộc phải DROP rồi tạo lại (Postgres định danh hàm theo tên + kiểu tham
-- số, nên `create or replace` với số tham số khác chỉ tạo thêm overload và để
-- lại bản cũ vẫn chạy luật cũ). Cả 2 nơi gọi đều được viết lại ngay bên dưới,
-- và không còn nơi nào khác gọi hàm này.
drop function if exists public.student_affairs_slot_taken(uuid, timestamptz, timestamptz, uuid, uuid);

create or replace function public.student_affairs_slot_taken(
  p_branch_id uuid,
  p_start_at timestamptz,
  p_exclude_shift_id uuid default null,
  p_exclude_request_id uuid default null,
  p_exclude_profile_id uuid default null
) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.shifts s
    join public.profiles p on p.id = s.assignee_id
    where coalesce(s.duty_role, p.role) = 'student_affairs'
      and s.branch_id = p_branch_id
      and s.start_at = p_start_at
      and (p_exclude_shift_id is null or s.id <> p_exclude_shift_id)
      and (p_exclude_profile_id is null or s.assignee_id <> p_exclude_profile_id)
  ) or exists (
    select 1 from public.shift_requests r
    join public.profiles p on p.id = r.profile_id
    where coalesce(r.duty_role, p.role) = 'student_affairs'
      and r.status = 'pending'
      and r.branch_id = p_branch_id
      and r.start_at = p_start_at
      and (p_exclude_request_id is null or r.id <> p_exclude_request_id)
      and (p_exclude_profile_id is null or r.profile_id <> p_exclude_profile_id)
  );
$$;

grant execute on function public.student_affairs_slot_taken(uuid, timestamptz, uuid, uuid, uuid) to authenticated;

-- Cổng chặn đọc nhiệm vụ ca, và loại trừ chính người được xếp ca.
--
-- Thứ tự trigger là phụ thuộc thật: trên bảng shifts có 2 trigger BEFORE
-- INSERT/UPDATE — shifts_validate_duty_role (0052) và
-- trg_student_affairs_single_slot (0037). Postgres chạy chúng theo thứ tự chữ
-- cái của TÊN TRIGGER, nên 's' chạy trước 't'. Đúng như cần: hàm 0052 có thể
-- tự dọn new.duty_role := null khi giá trị không khớp vai trò người được xếp,
-- và cổng chặn dưới đây phải đọc giá trị SAU khi đã dọn. Đừng đổi tên 2
-- trigger này.
create or replace function public.enforce_student_affairs_single_slot()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.staff_role;
begin
  select role into v_role from public.profiles where id = new.assignee_id;
  if coalesce(new.duty_role, v_role) = 'student_affairs' and public.student_affairs_slot_taken(
    new.branch_id, new.start_at, new.id, null, new.assignee_id
  ) then
    raise exception 'Đã có quản sinh khác trực ca bắt đầu cùng giờ này' using errcode = '23505';
  end if;
  return new;
end;
$$;

-- request_shift(): đường tự đăng ký.
--
-- p_duty_role là tham số do client gửi lên và hàm này là SECURITY DEFINER cấp
-- cho mọi tài khoản đã đăng nhập, nên KHÔNG được dùng thẳng nó làm cổng chặn:
-- trigger shift_requests_validate_duty_role chỉ dọn giá trị sai ở bước INSERT
-- phía dưới, tức là SAU khi cổng chặn đã chạy. Nếu gate đọc giá trị thô thì
-- một quản sinh chỉ cần gửi p_duty_role = 'teacher' là thoát hoàn toàn luật
-- trùng suất (coalesce ra 'teacher'), rồi trigger lại dọn về null và dòng lưu
-- xuống vẫn là một đơn quản sinh. Chiều ngược lại cũng sai: một giáo viên gửi
-- p_duty_role = 'student_affairs' sẽ bị chặn oan.
--
-- Vì vậy tự dọn p_duty_role vào v_duty theo đúng luật của trigger TRƯỚC khi
-- kiểm tra, rồi ghi chính v_duty xuống — cổng chặn và giá trị được lưu luôn
-- khớp nhau, trigger chỉ còn là lớp phòng thủ thứ hai.
--
-- Phần còn lại của thân hàm giữ nguyên bản 0052.
create or replace function public.request_shift(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_branch_id uuid,
  p_note text default null,
  p_shift_type public.shift_type default 'morning',
  p_duty_role public.staff_role default null
) returns public.shift_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role public.staff_role;
  v_secondary public.staff_role;
  v_duty public.staff_role;
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

  select role, secondary_role into v_role, v_secondary from public.profiles where id = v_uid;

  v_duty := p_duty_role;
  if v_duty is not null
     and v_duty is distinct from v_role
     and v_duty is distinct from v_secondary then
    v_duty := null;
  end if;

  if coalesce(v_duty, v_role) = 'student_affairs' and public.student_affairs_slot_taken(
    p_branch_id, p_start_at, null, null, v_uid
  ) then
    raise exception 'Đã có quản sinh khác trực ca bắt đầu cùng giờ này' using errcode = '23505';
  end if;

  insert into public.shift_requests (profile_id, branch_id, start_at, end_at, note, shift_type, duty_role)
  values (v_uid, p_branch_id, p_start_at, p_end_at, nullif(p_note, ''), p_shift_type, v_duty)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.request_shift(timestamptz, timestamptz, uuid, text, public.shift_type, public.staff_role) to authenticated;
