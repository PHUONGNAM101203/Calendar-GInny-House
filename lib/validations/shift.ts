import { z } from "zod";

export const SHIFT_TYPES = ["morning", "afternoon", "evening", "remote"] as const;

export const shiftSchema = z
  .object({
    assignee_id: z.uuid("Vui lòng chọn nhân viên"),
    // Optional: ca remote không gắn với cơ sở thật nào — actions/shifts.ts
    // tự điền branch_id = cơ sở ảo "Remote" (0066_remote_branch.sql) khi
    // thiếu và shift_type === "remote". Bắt buộc lại cho mọi loại ca khác
    // qua refine bên dưới.
    branch_id: z.uuid("Vui lòng chọn cơ sở").optional(),
    start_at: z.string().min(1, "Vui lòng chọn giờ bắt đầu"),
    end_at: z.string().min(1, "Vui lòng chọn giờ kết thúc"),
    shift_type: z.enum(SHIFT_TYPES, "Vui lòng chọn loại ca"),
    // Vai trò riêng của ca. "" = theo vai trò gốc của người được gán, và
    // actions/shifts.ts đổi thành null ở ranh giới ghi. Chỉ hiện trên form khi
    // người được chọn có kiêm lễ tân — mọi người khác không thấy dropdown này
    // và trường luôn rỗng. Mirrors the shifts_covering_role_valid CHECK (0085),
    // hẹp có chủ đích: đây không phải hệ thống vai-trò-theo-ca tổng quát.
    covering_role: z.union([z.literal(""), z.literal("receptionist")]).optional(),
    note: z.string().max(280, "Ghi chú tối đa 280 ký tự").optional(),
  })
  .refine((v) => new Date(v.end_at) > new Date(v.start_at), {
    message: "Giờ kết thúc phải sau giờ bắt đầu",
    path: ["end_at"],
  })
  .refine((v) => v.shift_type === "remote" || !!v.branch_id, {
    message: "Vui lòng chọn cơ sở",
    path: ["branch_id"],
  });
export type ShiftInput = z.infer<typeof shiftSchema>;
