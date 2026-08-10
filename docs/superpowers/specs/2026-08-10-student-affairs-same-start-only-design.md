# Nới luật "1 quản sinh / ca": chỉ chặn khi trùng giờ bắt đầu

## Context

`0037_student_affairs_single_slot.sql` đặt ra luật: mỗi cơ sở chỉ 1 quản sinh
(`student_affairs`) trực một ca. Luật được cài bằng phép **chồng lấn khoảng
thời gian** (`tstzrange(...) && tstzrange(...)`), nghĩa là chỉ cần 2 ca giao
nhau 1 phút là ca sau bị chặn.

Thực tế vận hành làm lộ ra chỗ quá chặt: ca sáng 04:00–07:30 và ca chiều
07:00–10:00 (bàn giao 30 phút) là lịch hoàn toàn bình thường, nhưng hệ thống
từ chối tạo ca thứ hai với lỗi "Ca này đã có đăng ký quản sinh".

Ngoài ra, tính năng **nhiệm vụ trong ca** (`shifts.duty_role`,
`0052_shift_duty_role.sql`) vừa ship làm lộ thêm một chỗ lệch: hàm kiểm tra
vẫn đọc `profiles.role` (vai trò chính), nên một người kiêm nhiệm Quản sinh +
Trợ giảng đang làm ca với nhiệm vụ "Trợ giảng" vẫn bị tính là chiếm suất quản
sinh — sai với ý nghĩa của `duty_role`.

**Hai quyết định đã chốt với người dùng:**

1. Luật mới: **chỉ chặn khi 2 ca quản sinh có cùng giờ bắt đầu** (`start_at`
   trùng khít) ở cùng cơ sở. Mọi kiểu chồng lấn khác đều cho phép — kể cả ca
   nằm trọn bên trong ca khác, miễn khác giờ bắt đầu.
2. Ca của người kiêm nhiệm mang nhiệm vụ "Trợ giảng" **không** chiếm suất
   quản sinh. Tính theo nhiệm vụ ca (`duty_role`), rơi về vai trò chính khi ca
   không có nhiệm vụ riêng.

## Thiết kế

Luật nằm gọn trong một hàm Postgres với đúng 2 nơi gọi, nên đây là thay đổi
**thuần SQL** — không có logic TypeScript nào phản chiếu luật này (chỉ có
chuỗi thông báo lỗi, xem mục cuối).

### Migration `0053_student_affairs_same_start_only.sql`

#### 1. `student_affairs_slot_taken()` — đổi 2 điều kiện, giữ nguyên chữ ký

Nhánh `shifts`:

```sql
select 1 from public.shifts s
join public.profiles p on p.id = s.assignee_id
where coalesce(s.duty_role, p.role) = 'student_affairs'
  and s.branch_id = p_branch_id
  and s.start_at = p_start_at
  and (p_exclude_shift_id is null or s.id <> p_exclude_shift_id)
```

Nhánh `shift_requests` (đơn đang chờ duyệt) đổi y hệt, dùng `r.duty_role`,
`r.profile_id`, `r.start_at`, giữ nguyên `r.status = 'pending'`.

**Chữ ký hàm đổi** (`DROP` rồi tạo lại): bỏ `p_end_at` vì luật mới không còn
nhìn giờ kết thúc, và thêm `p_exclude_profile_id` (xem lỗi (b) bên dưới).
Không thể dùng `create or replace` để đổi số tham số — Postgres định danh hàm
theo tên + kiểu tham số, nên làm vậy chỉ tạo thêm một overload và để lại bản
cũ vẫn chạy luật cũ. Cả 2 nơi gọi đều được viết lại trong cùng migration, và
đã rà soát không còn nơi nào khác gọi hàm này.

### Hai lỗi của luật cũ, phát hiện khi rà soát — sửa luôn trong migration này

Cả hai đều nằm trong chính đoạn code đang được viết lại, và đều đã được **kiểm
chứng thực tế trên database production** trước khi sửa.

**(a) Đơn đăng ký ca của quản sinh KHÔNG BAO GIỜ duyệt được.**
`respond_to_shift_request()` insert vào `shifts` **trước**, rồi mới đổi status
đơn sang `approved`. Nên lúc trigger chạy, đơn nguồn vẫn còn `pending` và tự
khớp với chính nó trong nhánh kiểm `shift_requests` → luôn báo trùng suất.
Lỗi này có từ `0037`, không phải do thay đổi lần này sinh ra, nhưng luật mới
làm nó thành chắc chắn xảy ra thay vì tình cờ. Sửa bằng tham số mới
`p_exclude_profile_id`: trigger truyền `new.assignee_id`, `request_shift`
truyền `v_uid` — loại trừ chính người đang được xét. Cách này cũng đúng với
câu thông báo, vốn nói "đã có quản sinh **khác**", chứ không phải "có bất kỳ
dòng nào".

