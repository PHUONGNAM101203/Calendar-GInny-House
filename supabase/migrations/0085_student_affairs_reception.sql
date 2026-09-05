-- Quản sinh kiêm lễ tân — mô hình 3 vai trò + vai trò của từng ca.
--
-- Bài toán: secondary_role là MỘT cột, mỗi primary chỉ một giá trị hợp lệ, và
-- student_affairs → teaching_assistant đã chiếm chỗ. Không có chỗ cho vai trò
-- thứ ba. Nên "kiêm lễ tân" tách ra thành năng lực riêng: lễ tân vốn không
-- phải một nấc trong thang chức danh, nó là việc trực quầy — và code đã đối xử
-- với nó như ngoại lệ ở khắp nơi rồi.
--
-- CẢNH BÁO LỊCH SỬ: 0052 từng làm "vai trò theo từng ca" (duty_role) rồi 0055
-- gỡ bỏ vì vỡ khi đổi ca, kèm ghi chú "một ca luôn là vai trò gốc của người
-- được gán". Migration này mở lại một cột theo-ca, nhưng hẹp có chủ đích:
-- CHECK chỉ cho phép NULL hoặc 'receptionist', và trường hợp đổi ca — thứ đã
-- làm 0052 vỡ — được chặn bằng trigger chứ không để mơ hồ. Đừng nới CHECK đó
-- thành hệ thống vai-trò-theo-ca tổng quát.

-- ---------------------------------------------------------------------------
-- 1. profiles.covers_reception
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists covers_reception boolean not null default false;

comment on column public.profiles.covers_reception is
  'Có trực lễ tân hay không. Thay cho secondary_role = ''receptionist'' để một người có thể vừa kiêm trợ giảng vừa kiêm lễ tân.';

-- Chuyển 3 người đang dùng cách cũ (2 CSKH, 1 HR) sang cột mới, rồi trả lại
-- secondary_role về rỗng — để chỉ còn MỘT cách diễn đạt "kiêm lễ tân".
--
-- PHẢI tắt trigger profiles_protect_privileges quanh hai câu UPDATE này.
-- Trigger đó chạy BEFORE UPDATE và, khi người gọi không phải service_role
-- cũng không phải quản lý, nó gán lại new.secondary_role := old.secondary_role.
-- Migration chạy qua Management API thì auth.uid() là NULL nên is_manager()
-- false — nghĩa là trigger LẶNG LẼ HOÀN TÁC chính câu UPDATE của migration,
-- rồi constraint bên dưới thấy 3 dòng cũ vẫn còn và từ chối. Lần đầu áp
-- migration này đã hỏng đúng vì vậy.
alter table public.profiles disable trigger profiles_protect_privileges;

update public.profiles set covers_reception = true where secondary_role = 'receptionist';
update public.profiles set secondary_role = null where secondary_role = 'receptionist';

alter table public.profiles enable trigger profiles_protect_privileges;

alter table public.profiles drop constraint if exists profiles_covers_reception_valid;
alter table public.profiles add constraint profiles_covers_reception_valid check (
  covers_reception = false
  or role in ('student_affairs', 'customer_care', 'hr')
);

-- secondary_role quay về đúng nghĩa gốc: kiêm nhiệm CHUYÊN MÔN.
alter table public.profiles drop constraint if exists profiles_secondary_role_valid_pair;
alter table public.profiles add constraint profiles_secondary_role_valid_pair check (
  secondary_role is null
  or (role = 'teacher' and secondary_role = 'teaching_assistant')
  or (role = 'student_affairs' and secondary_role = 'teaching_assistant')
);

-- ---------------------------------------------------------------------------
-- 2. protect_profile_privileges — covers_reception cũng phải được bảo vệ
-- ---------------------------------------------------------------------------
-- Không có nhánh này thì một nhân viên tự sửa hồ sơ mình có thể tự bật cờ lễ
-- tân, và qua đó tự cho mình miễn nhắc chấm công.
create or replace function public.protect_profile_privileges()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'service_role' or public.is_manager() then
    if new.secondary_role is not null and not (
      (new.role = 'teacher' and new.secondary_role = 'teaching_assistant') or
      (new.role = 'student_affairs' and new.secondary_role = 'teaching_assistant')
    ) then
      new.secondary_role := null;
    end if;
    if new.covers_reception and new.role not in ('student_affairs', 'customer_care', 'hr') then
      new.covers_reception := false;
    end if;
    return new;
  end if;
  new.role := old.role;
  new.secondary_role := old.secondary_role;
  new.covers_reception := old.covers_reception;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. covering_role trên ca và đơn đăng ký ca
