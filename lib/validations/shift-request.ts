import { z } from "zod";
import { SHIFT_TYPES } from "@/lib/validations/shift";

export const shiftRequestSchema = z
  .object({
    // Optional: ca remote không gắn với cơ sở thật nào — actions/shift-requests.ts
    // tự điền branch_id = cơ sở ảo "Remote" (0066_remote_branch.sql) khi
    // thiếu và shift_type === "remote". Bắt buộc lại cho mọi loại ca khác
    // qua refine bên dưới.
    branch_id: z.uuid("Vui lòng chọn cơ sở").optional(),
    start_at: z.string().min(1, "Vui lòng chọn giờ bắt đầu"),
    end_at: z.string().min(1, "Vui lòng chọn giờ kết thúc"),
    shift_type: z.enum(SHIFT_TYPES, "Vui lòng chọn loại ca"),
    // Vai trò của ca được đăng ký. "" = theo vai trò gốc của người đăng ký, và
    // actions/shift-requests.ts đổi thành null ở ranh giới RPC. Chỉ hiện trên
    // form với người có kiêm lễ tân — xem shiftSchema cho cùng lý do, và
    // shift_requests_covering_role_valid (0085) cho giới hạn ở tầng DB.
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
export type ShiftRequestInput = z.infer<typeof shiftRequestSchema>;