**(b) `request_shift()` tin tưởng `p_duty_role` thô do client gửi.**
Hàm là `security definer` và cấp cho mọi tài khoản đã đăng nhập. Trigger
`shift_requests_validate_duty_role` chỉ dọn giá trị sai ở bước `INSERT`, tức
là **sau** khi cổng chặn đã chạy. Nếu cổng chặn đọc giá trị thô: một quản sinh
chỉ cần gửi `p_duty_role='teacher'` là `coalesce` ra `'teacher'`, thoát hoàn
toàn luật trùng suất, rồi trigger dọn về `null` và dòng lưu xuống vẫn là một
đơn quản sinh. Chiều ngược lại cũng sai — một giáo viên gửi
`p_duty_role='student_affairs'` sẽ bị chặn oan. Sửa bằng cách tự dọn
`p_duty_role` vào biến `v_duty` theo đúng luật của trigger **trước** khi kiểm
tra, rồi ghi chính `v_duty` xuống, để cổng chặn và giá trị được lưu luôn khớp
nhau.

Kèm theo, thêm một lớp chặn ở tầng Server Action (`assertAssigneeAllowed`
trong `actions/shifts.ts` và `requestShiftAction` trong
`actions/shift-requests.ts`): nhiệm vụ ca phải là 1 trong 2 vai trò của chính
người đó, nếu không thì báo lỗi rõ ràng thay vì âm thầm bỏ giá trị. Zod chỉ
chặn được giá trị ngoài 3 nhiệm vụ hợp lệ, nó không biết người được xếp là ai.

### Vá thêm: lỗ ba trị NULL trong 2 trigger `duty_role` của `0052`

`0052` viết `new.duty_role not in (v_role, v_secondary)`. Với người **chỉ có 1
vai trò**, `v_secondary` là `NULL`, nên biểu thức rút gọn thành
`TRUE and NULL` = `NULL` — không phải `TRUE` — nên nhánh tự dọn không bao giờ
chạy, và một `duty_role` sai hoàn toàn vẫn được ghi vào DB. Hệ quả nặng nhất
là lệch phân quyền: một giáo viên thuần mang `duty_role='student_affairs'` sẽ
khiến các đơn gắn với ca đó định tuyến sang HR thay vì GĐ đào tạo. Sửa bằng
`is distinct from` (an toàn với `NULL`) trong cả `validate_shift_duty_role` và
`validate_shift_request_duty_role`. Đã kiểm tra: hiện chưa có dòng nào có
`duty_role` khác `NULL`, nên không cần dọn dữ liệu cũ.

#### 2. `enforce_student_affairs_single_slot()` — cổng chặn hiểu nhiệm vụ ca

```sql
select role into v_role from public.profiles where id = new.assignee_id;
if coalesce(new.duty_role, v_role) = 'student_affairs' and public.student_affairs_slot_taken(
  new.branch_id, new.start_at, new.end_at, new.id, null
) then
  raise exception 'Đã có quản sinh khác trực ca bắt đầu cùng giờ này' using errcode = '23505';
end if;
```

Không tạo lại trigger `trg_student_affairs_single_slot` — chỉ thay thân hàm,
trigger trỏ theo tên hàm nên tự dùng bản mới.

**Thứ tự trigger là một phụ thuộc thật, cần giữ:** trên bảng `shifts` hiện có
2 trigger BEFORE INSERT/UPDATE — `shifts_validate_duty_role` (0052) và
`trg_student_affairs_single_slot` (0037). Postgres chạy trigger cùng loại
theo **thứ tự chữ cái của tên trigger**, nên `shifts_validate_duty_role` chạy
trước (`s` < `t`). Điều đó là đúng và cần thiết: hàm đó có thể tự dọn
`new.duty_role := null` khi giá trị không khớp vai trò của người được xếp, và
cổng chặn quản sinh phải đọc giá trị **sau khi đã dọn**. Không đổi tên 2
trigger này.

#### 3. `request_shift()` — cùng cách xử lý cho đường tự đăng ký

```sql
select role into v_role from public.profiles where id = v_uid;
if coalesce(p_duty_role, v_role) = 'student_affairs' and public.student_affairs_slot_taken(
  p_branch_id, p_start_at, p_end_at, null, null
) then
  raise exception 'Đã có quản sinh khác trực ca bắt đầu cùng giờ này' using errcode = '23505';
end if;
```