-- ---------------------------------------------------------------------------
-- NULL = ca theo vai trò gốc của người được gán (đúng y hành vi cũ với mọi
-- người không kiêm lễ tân). 'receptionist' = ca lễ tân.
alter table public.shifts
  add column if not exists covering_role public.staff_role;
alter table public.shifts drop constraint if exists shifts_covering_role_valid;
alter table public.shifts add constraint shifts_covering_role_valid check (
  covering_role is null or covering_role = 'receptionist'
);

alter table public.shift_requests
  add column if not exists covering_role public.staff_role;
alter table public.shift_requests drop constraint if exists shift_requests_covering_role_valid;
alter table public.shift_requests add constraint shift_requests_covering_role_valid check (
  covering_role is null or covering_role = 'receptionist'
);

-- ---------------------------------------------------------------------------
-- 4. Ca lễ tân KHÔNG chiếm suất quản sinh
-- ---------------------------------------------------------------------------
-- "quản sinh thì 1 người 1 ca 1 cơ sở, còn lễ tân thì vẫn đky được nữa" —
-- người đang trực quầy không phải người đang trực quản sinh, nên cơ sở vẫn
-- xếp được một quản sinh thật vào cùng giờ.
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
    where p.role = 'student_affairs'
      and s.covering_role is distinct from 'receptionist'
      and s.branch_id = p_branch_id
      and s.start_at = p_start_at
      and (p_exclude_shift_id is null or s.id <> p_exclude_shift_id)
      and (p_exclude_profile_id is null or s.assignee_id <> p_exclude_profile_id)
  ) or exists (
    select 1 from public.shift_requests r
    join public.profiles p on p.id = r.profile_id
    where p.role = 'student_affairs'
      and r.covering_role is distinct from 'receptionist'
      and r.status = 'pending'
      and r.branch_id = p_branch_id
      and r.start_at = p_start_at
      and (p_exclude_request_id is null or r.id <> p_exclude_request_id)
      and (p_exclude_profile_id is null or r.profile_id <> p_exclude_profile_id)
  );
$$;

grant execute on function public.student_affairs_slot_taken(uuid, timestamptz, uuid, uuid, uuid) to authenticated;

-- Ca lễ tân của chính người đó cũng không bị luật một-suất chặn.
create or replace function public.enforce_student_affairs_single_slot()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.staff_role;
begin
  if new.covering_role = 'receptionist' then
    return new;
  end if;
  select role into v_role from public.profiles where id = new.assignee_id;
  if v_role = 'student_affairs' and public.student_affairs_slot_taken(
    new.branch_id, new.start_at, new.id, null, new.assignee_id
  ) then
    raise exception 'Đã có quản sinh khác trực ca bắt đầu cùng giờ này' using errcode = '23505';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Ca lễ tân chỉ thuộc về người có kiêm lễ tân
-- ---------------------------------------------------------------------------
-- Đặt ở TRIGGER chứ không vá từng RPC. Một ca đổi chủ qua nhiều đường — đổi
-- ca, sửa ca, gán ô trống, rải ca cố định — và vá từng đường là cách chắc
-- chắn nhất để sót một đường. Đây đúng là trường hợp đã làm 0052 vỡ.
create or replace function public.enforce_reception_shift_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_covers boolean;
begin
  if new.covering_role is distinct from 'receptionist' then
    return new;
  end if;
  select covers_reception into v_covers from public.profiles where id = new.assignee_id;
  if not coalesce(v_covers, false) then
    raise exception 'Ca lễ tân chỉ giao được cho người có kiêm lễ tân' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists shifts_reception_assignee on public.shifts;
