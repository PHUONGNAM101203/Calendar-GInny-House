# Ca remote không chọn cơ sở · Kiêm lễ tân · Tag trạng thái chấm công

## Context

Ba yêu cầu độc lập, gộp vào 1 spec vì cùng đụng chạm luồng ca làm việc/chấm
công, nhưng triển khai và deploy theo 3 giai đoạn tách biệt — **Giai đoạn 1
(ca remote) deploy trước theo yêu cầu rõ ràng của người dùng**, 2 giai đoạn
sau làm tiếp trong cùng phiên.

1. **Ca remote không cần chọn cơ sở** khi đăng ký/tạo ca — hiện tại
   `shifts.branch_id`/`shift_requests.branch_id` là `not null` ở DB
   (`0001_init.sql`), nên dù `shift_type='remote'` đã tồn tại
   (`0021_shift_type.sql`), người dùng vẫn bị bắt chọn 1 trong 3 cơ sở thật —
   vô nghĩa với ca làm từ xa.
2. **"Kiêm lễ tân"** — vai trò kiêm nhiệm mới cho CSKH (`customer_care`) và
   HR, miễn hoàn toàn chấm công + miễn mọi nhắc nhở liên quan (giống hệt cơ
   chế "Kiêm Trợ giảng" đã có ở `0051_staff_secondary_role.sql`, không phải
   mô hình theo-từng-ca — mô hình đó (`duty_role`, 0052) đã bị revert ở 0055
   vì quá rắc rối, không lặp lại).
3. **Tag trạng thái chấm công thực tế** trong bảng "Ca làm việc" (theo
   ngày/tháng/năm) ở `/manager` — hiện bảng chỉ có Nhân viên/Ngày/Giờ/Cơ
   sở/Loại ca, không có ai biết ca đó thực tế đã chấm công chưa mà không mở
   riêng từng người ra xem.

## Quyết định đã chốt với người dùng

- Ca remote: thêm 1 dòng cơ sở ảo "Remote" trong bảng `branches`, ca remote
  tự động gán vào đó — không sửa RLS, không đụng `/calendar`.
- Kiêm lễ tân: miễn hoàn toàn, mọi lúc (cấp con người, không theo từng ca).
- Tag của ca thuộc người kiêm lễ tân: luôn hiện **"Ca lễ tân"**, không tính
  theo dữ liệu chấm công thật.

---

## Phần 1 — Ca remote không chọn cơ sở (ưu tiên, deploy trước)

### Thiết kế

Thêm 1 dòng thật vào `branches` (`code='REMOTE', name='Remote'`) thay vì làm
`branch_id` nullable — giữ nguyên mọi ràng buộc NOT NULL, mọi RLS
(`shifts_select_branch`, `is_branch_member`...), mọi join `branch:branches!
branch_id(...)` trong toàn bộ codebase, và **không cần đụng vào bất kỳ file
nào trong `components/calendar/`** (route đang khoá).

Cơ sở "Remote" **không** được liệt kê trong `getBranches()` dùng chung (danh
sách cơ sở thật hiển thị ở StaffTable, ShiftFormDialog/ShiftRequestDialog
cho ca không-remote, trang đăng ký tài khoản) — lọc `code <> 'REMOTE'` ngay
tại `lib/branches.ts`. Một hàm mới `getRemoteBranchId()` (cùng file, cache
tương tự) chỉ được gọi ở đúng 2 nơi cần tự động gán: `createShiftAction`/
`updateShiftAction` (`actions/shifts.ts`) và `requestShiftAction`
(`actions/shift-requests.ts`).

