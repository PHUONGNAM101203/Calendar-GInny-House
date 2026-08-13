# Khôi phục trạng thái đơn (Kỹ thuật) — Design

## Context

Bốn loại đơn trong hệ thống — nghỉ phép (`leave_requests`), đăng ký ca
(`shift_requests`), đổi ca (`shift_swap_requests`), giải trình công
(`attendance_corrections`) — đều theo cùng một khuôn: trạng thái
`pending → {approved/accepted | rejected | cancelled}`, và mọi RPC xử lý đơn
(`respond_to_*`, `cancel_*`) đều khoá cứng bằng điều kiện
`WHERE status = 'pending'`. Một khi đã duyệt/từ chối/huỷ, **không có đường
quay lại** — người dùng chỉ có thể tạo đơn mới. Không có trigger nào trên 4
bảng này gây hệ quả phụ ngoài chính RPC.

Người dùng muốn: khi Kỹ thuật (`role = 'technical'`) lỡ bấm nhầm (huỷ, từ
chối, hoặc **cả duyệt nhầm**), có thể đưa đơn về lại `pending` — **chỉ đổi
trạng thái, giữ nguyên nội dung đơn**. Chỉ Kỹ thuật thấy/dùng được tính năng
này.

## Vấn đề cốt lõi: duyệt không chỉ đổi trạng thái

Khảo sát kỹ 4 RPC duyệt (`respond_to_leave_request` tại
`supabase/migrations/0013_group_scoped_visibility.sql:55-90`,
`respond_to_shift_request`/`respond_to_swap_request`/
`respond_to_attendance_correction` tại
`supabase/migrations/0055_revert_shift_duty_role.sql`) cho thấy:

| Loại đơn | Hệ quả khi duyệt | Lần lại được không? |
|---|---|---|
| Nghỉ phép | Không có gì khác ngoài đổi `status` | Có — tầm thường |
| Đăng ký ca | `INSERT` 1 dòng mới vào `shifts` | **Không** — `shifts` không có cột trỏ ngược về `shift_requests.id` |
| Đổi ca | `UPDATE shifts.assignee_id` cho 1-2 ca có sẵn; **tự động huỷ** các đơn đổi ca khác đang chờ mà đụng 2 ca đó | Có, qua `requester_shift_id`/`target_shift_id` sẵn có — nhưng các đơn bị huỷ dây chuyền **không** tự khôi phục lại |
| Giải trình công — "chấm trễ" | `UPDATE attendance.check_in_at` trên dòng có sẵn | Có — `attendance_corrections.attendance_id` + `.actual_check_in_at` đã lưu sẵn giá trị cũ |
| Giải trình công — "quên chấm vào" | `INSERT` 1 dòng mới vào `attendance` | **Không** — dòng mới tạo không được lưu `id` lại ở đâu cả |

Vì vậy tính năng này **không thể** là một RPC mỏng gọi ngược `UPDATE status`
— cần bổ sung 2 cột liên kết để việc khôi phục chính xác, không đoán mò, và
cần guard chặn khôi phục khi dữ liệu liên quan đã bị động vào sau khi duyệt.

## Phạm vi

- Áp dụng cho cả 4 loại đơn.
- Khôi phục từ **bất kỳ trạng thái nào** (`approved`/`accepted`, `rejected`,
  `cancelled`) về lại `pending`.
- **Chỉ đổi trạng thái + hoàn tác hệ quả phụ (nếu có)** — không cho sửa nội
  dung đơn (ngày giờ, lý do...) trong lần này.
- Chỉ `role = 'technical'` được thấy nút và gọi được RPC — kiểm tra ngay
  trong RPC (lớp bảo vệ thật), action TS chỉ để UX sớm.
- **Không tự khôi phục dây chuyền** các đơn đổi ca bị huỷ tự động khi 1 đơn
  đổi ca khác được chấp nhận — người liên quan tạo lại đơn mới nếu cần. Việc
  này đã được xác nhận với người dùng khi trình bày thiết kế.

## Thay đổi schema

Migration mới (`0057_revert_request_status.sql`):

```sql
-- Truy vết ca nào được tạo ra từ đơn đăng ký ca nào
alter table public.shifts
  add column if not exists shift_request_id uuid references public.shift_requests(id) on delete set null;
```

`attendance_corrections.attendance_id` đã tồn tại sẵn (dùng cho kiểu
`late_check_in`) — RPC `respond_to_attendance_correction` sẽ được sửa để,
với kiểu `missed_check_in`, `INSERT ... RETURNING id INTO ...` rồi
`UPDATE attendance_corrections SET attendance_id = <id vừa tạo>` ngay trong
cùng giao dịch duyệt. Từ đó `attendance_id` được lấp đầy cho **cả 2 kiểu**,
và logic khôi phục chỉ cần một nhánh chung theo `issue_type`.

## RPC mới — 1 cho mỗi loại đơn

Tất cả theo cùng khuôn, `security definer`, kiểm tra vai trò ngay đầu hàm:

```sql
if (select role from public.profiles where id = auth.uid()) <> 'technical' then
  raise exception 'Chỉ Kỹ thuật mới có thể khôi phục đơn';
end if;
```

### `revert_leave_request(p_id uuid)`

Không có hệ quả phụ nào cần hoàn tác — chỉ:

```sql
update public.leave_requests
set status = 'pending', responder_id = null, resolved_at = null
where id = p_id and status <> 'pending'
returning * into v_row;
if not found then raise exception 'Đơn không hợp lệ hoặc đang chờ duyệt'; end if;
```

### `revert_shift_request(p_id uuid)`