create trigger shifts_reception_assignee
  before insert or update on public.shifts
  for each row execute function public.enforce_reception_shift_assignee();

create or replace function public.enforce_reception_request_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_covers boolean;
begin
  if new.covering_role is distinct from 'receptionist' then
    return new;
  end if;
  select covers_reception into v_covers from public.profiles where id = new.profile_id;
  if not coalesce(v_covers, false) then
    raise exception 'Chỉ người có kiêm lễ tân mới đăng ký được ca lễ tân' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists shift_requests_reception_owner on public.shift_requests;
create trigger shift_requests_reception_owner
  before insert or update on public.shift_requests
  for each row execute function public.enforce_reception_request_owner();

-- ---------------------------------------------------------------------------
-- 6. request_shift nhận vai trò của ca
-- ---------------------------------------------------------------------------
-- Dựa trên bản 0066 (đã có nhánh cơ sở remote), thêm p_covering_role. Mặc
-- định NULL nên lời gọi cũ vẫn chạy y như trước.
drop function if exists public.request_shift(timestamptz, timestamptz, uuid, text, public.shift_type);

create or replace function public.request_shift(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_branch_id uuid,
  p_note text default null,
  p_shift_type public.shift_type default 'morning',
  p_covering_role public.staff_role default null
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
  if p_covering_role is not null and p_covering_role <> 'receptionist' then
    raise exception 'Vai trò của ca không hợp lệ' using errcode = '23514';
  end if;
  if not public.is_manager()
     and not public.is_branch_member(v_uid, p_branch_id)
     and not public.is_remote_branch(p_branch_id) then
    raise exception 'Bạn không thuộc cơ sở này' using errcode = '23514';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  -- Đăng ký ca lễ tân thì không đụng luật một-suất-quản-sinh.
  if p_covering_role is distinct from 'receptionist'
     and v_role = 'student_affairs' and public.student_affairs_slot_taken(
    p_branch_id, p_start_at, null, null, v_uid
  ) then
    raise exception 'Đã có quản sinh khác trực ca bắt đầu cùng giờ này' using errcode = '23505';
  end if;

  insert into public.shift_requests (profile_id, branch_id, start_at, end_at, note, shift_type, covering_role)
  values (v_uid, p_branch_id, p_start_at, p_end_at, nullif(p_note, ''), p_shift_type, p_covering_role)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.request_shift(timestamptz, timestamptz, uuid, text, public.shift_type, public.staff_role) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Miễn nhắc chấm công thu hẹp lại
-- ---------------------------------------------------------------------------
-- Chủ app: "lễ tân mà có role quản sinh thì phải chấm công theo ca đã đăng
-- ký", "còn lại các trường hợp lễ tân gắn với role khác thì để ko chấm công
-- như thường". Nên miễn trừ giờ đọc cờ mới VÀ vai trò gốc.
create or replace function public.find_late_checkin_shifts()
returns table (shift_id uuid, profile_id uuid, full_name text, start_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.assignee_id, p.full_name, s.start_at
  from public.shifts s
  join public.profiles p on p.id = s.assignee_id
  where s.late_checkin_notified_at is null
    and now() > s.start_at + interval '15 minutes'
    and now() < s.end_at + interval '2 hours'
    and not (p.covers_reception and p.role <> 'student_affairs')
    and not exists (select 1 from public.attendance a where a.shift_id = s.id);
$$;

create or replace function public.find_stale_checkout_sessions()
returns table (attendance_id uuid, profile_id uuid, full_name text, check_in_at timestamptz, shift_id uuid)
language sql stable security definer set search_path = public as $$
  select a.id, a.profile_id, p.full_name, a.check_in_at, a.shift_id
  from public.attendance a
  join public.profiles p on p.id = a.profile_id
  left join public.shifts s on s.id = a.shift_id
  where a.check_out_at is null
    and a.stale_checkout_notified_at is null
    and not (p.covers_reception and p.role <> 'student_affairs')
    and (
      (a.shift_id is null and now() > a.check_in_at + interval '30 minutes')
      or (a.shift_id is not null and now() > s.end_at + interval '15 minutes')
    );
$$;
