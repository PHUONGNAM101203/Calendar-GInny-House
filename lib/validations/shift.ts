import { z } from "zod";

export const SHIFT_TYPES = ["morning", "afternoon", "evening", "remote"] as const;
export const DUTY_ROLES = ["teacher", "student_affairs", "teaching_assistant"] as const;

export const shiftSchema = z
  .object({
    assignee_id: z.uuid("Vui lòng chọn nhân viên"),
    branch_id: z.uuid("Vui lòng chọn cơ sở"),
    start_at: z.string().min(1, "Vui lòng chọn giờ bắt đầu"),
    end_at: z.string().min(1, "Vui lòng chọn giờ kết thúc"),
    shift_type: z.enum(SHIFT_TYPES, "Vui lòng chọn loại ca"),
    duty_role: z.enum(DUTY_ROLES).nullish(),
    note: z.string().max(280, "Ghi chú tối đa 280 ký tự").optional(),
  })
  .refine((v) => new Date(v.end_at) > new Date(v.start_at), {
    message: "Giờ kết thúc phải sau giờ bắt đầu",
    path: ["end_at"],
  });
export type ShiftInput = z.infer<typeof shiftSchema>;
