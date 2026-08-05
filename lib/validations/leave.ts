import { z } from "zod";

export const LEAVE_REQUEST_TYPES = ["full_day", "late_arrival", "early_leave", "hourly"] as const;

export const leaveRequestSchema = z
  .object({
    request_type: z.enum(LEAVE_REQUEST_TYPES),
    start_date: z.string().min(1, "Vui lòng chọn ngày bắt đầu"),
    end_date: z.string().min(1, "Vui lòng chọn ngày kết thúc"),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    reason: z.string().max(500, "Lý do tối đa 500 ký tự").optional(),
  })
  .refine((v) => v.end_date >= v.start_date, {
    message: "Ngày kết thúc phải sau ngày bắt đầu",
    path: ["end_date"],
  })
  .refine((v) => v.request_type === "full_day" || v.start_date === v.end_date, {
    message: "Đến muộn / về sớm / nghỉ theo giờ chỉ áp dụng cho 1 ngày",
    path: ["end_date"],
  })
  .refine((v) => v.request_type !== "late_arrival" || Boolean(v.start_time), {
    message: "Vui lòng chọn giờ có mặt",
    path: ["start_time"],
  })
  .refine((v) => v.request_type !== "early_leave" || Boolean(v.end_time), {
    message: "Vui lòng chọn giờ rời đi",
    path: ["end_time"],
  })
  .refine((v) => v.request_type !== "hourly" || Boolean(v.start_time && v.end_time), {
    message: "Vui lòng chọn giờ bắt đầu và kết thúc",
    path: ["start_time"],
  })
  .refine(
    (v) => v.request_type !== "hourly" || !v.start_time || !v.end_time || v.end_time > v.start_time,
    { message: "Giờ kết thúc phải sau giờ bắt đầu", path: ["end_time"] }
  );
export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>;
