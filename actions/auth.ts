"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "@/lib/validations/auth";
import type { ActionResult } from "@/types";

// Supabase's own error strings are English and not written for end users —
// map the ones actually reachable from signUp()/resend() to Vietnamese;
// anything unrecognized falls back to its raw message rather than hiding it.
function mapSignUpError(message: string): string {
  if (/already registered|already exists/i.test(message)) {
    return "Email này đã được đăng ký. Vui lòng đăng nhập hoặc dùng email khác.";
  }
  if (/password/i.test(message)) {
    return "Mật khẩu không đáp ứng yêu cầu bảo mật của hệ thống.";
  }
  return message;
}

export async function signInAction(input: unknown): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { ok: false, error: "Email hoặc mật khẩu không đúng" };
  }

  redirect("/calendar");
}

export async function signUpAction(input: unknown): Promise<ActionResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const { full_name, email, password, branch_ids, role } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name, branch_ids, role } },
  });

  if (error) {
    return { ok: false, error: mapSignUpError(error.message) };
  }

  // This project has "Confirm email" OFF (mailer_autoconfirm), so signUp()
  // above already authenticated the browser and set the session cookies —
  // send them straight into the app rather than bouncing through /login.
  //
  // An earlier version signed back out here because landing on /calendar
  // crashed on a null profile; that turned out to be an RLS scope mismatch
  // on the calendar's embedded profile relations (fixed in
  // 0028_profile_visible_via_roster.sql), not a not-yet-created profile —
  // handle_new_user() creates the profiles row inside the same transaction
  // as the auth.users insert, so it always exists by the time we get here.
  redirect("/calendar");
}

// Gửi liên kết đặt lại mật khẩu.
//
// LUÔN trả về thành công, kể cả khi email không tồn tại trong hệ thống. Báo
// "email này chưa đăng ký" biến trang quên mật khẩu thành công cụ dò xem ai
// có tài khoản ở đây — với một app nội bộ chứa lịch làm và dữ liệu chấm công
// của nhân viên thì đó là thứ không nên để lộ cho người ngoài.
export async function requestPasswordResetAction(input: unknown): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  // origin lấy từ chính request thay vì biến môi trường: app chạy cả trên
  // domain production lẫn các bản xem trước của Vercel, và một liên kết trỏ
  // sai domain thì bấm vào không đăng nhập được.
  const origin = (await headers()).get("origin");
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=/doi-mat-khau`,
  });

  return { ok: true, data: undefined };
}

// Đặt mật khẩu mới. Chạy được là nhờ /auth/callback đã đổi mã khôi phục lấy
// một phiên đăng nhập trước đó — updateUser sửa mật khẩu của chính phiên
// đang mở, nên không cần và không được nhận id người dùng từ client.
export async function updatePasswordAction(input: unknown): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      error: "Liên kết đặt lại mật khẩu đã hết hạn hoặc đã dùng rồi. Vui lòng gửi lại yêu cầu.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: mapSignUpError(error.message) };

  return { ok: true, data: undefined };
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