**Zod schema** (`lib/validations/shift.ts`, `lib/validations/shift-request.ts`):
`branch_id` thành `z.uuid().optional()`, thêm `.refine()` bắt buộc có
`branch_id` khi `shift_type !== 'remote'` (giữ nguyên thông báo lỗi cũ "Vui
lòng chọn cơ sở", gắn `path: ["branch_id"]`).

**UI** (`components/shifts/ShiftFormDialog.tsx`,
`components/shifts/ShiftRequestDialog.tsx` — cả 2 đều nằm trong
`components/shifts/`, không phải `components/calendar/`, nên không cần mở
khoá gì thêm): field "Cơ sở" chỉ render khi `shiftType !== "remote"`, dùng
đúng state `shiftType` sẵn có đang điều khiển các field khác theo loại ca.

**Server Actions**: khi `shift_type === 'remote'` và `branch_id` không có
trong input, gọi `getRemoteBranchId()` lấy id thật rồi dùng thay
`parsed.data.branch_id` cho phần còn lại của action (insert/update/gọi RPC)
— args gửi lên RPC/insert luôn có branch_id hợp lệ, RPC không cần biết gì về
khái niệm "remote" theo hướng "cho phép null".

`assertAssigneeAllowed()` (`actions/shifts.ts`) bỏ qua bước gọi RPC
`is_branch_member` khi branch đã resolve là cơ sở Remote (không ai thật sự
"thuộc" cơ sở ảo này).

### Migration (SQL) — carve-out cho cơ sở Remote

Một migration mới, `0066_remote_branch.sql`:

```sql
insert into public.branches (code, name, address, color_token, sort_order)
values ('REMOTE', 'Remote', null, 'chart-4', 99)
on conflict (code) do nothing;

create or replace function public.is_remote_branch(p_branch_id uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.branches where id = p_branch_id and code = 'REMOTE'
  );
$$;
grant execute on function public.is_remote_branch(uuid) to authenticated;
```

Rồi patch (CREATE OR REPLACE, giữ nguyên chữ ký, không đổi hành vi gì khác)
4 RPC đang có `is_branch_member(...)` chặn ca/yêu cầu không cùng cơ sở, mỗi
chỗ thêm `or public.is_remote_branch(<branch_id liên quan>)` vào điều kiện
OR đang có sẵn:

- `request_shift()` (0055) — dòng chặn `not is_branch_member(v_uid,
  p_branch_id)`.
- `request_shift_swap()` (0045) — dòng chặn đồng nghiệp không cùng cơ sở
  (`is_branch_member(p_target_id, v_shift.branch_id)`).
- `respond_to_swap_request()` (0055) — dòng chặn người duyệt không thuộc cơ
  sở yêu cầu (`is_branch_member(v_uid, v_req.branch_id)`).
- `create_attendance_manual()` (0056) — dòng chặn nhân viên không thuộc cơ
  sở được chọn khi Kỹ thuật tạo chấm công thủ công.

`clock_in()` (0056) và `respond_to_shift_request()` (0057) **không cần sửa**
— đã xác minh: `clock_in` cho ca có gắn shift không kiểm tra
`is_branch_member` (chỉ copy `branch_id` từ shift), và
`respond_to_shift_request` chỉ copy `branch_id` từ request sang shift mới,
không re-check.

### Xác minh

- Tạo 1 tài khoản test, đăng ký ca `shift_type='remote'` qua UI thật (anon
  client) → không thấy field "Cơ sở", submit thành công, kiểm tra DB thấy
  `branch_id` = id của dòng `code='REMOTE'`.
- Cùng tài khoản, đăng ký ca `shift_type='morning'` → vẫn bắt buộc chọn cơ
  sở như cũ (không regress).
- Manager duyệt đơn ca remote → tạo `shifts` row đúng branch Remote.
- Chấm công vào ca remote đó (`clock_in`) → thành công không cần
  `is_branch_member`.
- Đổi ca (`request_shift_swap`) 1 ca remote cho đồng nghiệp khác cơ sở vật
  lý → không còn bị chặn "Đồng nghiệp không thuộc cơ sở của bạn".
- `getBranches()` ở trang đăng ký tài khoản / StaffTable / ShiftFormDialog
  loại morning-afternoon-evening: vẫn đúng 3 cơ sở thật, không thấy
  "Remote" lẫn vào.
- `npx tsc --noEmit` + `npm run lint` sạch.
- Dọn tài khoản test, deploy `npx vercel deploy --prod`, xác minh
  `curl -sI` 200 + thao tác lại 1 lượt trên production.

---

## Phần 2 — "Kiêm lễ tân" cho CSKH/HR

### Thiết kế

Tổng quát hoá cơ chế secondary_role hiện có (đang hard-code riêng cho
`teaching_assistant`) để chứa được cặp thứ 2, thay vì viết riêng 1 cột mới:

`lib/roles.ts`:
```ts
export const SECONDARY_ROLE_BY_PRIMARY: Partial<Record<Role, Role>> = {
  teacher: "teaching_assistant",
  student_affairs: "teaching_assistant",
  customer_care: "receptionist",
  hr: "receptionist",
};
export const SECONDARY_ROLE_ELIGIBLE_ROLES: ReadonlySet<Role> =
  new Set(Object.keys(SECONDARY_ROLE_BY_PRIMARY) as Role[]);
```
`ROLE_LABELS` thêm `receptionist: "Lễ tân"`. `ROLE_HIERARCHY` **không** thêm
`receptionist` — không cho chọn làm vai trò CHÍNH (giống cách thiết kế ban
đầu chỉ định "kiêm nhiệm", không phải 1 chức danh độc lập).

Một hàm mới, dùng ở cả reminder cron lẫn tag hiển thị (Phần 3):
```ts
export function isReceptionistExempt(profile: { role: Role; secondary_role: Role | null }): boolean {
  return profile.secondary_role === "receptionist";
}
```

### Migration

`0067_receptionist_secondary_role_enum.sql` (enum value phải add ở migration
riêng, không dùng chung transaction với chỗ dùng nó — đúng pattern đã dùng ở
`0017_student_affairs_teaching_assistant_roles.sql`):
```sql
alter type public.staff_role add value if not exists 'receptionist';
```

`0068_receptionist_secondary_role.sql` — tổng quát hoá CHECK constraint và
trigger của `0051_staff_secondary_role.sql` để chấp nhận cả 2 cặp:
```sql
alter table public.profiles drop constraint profiles_secondary_role_valid_pair;
alter table public.profiles add constraint profiles_secondary_role_valid_pair check (
  secondary_role is null
  or (role = 'teacher' and secondary_role = 'teaching_assistant')
  or (role = 'student_affairs' and secondary_role = 'teaching_assistant')
  or (role = 'customer_care' and secondary_role = 'receptionist')
  or (role = 'hr' and secondary_role = 'receptionist')
);

create or replace function public.protect_profile_privileges()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'service_role' or public.is_manager() then
    if new.secondary_role is not null and not (
      (new.role = 'teacher' and new.secondary_role = 'teaching_assistant') or
      (new.role = 'student_affairs' and new.secondary_role = 'teaching_assistant') or
      (new.role = 'customer_care' and new.secondary_role = 'receptionist') or
      (new.role = 'hr' and new.secondary_role = 'receptionist')
    ) then
      new.secondary_role := null;
    end if;
    return new;
  end if;
  new.role := old.role;
  new.secondary_role := old.secondary_role;
  return new;
end;
$$;
```

### Miễn chấm công + miễn thông báo

**Miễn thông báo**: `find_late_checkin_shifts()` và
`find_stale_checkout_sessions()` (0062, patched by 0065) thêm điều kiện loại
trừ hồ sơ có `secondary_role = 'receptionist'` — 1 `join profiles` +
`and p.secondary_role is distinct from 'receptionist'` (dùng `is distinct
from`, không phải `<>`, cùng lý do NULL-trap đã ghi chú ở 0053/0056).

**Miễn chấm công**: không có gì "chặn" chấm công hiện tại ngoài cơ chế nhắc
nhở (đã xác minh: không có ràng buộc DB nào bắt buộc phải có `attendance`
cho 1 `shifts` row) — nên miễn thông báo ở trên đã chính là miễn chấm công
theo đúng nghĩa "không bị nhắc/không bị coi là thiếu". Không thêm gì ở
`ClockWidget.tsx` — người kiêm lễ tân vẫn chấm công được bình thường nếu họ
muốn, chỉ là hệ thống không còn coi việc họ không chấm công là bất thường.

### UI

`components/manager/StaffTable.tsx`'s `RoleAndBranchCells`: checkbox hiện
tại hard-code `"teaching_assistant"` → đổi sang tra `SECONDARY_ROLE_BY_PRIMARY[role]`,
nhãn động `Kiêm ${ROLE_LABELS[SECONDARY_ROLE_BY_PRIMARY[role]!]}` (ra "Kiêm
Trợ giảng" hoặc "Kiêm Lễ tân" tuỳ role, không đổi hành vi cho cặp cũ).

### Xác minh

- CHECK constraint chặn cặp sai (`role='ceo', secondary_role='receptionist'`).
- Tài khoản `role='customer_care'`, tick "Kiêm Lễ tân" → `secondary_role='receptionist'`.
- Tạo 1 ca trễ giờ vào cho tài khoản đó (test qua thao tác thật, không chèn
  SQL tay) → gọi `find_late_checkin_shifts()` → **không** xuất hiện trong
  kết quả (khác với 1 tài khoản CSKH thường bị trễ giờ vẫn xuất hiện).
- `getRoleLabel()` không đổi hành vi cho cặp Trợ giảng cũ (regression).
- `npx tsc --noEmit` + `npm run lint` sạch, dọn tài khoản test.

---

## Phần 3 — Tag trạng thái chấm công trong bảng "Ca làm việc"

### Thiết kế

Hoàn toàn tính ở tầng TypeScript từ dữ liệu đã fetch sẵn (join thêm
`attendance` theo `shift_id` vào query hiện có) — **không cần RPC/migration
mới**, vì đây thuần là hiển thị, không phải nguồn sự thật cho thông báo (đã
tách riêng ở Phần 2).

`SHIFTS_OVERVIEW_SELECT` (`app/(app)/manager/page.tsx`) mở rộng:
```
"id, start_at, end_at, shift_type, " +
"assignee:profiles!assignee_id(id, full_name, role, secondary_role), " +
"branch:branches!branch_id(id, name), " +
"attendance:attendance!shift_id(check_in_at, check_out_at)"
```
(embedded join trả mảng do thiếu generated types, giống comment đã có sẵn ở
file này — lấy phần tử đầu tiên, thực tế tối đa 1 dòng attendance/shift).

`ShiftOverviewRow` (`components/manager/ShiftsOverviewTable.tsx`) thêm
`assignee.secondary_role` và `attendance: { check_in_at: string; check_out_at: string | null }[]`.

Hàm thuần `computeShiftAttendanceTag()` (file mới, nhỏ:
`lib/shift-attendance-tag.ts`, tái dùng được cho cả bảng này) — input
`{ start_at, end_at, attendance: [...], assignee: { secondary_role } }`,
output 1 trong 5 giá trị (kể cả "chưa tới" để không tô nhầm ca tương lai):

| Điều kiện | Tag | Badge variant |
|---|---|---|
| `assignee.secondary_role === 'receptionist'` | Ca lễ tân | `secondary` |
| Không có attendance, `now < start_at + 15p` | *(không hiện tag)* | — |
| Không có attendance, `now >= start_at + 15p` | Chưa chấm công | `destructive` |
| Có `check_in_at`, `check_out_at` null, `now <= end_at + 2h` | Đang trong ca | `default` |
| `check_out_at` không null, HOẶC (`check_out_at` null và `now > end_at + 2h`) | Đã xong ca | `success` |

Ngưỡng `15 phút`/`2 giờ` lấy đúng từ `find_late_checkin_shifts()`/
`find_stale_checkout_sessions()` (0062/0065) để nhất quán với logic nhắc
nhở thật — không phát minh ngưỡng mới.

`ShiftsOverviewTable.tsx` thêm 1 cột "Trạng thái" (badge, giống cột "Loại
ca" hiện có) — cả header (`max-lg:hidden`) và block mobile.

### Xác minh

- Test với 1 tài khoản có ca đã qua giờ, chưa chấm công → tag đỏ "Chưa chấm
  công".
- Chấm công vào → tag "Đang trong ca".
- Chấm công ra → tag xanh "Đã xong ca".
- Tài khoản kiêm lễ tân có ca bất kỳ (kể cả chưa chấm công) → luôn "Ca lễ
  tân", không rơi vào nhánh nào khác.
- Ca tương lai (chưa tới giờ vào) → không hiện tag nào, không báo nhầm
  "Chưa chấm công".
- Responsive: cột mới không vỡ layout mobile (`max-lg:block` như các cột
  khác trong bảng).
- `npx tsc --noEmit` + `npm run lint` sạch, dọn tài khoản test, deploy.
