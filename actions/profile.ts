"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { profileSchema } from "@/lib/validations/profile";
import type { ActionResult } from "@/types";

export async function updateProfileAction(input: unknown): Promise<ActionResult> {
  const profile = await requireProfile();
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: parsed.data.full_name,
      phone: parsed.data.phone || null,
    })
    .eq("id", profile.id);

  if (error) return { ok: false, error: "Không thể cập nhật thông tin" };

  revalidatePath("/account");
  revalidatePath("/manager");
  return { ok: true, data: undefined };
}
