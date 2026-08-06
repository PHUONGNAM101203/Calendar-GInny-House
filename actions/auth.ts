"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loginSchema, registerSchema } from "@/lib/validations/auth";
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

  const { full_name, email, password, branch_id, role } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name, branch_id, role } },
  });

  if (error) {
    return { ok: false, error: mapSignUpError(error.message) };
  }

  // This Supabase project has "Confirm email" OFF, so signUp() above just
  // authenticated the browser — proxy.ts's own rule ("already signed in +
  // on a public path like /login -> bounce to /calendar") would otherwise
  // undo the redirect below and send a brand-new profile straight into
  // /calendar before its data has settled. Sign back out so /login is
  // actually where they land, and they log in explicitly afterward.
  await supabase.auth.signOut();
  redirect("/login?registered=1");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