Nếu đơn đang ở trạng thái `approved`: tìm ca đã tạo qua
`shifts.shift_request_id = p_id`. **Guard an toàn:** nếu ca đó đã có bản ghi
`attendance` (đã chấm công) hoặc đã bị đổi ca đi nơi khác (không còn khớp
`assignee_id` gốc — dùng `shift_requests.profile_id` để so), chặn khôi phục
với thông báo rõ ràng ("Ca đã có chấm công/đã đổi ca — không thể khôi phục
tự động"). Nếu an toàn: `DELETE` ca đó, rồi mới:

```sql
update public.shift_requests
set status = 'pending', responder_id = null, resolved_at = null
where id = p_id and status <> 'pending'
returning * into v_row;
```

### `revert_swap_request(p_id uuid)`

Nếu đang `accepted`: đổi `assignee_id` trên `requester_shift_id`/
`target_shift_id` (lấy từ `shift_swap_requests.requester_id`/`.target_id`
sẵn có trên chính dòng đó — không cần bảng lịch sử) trở lại giá trị gốc.
**Guard an toàn:** nếu `assignee_id` hiện tại của 1 trong 2 ca không còn
đúng như hệ quả của lần chấp nhận này (đã bị đổi tiếp bởi 1 giao dịch khác
sau đó), chặn khôi phục. Sau đó:

```sql
update public.shift_swap_requests
set status = 'pending', responder_id = null, resolved_at = null
where id = p_id and status <> 'pending'
returning * into v_row;
```

Không đụng tới các đơn đổi ca khác từng bị huỷ dây chuyền — giữ nguyên theo
phạm vi đã chốt.

### `revert_attendance_correction(p_id uuid)`

Nếu đang `approved`: dùng `attendance_corrections.attendance_id` (giờ đã
lấp đầy cho cả 2 kiểu) —
- `late_check_in`: `UPDATE attendance SET check_in_at = actual_check_in_at WHERE id = attendance_id`.
- `missed_check_in`: `DELETE FROM attendance WHERE id = attendance_id`.

**Guard an toàn:** nếu bản ghi `attendance` đã có `check_out_at` (đã chấm ra
rồi) hoặc đã bị 1 đơn giải trình công khác sửa tiếp sau đó, chặn khôi phục.
Sau đó:

```sql
update public.attendance_corrections
set status = 'pending', responder_id = null, resolved_at = null
where id = p_id and status <> 'pending'
returning * into v_row;
```

## Lớp Actions (`actions/*.ts`)

Mỗi file (`leave.ts`, `shift-requests.ts`, `swaps.ts`,
`attendance-corrections.ts`) thêm 1 action `revert*Action(id)`:
`requireProfile()` → gọi RPC tương ứng → map lỗi Postgres sang tiếng Việt
(thêm case mới vào `map*Error` sẵn có của từng file) → `revalidatePath`
đúng các path hiện có (`/leave`, `/swaps`, `/manager`, `/attendance/explain`)
→ trả `ActionResult`.

## UI

Nút **"Khôi phục"** thêm vào cả 4 Card
(`LeaveRequestCard`/`ShiftRequestCard`/`SwapRequestCard`/
`AttendanceCorrectionCard`), theo đúng vị trí/khuôn của nút Huỷ hiện có —
prop mới `canRevert: boolean`, hiển thị khi `canRevert && status !== "pending"`.

Chỉ truyền `canRevert={true}` từ **`StaffRequestsDetailDialog`**
(`components/manager/StaffRequestsDetailDialog.tsx`) — nơi duy nhất hiện
liệt kê đủ mọi trạng thái đơn của 1 nhân viên — và chỉ khi
`profile.role === "technical"` (dialog nhận thêm prop
`canRevert: boolean`, do trang cha `/manager` tính sẵn rồi truyền xuống).
Các Card ở nơi khác (`/leave`, `/swaps`, trang chính `/manager`) tiếp tục
truyền `canRevert={false}` — không đổi hành vi hiện tại ở đó.

## Xác minh

Theo đúng phương pháp đã dùng suốt các tính năng trước trong phiên này: tài
khoản test qua `auth.admin.createUser`, thao tác qua **anon client** để đi
đúng đường RLS/RPC thật, dọn sạch trong `finally`.

- Role không phải `technical` gọi RPC `revert_*` trực tiếp → bị chặn.
- Nghỉ phép: huỷ/từ chối/duyệt nhầm → khôi phục → về đúng `pending`, nội
  dung (ngày, lý do) giữ nguyên.
- Đăng ký ca: duyệt → có ca thật trong `shifts` → khôi phục → ca bị xoá,
  đơn về `pending`.
- Đăng ký ca: duyệt → ca đã có chấm công → khôi phục → bị chặn với thông
  báo rõ ràng, ca và chấm công không đổi.
- Đổi ca (nhường ca 1 chiều và đổi 2 chiều): chấp nhận → khôi phục →
  `assignee_id` về đúng người cũ trên đúng ca; đơn đổi ca khác từng bị huỷ
  dây chuyền vẫn giữ nguyên `cancelled` (đúng phạm vi đã chốt).
- Giải trình công "chấm trễ": duyệt → khôi phục → `check_in_at` về đúng giá
  trị cũ.
- Giải trình công "quên chấm vào": duyệt → có bản ghi `attendance` mới →
  khôi phục → bản ghi bị xoá, đơn về `pending`.
- Giải trình công: bản ghi `attendance` đã có `check_out_at` → khôi phục →
  bị chặn.
- UI: đăng nhập Kỹ thuật, mở `StaffRequestsDetailDialog` của 1 nhân viên →
  thấy nút "Khôi phục" trên đơn không phải `pending`; đăng nhập role khác
  (vd. `training_director`) → không thấy nút.
- Hồi quy: `npx tsc --noEmit` + `npm run lint` sạch; các luồng Duyệt/Từ
  chối/Huỷ/Xoá hiện có không đổi hành vi.
