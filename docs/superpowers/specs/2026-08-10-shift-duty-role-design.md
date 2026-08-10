# Nhiệm vụ trong ca (shift duty role) cho nhân viên kiêm nhiệm

## Context

Migration `0051` (session trước) thêm `profiles.secondary_role` cho đúng 2 cặp
kiêm nhiệm: Giáo viên+Trợ giảng, Quản sinh+Trợ giảng. Phê duyệt đơn khi đó vẫn
đi theo vai trò CHÍNH của người đó (không đổi), vì `secondary_role` chỉ là
nhãn hiển thị/nhóm lọc.

Nhu cầu mới: khi xếp một CA CỤ THỂ cho người kiêm nhiệm, cần biết ca đó họ làm
với tư cách gì (Giáo viên hay Trợ giảng, Quản sinh hay Trợ giảng) — vừa để
hiển thị rõ ràng trên lịch, vừa để 3 loại đơn gắn trực tiếp với ca đó (đăng ký
ca, đổi ca, giải trình công) được duyệt bởi đúng người quản lý phụ trách
nhiệm vụ đó, thay vì luôn theo vai trò chính.

**Phạm vi đã chốt với người dùng:**
- Chỉ 3 loại đơn gắn với 1 ca cụ thể đổi cách duyệt: đăng ký ca
  (`shift_requests`), đổi ca (`shift_swap_requests`), giải trình công
  (`attendance_corrections`). Đơn nghỉ phép (`leave_requests`) không gắn với
  1 ca cụ thể nào — **giữ nguyên** duyệt theo vai trò chính.
- Ô chọn nhiệm vụ **bắt buộc** phải chọn khi tạo/sửa ca (hoặc đăng ký ca) cho
  người đang kiêm nhiệm.
- Chỉ hiện field này cho người có `secondary_role` khác null — người 1 vai
  trò không thấy field này, hành vi không đổi với họ.

## Thiết kế

### 1. Dữ liệu — migration `0052_shift_duty_role.sql`

```sql
alter table public.shifts add column duty_role public.staff_role;
alter table public.shift_requests add column duty_role public.staff_role;
```

Không dùng CHECK constraint (cần lookup chéo bảng `profiles`) — dùng trigger,
cùng phong cách tự-chữa như `protect_profile_privileges` (0001/0040), cộng
thêm điều kiện bắt buộc:

```sql
create or replace function public.validate_shift_duty_role()
returns trigger language plpgsql as $$
declare
  v_role public.staff_role;
  v_secondary public.staff_role;
begin
  select role, secondary_role into v_role, v_secondary
  from public.profiles where id = new.assignee_id;

  -- Nhiệm vụ không khớp vai trò chính/phụ hiện tại của người được xếp
  -- (vd đổi assignee sang người khác) — tự xoá thay vì chặn cả câu lệnh.
  if new.duty_role is not null and new.duty_role not in (v_role, v_secondary) then
    new.duty_role := null;
  end if;

  if v_secondary is not null and new.duty_role is null then
    raise exception 'Vui lòng chọn nhiệm vụ trong ca cho nhân viên kiêm nhiệm này';
  end if;

  return new;
end;
$$;

create trigger shifts_validate_duty_role
  before insert or update on public.shifts
  for each row execute function public.validate_shift_duty_role();
```

Hàm tương tự `validate_shift_request_duty_role()` (đọc `new.profile_id` thay
vì `new.assignee_id`) + trigger `shift_requests_validate_duty_role` trên
`shift_requests`.

