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

  // upsert + ignoreDuplicates, not insert: the editor toggles optimistically
  // and fires without awaiting, so a fast double-click can land two grants for
  // the same (manager, target, permission) row. A plain insert would trip the
  // primary key on the second one and surface a spurious error toast that
  // rolls the checkbox back even though the grant is in place. Delete is
  // already idempotent.
  const { error } = granted
    ? await supabase
        .from("group_permissions")
        .upsert({ manager_role, target_role, permission }, {
          onConflict: "manager_role,target_role,permission",
          ignoreDuplicates: true,
        })
    : await supabase.from("group_permissions").delete().match({ manager_role, target_role, permission });

  if (error) {
    return { ok: false, error: mapGroupPermissionError(error.message) };
  }

  // Deliberately NOT revalidating "/manager". Per Next's revalidatePath docs,
  // a Server Function "updates the UI immediately (if viewing the affected
  // path)" — and this action is only ever called FROM /manager, so including
  // it forced a full re-render of that page (~9 parallel Supabase queries)
  // on every single checkbox click, which is what made toggling feel slow.
  // The editor owns its own optimistic state, so the current page needs no
  // server round trip to look correct. The three paths below are the ones
  // that actually consume these permissions, and revalidating them is cheap
  // from here: we aren't viewing them, so they just refresh on next visit.
  revalidatePath("/calendar");
  revalidatePath("/leave");
  revalidatePath("/attendance");
  return { ok: true, data: undefined };
}
