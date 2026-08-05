import { z } from "zod";
import { SELF_SIGNUP_ROLES } from "@/lib/roles";

// Trim + lowercase before the actual email-format check, so " Foo@Bar.com "
// and "foo@bar.com" are treated as the same address everywhere (matching,
// Supabase's own auth.users lookup, which is case-insensitive on email).
const emailField = z.string().trim().toLowerCase().pipe(z.email("Email không hợp lệ"));

// Real password rules, not just "6 characters" — length plus a mix of
// case and digits, matching what Supabase's own auth actually enforces at
// minimum and what a reasonable employee-facing app should require.
const passwordField = z
  .string()
  .min(8, "Mật khẩu tối thiểu 8 ký tự")
  .regex(/[a-z]/, "Mật khẩu cần ít nhất 1 chữ thường")
  .regex(/[A-Z]/, "Mật khẩu cần ít nhất 1 chữ hoa")
  .regex(/[0-9]/, "Mật khẩu cần ít nhất 1 chữ số");

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Vui lòng nhập mật khẩu"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    full_name: z.string().min(2, "Vui lòng nhập họ tên"),
    email: emailField,
    password: passwordField,
    confirm_password: z.string(),
    branch_id: z.uuid("Vui lòng chọn cơ sở"),
    role: z.enum(SELF_SIGNUP_ROLES, "Vui lòng chọn vai trò"),
  })
  .refine((v) => v.password === v.confirm_password, {
    message: "Mật khẩu xác nhận không khớp",
    path: ["confirm_password"],
  });
export type RegisterInput = z.infer<typeof registerSchema>;