Ca/đơn cũ tạo trước migration này giữ `duty_role = null` — không bị ép chọn
lại cho tới khi có UPDATE tiếp theo trên chính dòng đó (đúng ý "áp dụng khi
tạo/sửa", không hồi tố).

### 2. Duyệt theo nhiệm vụ của ca — không đổi chữ ký hàm TS

`canApproveShiftRequestFor`/`canApproveSwapRequestFor`/`canApproveLeaveFor`
trong `lib/roles.ts` **giữ nguyên chữ ký** — đơn nghỉ phép tiếp tục gọi y hệt
hiện tại. Chỉ thêm 1 helper:

```ts
// Ca có nhiệm vụ riêng (người kiêm nhiệm) thì dùng nhiệm vụ đó để tính
// quyền duyệt; ca thường (hoặc chưa chọn) thì rơi về vai trò chính, y hệt
// hành vi trước khi có tính năng này.
export function effectiveRole(dutyRole: Role | null, primaryRole: Role): Role {
  return dutyRole ?? primaryRole;
}
```

Tại 3 nhóm call site liên quan tới ca (đăng ký ca, đổi ca, giải trình công),
đổi tham số `targetRole`/`requesterRole` truyền vào từ `row.profile.role`
sang `effectiveRole(row.duty_role, row.profile.role)` (đăng ký ca), hoặc từ
`shift.duty_role` liên quan (đổi ca: `requester_shift.duty_role`/
`target_shift.duty_role`; giải trình công: `correction.shift.duty_role`).
Đơn nghỉ phép — không đổi gì.

**Danh sách call site cần sửa** (đã rà bằng grep, không có chỗ nào khác gọi 3
hàm này):
- `app/(app)/manager/page.tsx`: dòng ~334/336 (`canApproveShiftRequestFor`
  cho đăng ký ca), ~358/365 (`canApproveSwapRequestFor` cho đổi ca), ~412/418
  (`canApproveLeaveFor` áp dụng cho SECTION giải trình công — không phải
  section nghỉ phép ở ~385/391, giữ nguyên section đó).
- `components/calendar/ShiftCalendar.tsx`: dòng ~412, ~615, ~865
  (`canApproveSwapRequestFor`/`canApproveShiftRequestFor` cho sidebar "Cần
  xét duyệt" + dialog); dòng ~599/627/855 là nhánh giải trình công lẫn nghỉ
  phép trong cùng 1 điều kiện gộp — cần tách rõ 2 nhánh để chỉ nhánh giải
  trình công dùng `effectiveRole`.
- `components/calendar/AttendanceDetailDialog.tsx`: dòng ~169
  (`canApproveLeaveFor` cho giải trình công — dùng `correction.shift.duty_role`).
- `lib/calendar.ts`: dòng ~567 (`canApproveSwapRequestFor` khi tính trạng
  thái `pendingSwap: "approvable"` cho 1 ca trên lịch).
- `lib/notifications.ts`: dòng ~99 (badge thông báo đăng ký ca).

`app/(app)/leave/page.tsx` — **không đổi**, chỉ xử lý đơn nghỉ phép.

### 3. SQL mirror — 3 hàm `security definer`

`can_approve_shift_request(p_target_id uuid)` và
`can_approve_swap_request(p_requester_id uuid, p_target_id uuid)` trong
`0048_group_permissions_sql_functions.sql` thêm tham số **cuối, có default
`null`** (không phá call site cũ nào không truyền):

```sql
create or replace function public.can_approve_shift_request(
  p_target_id uuid, p_duty_role public.staff_role default null
)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_ceo() then true
    else exists (
      select 1 from public.group_permissions gp
      where gp.manager_role = (select role from public.profiles where id = auth.uid())
        and gp.target_role = coalesce(p_duty_role, (select role from public.profiles where id = p_target_id))
        and gp.permission = 'approve_shift_request'
    )
  end;
$$;
```

Tương tự cho `can_approve_swap_request` với `p_requester_duty_role`,
`p_target_duty_role`.

Cập nhật 3 call site truyền thêm tham số mới:
- RLS `shift_requests_select` + policy xoá trong `0050` — `duty_role` là cột
  ngay trên chính bảng đang được `using`, truyền thẳng không cần subquery.
- `respond_to_shift_request()` (0048) — truyền `v_req.duty_role`; khi
  `p_approve`, câu `insert into shifts (...)` thêm cột `duty_role` copy từ
  `v_req.duty_role`.
- `respond_to_swap_request()` (0044/0048) — join `shifts` qua
  `requester_shift_id`/`target_shift_id` lấy `duty_role` của từng bên.
- Policy xoá `shift_swap_requests_delete_manager` (0050) — subquery lấy
  `duty_role` từ `shifts` qua 2 cột đó.

`respond_to_attendance_correction()` (0026) — dòng đang gọi
`public.can_view_profile(v_row.profile_id)` đổi thành logic inline (KHÔNG
đụng `can_view_profile()` — hàm đó dùng chung cho nhiều RLS khác, vẫn theo
vai trò chính như cũ):

```sql
declare
  v_duty_role public.staff_role;
begin
  ...
  select duty_role into v_duty_role from public.shifts where id = v_row.shift_id;
  if not (
    (select role from public.profiles where id = auth.uid()) = 'ceo'
    or exists (
      select 1 from public.group_permissions gp
      where gp.manager_role = (select role from public.profiles where id = auth.uid())
        and gp.target_role = coalesce(v_duty_role, (select role from public.profiles where id = v_row.profile_id))
        and gp.permission = 'approve_leave'
    )
  ) then
    raise exception 'Bạn không có quyền duyệt đơn của nhân viên này';
  end if;
```

RLS SELECT/DELETE của `attendance_corrections` (`can_view_profile`) **giữ
nguyên** — đã là chủ đích rộng hơn quyền duyệt thực tế từ trước (xem comment
trong `0026`), không phải chỗ cần sửa.

### 4. Kiểu dữ liệu (`types/index.ts`)

- `Shift` thêm `duty_role: Role | null` — tự động lan vào `ShiftWithAssignee`.
- `ShiftRequest` (base type của `ShiftRequestDetailed`) thêm
  `duty_role: Role | null`.
- Các Pick join cần thêm `"duty_role"`:
  - `SwapRequestDetailed`'s `requester_shift`/`target_shift`
  - `AttendanceCorrectionDetailed`'s `shift`

Các câu `.select()` liên quan (đã rà bằng grep — không sót chỗ nào khác):
`app/(app)/calendar/page.tsx` (`SWAP_SELECT`, select của
`attendance_corrections`), `app/(app)/swaps/page.tsx` (select tương đương),
`app/(app)/manager/page.tsx` (2 chỗ cùng dạng). Các select đang dùng `*` cho
chính bảng `shifts`/`shift_requests` (vd `shifts` trong `calendar/page.tsx`,
`shift_requests` trong `calendar/page.tsx` và `manager/page.tsx`) **tự động**
lấy được cột mới, không cần sửa select string.

### 5. Validation (`lib/validations/`)

`shiftSchema` (`lib/validations/shift.ts`) và `shiftRequestSchema`
(`lib/validations/shift-request.ts`) thêm field tuỳ chọn:

```ts
duty_role: z.enum(["teacher", "student_affairs", "teaching_assistant"]).optional(),
```

Validate "bắt buộc khi kiêm nhiệm" nằm ở tầng Server Action (nơi có sẵn
lookup profile của assignee/requester để biết `secondary_role`), không phải
ở zod schema tĩnh — schema không biết được assignee là ai lúc parse. Trigger
DB (mục 1) là ranh giới thật sự; check ở action chỉ để trả lỗi thân thiện
sớm hơn thay vì lỗi Postgres thô.

`actions/shifts.ts` (`createShiftAction`/`updateShiftAction`) và
`actions/shift-requests.ts` (`requestShiftAction`): sau khi biết assignee/
requester, nếu `secondary_role` khác null mà `duty_role` rỗng → trả lỗi Việt
hoá rõ ràng ("Vui lòng chọn nhiệm vụ trong ca cho nhân viên kiêm nhiệm này")
trước khi gọi Supabase, tránh lộ thông báo lỗi Postgres thô. `mapShiftError`/
`mapShiftRpcError` thêm case bắt message trigger ở trên làm lưới an toàn.

`respond_to_shift_request()`'s `insert into shifts` cần thêm `duty_role`
vào cả cột lẫn giá trị.

### 6. UI

**`ShiftFormDialog.tsx`** (quản lý xếp ca — bất kỳ assignee nào):
- Prop `branchMembers` thêm `"secondary_role"` vào Pick.
- Thêm state `dutyRole`; Select "Nhiệm vụ trong ca" hiện ngay dưới ô chọn
  Nhân viên, **chỉ khi** `selectedAssignee?.secondary_role` khác null, với 2
  lựa chọn = nhãn vai trò chính + nhãn vai trò phụ của người đó
  (`ROLE_LABELS[selectedAssignee.role]`, `ROLE_LABELS[selectedAssignee.secondary_role]`).
- Đổi assignee sang người khác → reset `dutyRole` về rỗng (khớp hành vi
  tự-chữa của trigger, tránh gửi giá trị cũ sai ngữ cảnh).
- Submit: nếu ô hiện ra mà chưa chọn → chặn submit, báo lỗi client-side
  ngay (giống cách `branch_id` báo lỗi hiện tại), không cần đợi round-trip
  server.

**`ShiftRequestDialog.tsx`** (tự đăng ký ca): cùng pattern, nhưng dựa trên
**vai trò của chính người đăng ký** — component cần nhận thêm 2 prop mới
(`currentUserRole`, `currentUserSecondaryRole`) từ `ShiftCalendar.tsx` (nơi
đã có sẵn 2 giá trị này qua `profile`).

**Hiển thị trên lịch** (`lib/calendar.ts`, hàm build `ShiftEvent`, dòng
~583): `title` đổi từ `shift.assignee.full_name` thành
`shift.duty_role ? \`${shift.assignee.full_name} · ${ROLE_LABELS[shift.duty_role]}\` : shift.assignee.full_name`.
Không thêm icon/chip riêng ở `ShiftEventCell.tsx` — text đã đủ rõ và giữ ô
lịch gọn như thiết kế hiện tại (đặc biệt trên điện thoại).

**`ShiftDetailDialog.tsx`**: hiện thêm dòng nhãn nhiệm vụ (nếu có) dưới
`DialogDescription`, dùng `ROLE_LABELS[shift.duty_role]`.

**`ShiftsOverviewTable.tsx`** (bảng ca trong dashboard quản lý): hiện nhãn
nhiệm vụ cạnh tên nếu `duty_role` khác null, cùng convention `· <nhãn>`.

### 7. Không đổi (ngoài phạm vi, nêu rõ để tránh hiểu nhầm khi review)

- Đơn nghỉ phép (`leave_requests`), quyền `manage_attendance` (sửa/xoá công
  đã chấm), quyền `create_shift`/`view_calendar` — không đụng.
- Thông báo đẩy (push): `sendPushToShiftRequestApprovers` đã nhận
  `targetRole` làm tham số nên tự động đúng khi action truyền
  `effectiveRole(...)` vào — không cần sửa `lib/push.ts`. Push cho đổi ca
  (không có sẵn push-to-approver, chỉ push ngang hàng) và giải trình công
  (`sendPushToLeaveApprovers` nhận 1 role cho cả batch nhiều ca, có thể khác
  nhiệm vụ nhau) **giữ nguyên theo vai trò chính** — ranh giới thật vẫn là
  RLS/RPC, push chỉ là nhắc nhở tốt nhất-có-thể (best-effort), không đáng
  đánh đổi thêm phức tạp cho 1 thông báo có thể sai người ở ca hiếm gặp.
- Biểu đồ tròn nhân sự theo vai trò (`TechnicalDashboard.tsx`) — không đụng.

## Xác minh

Theo cách đã dùng suốt dự án: tài khoản test qua `auth.admin.createUser`,
thao tác qua anon client, xoá sạch sau khi xong.

- [ ] Trigger bắt buộc: tạo ca cho 1 người `secondary_role` khác null mà
      không set `duty_role` → lỗi đúng thông báo Việt hoá (qua Server Action,
      không lộ lỗi Postgres thô).
- [ ] Trigger tự-chữa: set `duty_role` không khớp vai trò chính/phụ của
      assignee → tự về `null` (không lỗi, không thành công với giá trị sai).
- [ ] **Đăng ký ca**: tài khoản `teacher+teaching_assistant` đăng ký 1 ca với
      `duty_role='teaching_assistant'` → chỉ `hr` duyệt được (không phải
      `training_director`); đổi `duty_role='teacher'` → ngược lại.
- [ ] **Đổi ca**: 2 ca của cùng 1 người kiêm nhiệm với `duty_role` khác nhau
      → yêu cầu đổi ca của từng ca route đúng theo nhiệm vụ của CA đó, không
      phải vai trò chính cố định.
- [ ] **Giải trình công**: correction gắn với ca có `duty_role` set → đúng
      người quản lý nhiệm vụ đó duyệt được, người còn lại bị chặn.
- [ ] **Đơn nghỉ phép**: hồi quy — vẫn duyệt theo vai trò chính y hệt trước
      khi có tính năng này, không bị ảnh hưởng bởi bất kỳ `duty_role` nào.
- [ ] Ca cũ (tạo trước migration, `duty_role = null`) vẫn duyệt được bình
      thường theo vai trò chính — không có ca nào "kẹt" vì thiếu dữ liệu cũ.
- [ ] UI: `ShiftFormDialog` hiện đúng ô nhiệm vụ chỉ cho người kiêm nhiệm,
      chặn submit khi bỏ trống; đổi assignee reset lựa chọn.
- [ ] UI: `ShiftRequestDialog` — tương tự nhưng theo vai trò người đăng ký.
- [ ] Lịch hiện đúng `· <nhiệm vụ>` trên tên ca khi có `duty_role`.
- [ ] Hồi quy: `ceo`/`technical` vẫn duyệt được mọi thứ không giới hạn.
- [ ] `npx tsc --noEmit` + `npm run lint` sạch; dọn tài khoản test.

### File chính sẽ sửa
- `supabase/migrations/0052_shift_duty_role.sql` (mới)
- `supabase/migrations/0048_group_permissions_sql_functions.sql` (sửa 2 hàm
  qua migration mới, không sửa trực tiếp file cũ)
- `types/index.ts`, `lib/roles.ts`, `lib/calendar.ts`
- `lib/validations/shift.ts`, `lib/validations/shift-request.ts`
- `actions/shifts.ts`, `actions/shift-requests.ts`
- `components/shifts/ShiftFormDialog.tsx`, `ShiftRequestDialog.tsx`,
  `ShiftDetailDialog.tsx`
- `components/manager/ShiftsOverviewTable.tsx`
- `components/calendar/ShiftCalendar.tsx`, `AttendanceDetailDialog.tsx`
- `app/(app)/calendar/page.tsx`, `app/(app)/swaps/page.tsx`,
  `app/(app)/manager/page.tsx`
