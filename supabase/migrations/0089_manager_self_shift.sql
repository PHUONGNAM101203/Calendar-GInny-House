-- Quản lý tự xếp ca cho chính mình.
--
-- group_permissions là nơi duy nhất quyết định "ai xếp ca được cho ai", và cả
-- ba tầng đều đọc nó: danh sách nhân viên trong hộp Tạo ca (canCreateShiftFor,
-- components/calendar/ShiftCalendar.tsx), chốt phía server
-- (assertAssigneeAllowed, lib/shift-guards.ts), và RLS của bảng shifts
-- (can_manage_shift_for, 0048). Thiếu một dòng là tắc cả ba.
--
-- HR tự xếp ca cho mình được chỉ vì 'hr' tình cờ nằm trong danh sách
-- target_role hợp lệ. 'coo' và 'training_director' không nằm trong đó, nên
-- Giám Đốc Đào Tạo mở "Tạo ca làm việc" chỉ thấy team giáo viên chứ không thấy
-- chính mình.
--
-- Nới danh sách target thay vì thêm ngoại lệ "tự mình" vào can_manage_shift_for:
-- hàm ấy là SECURITY DEFINER đứng sau RLS của bảng shifts, sửa nó là chạm vào
-- chốt an toàn nhạy nhất của app, và muốn an toàn thì lại phải chép thêm một
-- danh sách vai trò cứng nữa vào SQL. Ở đây mô hình phân quyền vốn đã diễn đạt
-- được điều này, chỉ bị một CHECK chặn. Nới xong thì ma trận phân quyền trong
-- /manager cũng hiện thêm hai cột đó, nên lần sau tự cấp được, không cần
-- migration nữa.
alter table public.group_permissions
  drop constraint group_permissions_target_valid;

alter table public.group_permissions
  add constraint group_permissions_target_valid check (
    target_role in (
      'teacher',
      'collaborator',
      'student_affairs',
      'teaching_assistant',
      'operations_staff',
      'customer_care',
      'hr',
      'coo',
      'training_director'
    )
  );

-- Chỉ cấp đúng quyền tự xếp ca cho chính vai trò mình. Không cấp chéo: HR vẫn
-- không xếp ca được cho Giám Đốc Đào Tạo, và ngược lại — muốn vậy thì vào ma
-- trận phân quyền tick thêm, đó là quyết định của người quản trị chứ không
-- phải thứ nên gài sẵn trong migration.
insert into public.group_permissions (manager_role, target_role, permission)
values
  ('coo', 'coo', 'create_shift'),
  ('training_director', 'training_director', 'create_shift')
on conflict do nothing;
