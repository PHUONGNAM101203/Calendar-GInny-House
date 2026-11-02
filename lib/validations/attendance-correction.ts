import { z } from "zod";

export const attendanceCorrectionSchema = z.object({
  shift_id: z.uuid("Vui lòng chọn ca cần giải trình"),
  // Giờ ra khai luôn trong đơn giờ vào. Bắt buộc ở tầng RPC khi phiên chưa có
  // giờ ra — để trống chính là lỗ hổng cũ: duyệt xong còn lại một phiên mở
  // không ai đóng, và báo cáo tính nó chạy tới tận bây giờ. Optional ở đây vì
  // khi phiên đã có giờ ra thì bỏ trống nghĩa là giữ nguyên.
  check_out_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Giờ ra không hợp lệ")
    .optional(),
  reason: z
    .string()
    .trim()
    .min(1, "Vui lòng nhập lý do giải trình")
    .max(500, "Lý do tối đa 500 ký tự"),
});
export type AttendanceCorrectionInput = z.infer<typeof attendanceCorrectionSchema>;

// One submit can cover several shifts at once (each row validated the same
// way as a single-shift request) — see AttendanceCorrectionForm.tsx's
// repeatable rows.
export const attendanceCorrectionsSchema = z
  .array(attendanceCorrectionSchema)
  .min(1, "Vui lòng thêm ít nhất một ca cần giải trình");
export type AttendanceCorrectionsInput = z.infer<typeof attendanceCorrectionsSchema>;

// Check-out giải trình. Unlike the check-in schema, the user supplies the
// corrected time, so it is validated here as well as in the RPC — the RPC
// stays the authoritative gate, since it is the only side that can see the
// actual check-in time to compare against.
export const checkoutCorrectionSchema = z.object({
  shift_id: z.uuid("Vui lòng chọn ca cần giải trình"),
  check_out_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Giờ ra không hợp lệ"),
  reason: z
    .string()
    .trim()
    .min(1, "Vui lòng nhập lý do giải trình")
    .max(500, "Lý do tối đa 500 ký tự"),
});
export type CheckoutCorrectionInput = z.infer<typeof checkoutCorrectionSchema>;

// Giải trình giờ ra của một phiên chấm công TỰ DO (trợ giảng, không gắn ca).
// Neo theo attendance_id chứ không theo shift_id — phiên này không có ca. Giờ ra
// là giờ treo tường "HH:mm"; mốc tuyệt đối do server dựng từ giờ vào của phiên,
// không nhận từ client (xem resolveCheckOutInstant).
export const sessionCorrectionSchema = z.object({
  attendance_id: z.uuid("Vui lòng chọn phiên chấm công cần giải trình"),
  // Giờ vào đề nghị — chỉ gửi khi người dùng THẬT SỰ đổi giờ vào (chấm vào muộn
  // rồi khai lại). Bỏ trống là chỉ sửa giờ ra, đúng hành vi của 0093.
  check_in_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Giờ vào không hợp lệ")
    .optional(),
  check_out_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Giờ ra không hợp lệ"),
  reason: z
    .string()
    .trim()
    .min(1, "Vui lòng nhập lý do giải trình")
    .max(500, "Lý do tối đa 500 ký tự"),
});
export type SessionCorrectionInput = z.infer<typeof sessionCorrectionSchema>;

export const correctionPreviewSchema = z.object({
  date: z.string().min(1, "Vui lòng chọn ngày"),
  // Set once the user disambiguates a date carrying more than one shift.
  shift_id: z.uuid().optional(),
});
export type CorrectionPreviewInput = z.infer<typeof correctionPreviewSchema>;
