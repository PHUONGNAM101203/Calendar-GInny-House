"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { groupPermissionUpdateSchema } from "@/lib/validations/group-permissions";
import type { ActionResult } from "@/types";

function mapGroupPermissionError(message: string): string {
  if (message.includes("row-level security policy") || message.includes("permission denied")) {
    return "Bạn không có quyền chỉnh sửa mục này";
  }
  return "Không thể cập nhật quyền, vui lòng thử lại";
}

export async function updateGroupPermissionAction(input: unknown): Promise<ActionResult> {
  const profile = await requireProfile();
  if (profile.role !== "technical") {
    return { ok: false, error: "Chỉ tài khoản kỹ thuật mới chỉnh sửa được mục này" };
  }

  const parsed = groupPermissionUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const { manager_role, target_role, permission, granted } = parsed.data;

  const { error } = granted
    ? await supabase.from("group_permissions").insert({ manager_role, target_role, permission })
    : await supabase.from("group_permissions").delete().match({ manager_role, target_role, permission });

  if (error) {
    return { ok: false, error: mapGroupPermissionError(error.message) };
  }

  revalidatePath("/calendar");
  revalidatePath("/manager");
  revalidatePath("/leave");
  revalidatePath("/attendance");
  return { ok: true, data: undefined };
}
