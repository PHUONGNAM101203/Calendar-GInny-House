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

export const correctionPreviewSchema = z.object({
  date: z.string().min(1, "Vui lòng chọn ngày"),
});
export type CorrectionPreviewInput = z.infer<typeof correctionPreviewSchema>;
