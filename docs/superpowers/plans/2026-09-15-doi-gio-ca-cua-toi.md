# Đổi giờ ca của chính mình — Implementation Plan

**Goal:** Cho nhân viên xin đổi khung giờ của ca mình đang giữ (giữ nguyên
người) qua đúng đường ống duyệt của đăng ký ca, thay vì phải huỷ ca rồi
đăng ký lại.

**Architecture:** Không dựng đường ống thứ hai. Một đơn xin đổi giờ ca
*chính là* "một khung ca đề xuất đang chờ người duyệt đăng ký ca duyệt" —
đúng nghĩa một dòng `shift_requests`. Thêm `replaces_shift_id` để phân biệt:
NULL = đăng ký ca mới (như hôm nay), NOT NULL = đổi giờ ca đó. Khác biệt duy
nhất nằm ở *việc duyệt làm gì*: hôm nay INSERT một ca mới, với đơn đổi giờ
thì UPDATE khung giờ của ca đã nêu.

Đổi lấy được miễn phí: người duyệt (`can_approve_shift_request`) và RLS của
nó, danh sách chờ duyệt bên quản lý, sự kiện bóng mờ "Chờ duyệt" trên lịch
(sẽ hiện ngay tại *khung giờ mới* — đúng thứ cần nhìn), hai kind thông báo
`shift_request_approved`/`rejected`, và cả huỷ/xoá/khôi phục.

## Global Constraints

- Mọi chuỗi hiển thị bằng tiếng Việt; định danh code bằng tiếng Anh.
- `types/index.ts` viết tay — migration đổi hình bảng thì phải sửa song song.
- `supabase db push` bắn thẳng production, không có staging.
- Xác minh: `npx tsc --noEmit`, `npm run lint`, `npm run build` — repo không
  có bộ test nào.

## Phạm vi cố ý bỏ ra ngoài

- **Không đổi vai trò ca (QS/LT) trong form này.** Ca giữ nguyên
  `covering_role` gốc. Đổi vai trò là quyết định khác (nó động tới luật
  một-suất-quản-sinh), không trộn vào việc đổi giờ.
- **Không đổi người** — đó đã là dạng 1 sẵn có.
- **Ca đã bắt đầu hoặc đã có chấm công thì không đổi được** — dữ liệu công đã
  bám vào khung giờ cũ.

---

### Task 1: Migration 0086 — cột, index, RPC

**Files:** Create `supabase/migrations/0086_shift_time_change_request.sql`

**Produces:** `request_shift_change(...)`; cột `replaces_shift_id`,
`prev_start_at`, `prev_end_at`, `prev_branch_id`; sửa
`respond_to_shift_request` và `revert_shift_request`.

- [ ] Step 1: Thêm 4 cột + index một-đơn-chờ-mỗi-ca.

`prev_*` chỉ ghi lúc duyệt đơn đổi giờ. Không có ba cột này thì
`revert_shift_request` không biết trả ca về đâu — với đơn đăng ký mới nó chỉ
cần xoá ca, còn đơn đổi giờ thì ca vẫn phải tồn tại.

```sql
create unique index if not exists shift_requests_one_pending_change
  on public.shift_requests (replaces_shift_id)
  where replaces_shift_id is not null and status = 'pending';
```

Không có ràng buộc này thì duyệt hai đơn liên tiếp sẽ dời ca hai lần và
`prev_*` của đơn sau ghi đè đơn trước, khiến khôi phục trả về sai khung giờ.

- [ ] Step 2: `request_shift_change` — chốt theo đúng thứ tự của
  `request_shift_swap`: chưa đăng nhập / ca phải của chính mình / ca chưa bắt
  đầu / giờ kết thúc sau giờ bắt đầu / khung mới ở tương lai / phải chọn cơ sở
  / phải thuộc cơ sở đó (hoặc Remote) / ca chưa có chấm công / ca chưa có đơn
  đổi giờ đang chờ / ca không đang có yêu cầu đổi ca chờ duyệt.

  Chốt cuối quan trọng: nếu ca đang chờ đổi cho người khác mà lại dời giờ,
  người nhận sẽ nhận một khung giờ khác với lúc họ đồng ý.

  Đơn kế thừa `shift_type` và `covering_role` từ chính ca gốc.

- [ ] Step 3: `respond_to_shift_request` rẽ nhánh. Đơn đăng ký mới INSERT như
  cũ. Đơn đổi giờ: khoá ca gốc `for update`, kiểm lại (còn tồn tại / vẫn của
  người gửi / chưa bắt đầu / chưa chấm công), ghi `prev_*`, rồi UPDATE khung
  giờ + cơ sở.

  Không đụng `shift_request_id` của ca — cột đó trỏ về đơn đã *tạo* ra ca,
  ghi đè sẽ làm hỏng khôi phục của chính đơn ấy.

  `shifts_no_overlap`, `trg_student_affairs_single_slot` và
  `shifts_reception_assignee` đều chạy trên UPDATE (đã xác minh trên
  production), nên luật trùng giờ và luật một-suất-quản-sinh tự giữ ở đây,
  không chép lại.

- [ ] Step 4: `revert_shift_request` rẽ nhánh — đơn đổi giờ thì trả `prev_*`
  về ca chứ không xoá ca (ca ấy có từ trước đơn này), với cùng bộ chốt: ca còn
  đó, vẫn của người gửi, chưa có chấm công. Xoá `prev_*` khi đưa đơn về pending.

