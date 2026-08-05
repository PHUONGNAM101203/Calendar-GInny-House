import { z } from "zod";

export const profileSchema = z.object({
  full_name: z.string().min(2, "Vui lòng nhập họ tên"),
  phone: z
    .string()
    .regex(/^[0-9+ ]{8,15}$/, "Số điện thoại không hợp lệ")
    .optional()
    .or(z.literal("")),
});
export type ProfileInput = z.infer<typeof profileSchema>;
