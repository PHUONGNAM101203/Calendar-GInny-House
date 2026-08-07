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

export const correctionPreviewSchema = z.object({
  date: z.string().min(1, "Vui lòng chọn ngày"),
});
export type CorrectionPreviewInput = z.infer<typeof correctionPreviewSchema>;
