"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth";
import type { ActionResult, Role } from "@/types";

export async function updateStaffBranchesAction(
  profileId: string,
  branchIds: string[]
): Promise<ActionResult> {
  await requireManager();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_profile_branches", {
    p_profile_id: profileId,
    p_branch_ids: branchIds,
  });

  if (error) return { ok: false, error: "Không thể cập nhật cơ sở" };

  revalidatePath("/manager");
  revalidatePath("/calendar");
  return { ok: true, data: undefined };
}

export async function updateStaffRoleAction(
  profileId: string,
  role: Role
): Promise<ActionResult> {
  await requireManager();
  const supabase = await createClient();
  // Same "read the row back" requirement as updateStaffBranchAction above —
  // a manager changing someone else's role also goes through the
  // profiles_update_manager RLS policy, and a bare .update() would silently
  // no-op instead of erroring if that policy were ever missing.
  const { data, error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", profileId)
    .select("id, role")
    .maybeSingle();

  if (error) return { ok: false, error: "Không thể cập nhật vai trò" };
  if (!data || data.role !== role) {
    return {
      ok: false,
      error: "Không có quyền cập nhật vai trò — hãy chắc chắn đã chạy đủ các migration mới nhất",
    };
  }

  revalidatePath("/manager");
  revalidatePath("/calendar");
  return { ok: true, data: undefined };
}