- [ ] Step 5: `supabase db push --linked`, xác minh bằng
  `information_schema.columns` chứ không tin dòng "push finished".

- [ ] Step 6: Commit.

---

### Task 2: Tầng TypeScript — type, zod, server action

**Files:** `types/index.ts`, `lib/validations/shift-request.ts`,
`actions/shift-requests.ts`

- [ ] Step 1: `ShiftRequest` nhận 4 trường mới (`replaces_shift_id`,
  `prev_start_at`, `prev_end_at`, `prev_branch_id`), đều `string | null`.

- [ ] Step 2: `shiftChangeSchema` — `shift_id`, `date`, `start_time`,
  `end_time`, `branch_id`, `note` (tối đa 280 ký tự). Thông báo lỗi tiếng Việt.

- [ ] Step 3: `requestShiftChangeAction` theo đúng khuôn `requestShiftAction`:
  `requireProfile()` → `safeParse` → `vietnamInstant()` dựng hai mốc (qua đêm
  thì cộng một ngày vào mốc kết thúc) → `rpc("request_shift_change", …)` →
  `mapShiftRpcError` → `revalidateShiftRequestPaths()` → `after(() =>
  sendPushToShiftRequestApprovers(...))` với copy "Yêu cầu đổi giờ ca".

  Không dùng `parse()` để dựng mốc thời gian — runtime chạy UTC, xem memory
  `custom-event-times-shift-seven-hours`.

- [ ] Step 4: Bổ sung mọi câu lỗi mới của RPC vào `SHIFT_RPC_MESSAGES`, nếu
  không chúng sẽ bị `fallback` nuốt thành câu chung chung.

- [ ] Step 5: `npx tsc --noEmit`. Commit.

---

### Task 3: Form "Đổi giờ ca của tôi"

**Files:** `components/swaps/SwapRequestDialog.tsx`,
`components/shifts/ShiftDetailDialog.tsx` (truyền `branches` xuống)

- [ ] Step 1: Hai tab cấp trên — `[ Đổi cho người khác ] [ Đổi giờ ca của tôi ]`.
  Trong tab đầu giữ nguyên hai lựa chọn hiện có (Nhường ca mở / Đổi với đồng
  nghiệp) dưới dạng segmented nhỏ hơn. Không đổi hành vi nào của luồng cũ.

- [ ] Step 2: Tab mới — `DatePickerField` cho ngày, hai `Select` giờ từ
  `lib/time-options.ts`, `Select` cơ sở, `Textarea` lý do. Điền sẵn
  ngày/giờ/cơ sở của chính ca đang mở, để người dùng chỉ sửa phần cần sửa.

  Ghi chú dưới form: "Yêu cầu sẽ được gửi tới quản lý duyệt. Ca vẫn là của
  bạn, chỉ đổi khung giờ."

- [ ] Step 3: Enter để gửi, theo khuôn các form đã làm.

- [ ] Step 4: tsc + lint + build. Commit.

---

### Task 4: Hiển thị phía duyệt và trên lịch

**Files:** `lib/calendar.ts`, `components/shifts/ShiftRequestCard.tsx`,
`components/calendar/ShiftRequestDetailDialog.tsx`, `actions/shift-requests.ts`

- [ ] Step 1: `toShiftRequestPendingEvents` đặt tiêu đề `Chờ đổi giờ · <tên>`
  khi `replaces_shift_id` khác null. Sự kiện vốn đã vẽ tại `start_at`/`end_at`
  của đơn — tức đúng khung giờ *mới* đang xin, là thứ người duyệt cần nhìn.

- [ ] Step 2: Thẻ đơn bên quản lý thêm nhãn "Đổi giờ ca". Hiện cả khung cũ →
  khung mới nếu join được ca gốc mà không làm phình truy vấn `/manager` và
  `/calendar`; nếu không, chỉ hiện khung mới + nhãn, và ghi rõ lựa chọn đó ở
  đây chứ không im lặng cắt.

- [ ] Step 3: `respondToShiftRequestAction` đổi title/body theo
  `replaces_shift_id`: "Yêu cầu đổi giờ ca đã được duyệt" / "… bị từ chối".
  Giữ nguyên hai kind cũ — chúng vẫn mô tả đúng sự việc, và chuông không map
  icon theo kind.

- [ ] Step 4: tsc + lint + build. Commit, push, xác minh deploy bằng
  commit-status + `?dpl=` (memory `verify-vercel-deploys-by-dpl-token`).

---

## Verification

1. `npx tsc --noEmit`, `npm run lint`, `npm run build` — sạch.
2. Tài khoản quản sinh: mở ca tương lai của mình → tab "Đổi giờ ca của tôi" →
   đổi khung giờ → gửi. Kỳ vọng: bóng mờ "Chờ đổi giờ" tại khung giờ MỚI, ca
   gốc vẫn nguyên chỗ cũ.
3. Gửi đơn thứ hai cho cùng ca đó → bị chặn với đúng câu tiếng Việt.
4. Tài khoản quản lý duyệt → ca gốc nhảy sang khung mới, đơn rời danh sách
   chờ, người gửi nhận thông báo "đổi giờ ca đã được duyệt".
5. Duyệt một đơn đổi giờ trùng giờ với ca khác của chính người đó →
   `shifts_no_overlap` chặn, câu lỗi ra tiếng Việt, không lộ tên constraint.
6. Tài khoản Kỹ thuật khôi phục đơn vừa duyệt → ca trở về khung giờ cũ.
