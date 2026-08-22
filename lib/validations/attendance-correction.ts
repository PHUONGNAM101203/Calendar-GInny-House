import { z } from "zod";

export const attendanceCorrectionSchema = z.object({
  shift_id: z.uuid("Vui lòng chọn ca cần giải trình"),
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

export const correctionPreviewSchema = z.object({
  date: z.string().min(1, "Vui lòng chọn ngày"),
  // Set once the user disambiguates a date carrying more than one shift.
  shift_id: z.uuid().optional(),
});
export type CorrectionPreviewInput = z.infer<typeof correctionPreviewSchema>;