Chép nguyên thân bản `0052` đang chạy (bản có tham số `p_duty_role`), chỉ đổi
đúng dòng cổng chặn và câu thông báo. Nếu bỏ qua bước này, người kiêm nhiệm
gửi đơn đăng ký ca với nhiệm vụ "Trợ giảng" vẫn bị chặn oan ngay từ lúc gửi
đơn, dù trigger phía `shifts` đã đúng.

### Thông báo lỗi

`"Ca này đã có đăng ký quản sinh"` → `"Đã có quản sinh khác trực ca bắt đầu
cùng giờ này"`, cho khớp luật mới (câu cũ gây hiểu nhầm là cả khung giờ bị
chiếm).

Cần cập nhật đồng thời 3 chỗ ở tầng TypeScript — đây là các allowlist dịch
lỗi, nếu quên thì thông báo mới sẽ rơi vào nhánh fallback chung chung:

- `actions/shifts.ts` → `mapShiftError()`
- `actions/shift-requests.ts` → `mapShiftRequestError()`
- `actions/shift-requests.ts` → mảng `SHIFT_RPC_MESSAGES`

## Không đổi (ngoài phạm vi)

- Ràng buộc `shifts_no_overlap` (một người không tự trùng ca với chính mình)
  giữ nguyên — đó là luật khác, áp cho mọi vai trò.
- Không có luật tương tự cho vai trò nào khác; không thêm mới.
- `duty_role` và toàn bộ luồng duyệt đơn theo nhiệm vụ ca (0052) không đổi.
- Không có trigger trên `shift_requests` cho luật này (chỉ kiểm trong RPC) —
  giữ nguyên thiết kế đó.

## Xác minh

Theo cách đã dùng suốt dự án: tài khoản test qua `auth.admin.createUser`,
thao tác qua anon client để đi đúng đường RLS/RPC thật, xoá sạch sau khi xong.
Lưu ý chọn khung giờ ở cơ sở test không đụng dữ liệu quản sinh có sẵn (dữ liệu
thật trên nhánh dev đã từng gây dương tính giả khi kiểm thử tính năng 0052).

- [ ] **Ca lỗi gốc**: quản sinh A 04:00–07:30, quản sinh B 07:00–10:00, cùng
      cơ sở → tạo được cả hai.
- [ ] **Trùng giờ bắt đầu**: 2 quản sinh cùng `start_at` → ca thứ hai bị chặn,
      đúng thông báo mới.
- [ ] **Nằm trọn bên trong**: ca 09:00–11:00 bên trong ca 08:00–12:00, khác
      giờ bắt đầu → tạo được.
- [ ] **Kiêm nhiệm làm Trợ giảng**: người QS+TG, `duty_role='teaching_assistant'`,
      trùng giờ bắt đầu với 1 quản sinh khác → tạo được.
- [ ] **Kiêm nhiệm làm Quản sinh**: cùng người đó, `duty_role='student_affairs'`,
      trùng giờ bắt đầu → bị chặn.
- [ ] **Sửa ca (UPDATE)**: đổi ghi chú/giờ kết thúc mà giữ nguyên giờ bắt đầu
      → không tự chặn chính nó (`p_exclude_shift_id` vẫn hoạt động).
- [ ] **Đơn chờ duyệt cũng chiếm chỗ**: 1 đơn `pending` trùng giờ bắt đầu →
      vẫn chặn ca mới, đúng như trước.
- [ ] **Cả 2 đường ghi**: quản lý xếp ca trực tiếp (`createShiftAction` →
      trigger) và nhân viên tự đăng ký (`request_shift` RPC).
- [ ] **Hồi quy vai trò khác**: giáo viên/trợ giảng xếp ca chồng giờ tuỳ ý,
      hoàn toàn không bị luật này đụng tới.
- [ ] **Lỗi (a) đã sửa**: quản sinh gửi đơn đăng ký ca → quản lý duyệt được.
- [ ] **Lỗi (b) đã sửa**: quản sinh gửi `duty_role='teacher'` vào một suất đã
      có quản sinh khác → vẫn bị chặn; giáo viên gửi
      `duty_role='student_affairs'` → không bị chặn oan.
- [ ] **Lỗ NULL đã vá**: `duty_role` sai trên người 1 vai trò → tự dọn về
      `null`; người kiêm nhiệm gửi `duty_role` lạ → bị chặn, đòi chọn lại.
- [ ] `npx tsc --noEmit` + `npm run lint` + `npm run build` sạch; dọn tài
      khoản test.

### File sẽ sửa

- `supabase/migrations/0053_student_affairs_same_start_only.sql` (mới)
- `actions/shifts.ts`, `actions/shift-requests.ts` (chỉ chuỗi thông báo lỗi)
