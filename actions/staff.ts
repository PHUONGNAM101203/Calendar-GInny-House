"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth";
import type { ActionResult, Role } from "@/types";

export async function updateStaffBranchAction(
  profileId: string,
  branchId: string | null
): Promise<ActionResult> {
  await requireManager();
  const supabase = await createClient();
  // .select().maybeSingle() is load-bearing here, not decoration: a plain
  // .update().eq() call reports no error at all when RLS silently matches
  // zero rows (e.g. the manager-write policy from migration 0002 hasn't
  // been applied yet) — it just quietly updates nothing. Without reading
  // the row back, this action would report success on a no-op, which is
  // exactly the "chọn cơ sở xong nó lại tự về Chưa gán" bug: the UI trusts
  // a false "ok: true" and only discovers nothing was saved on next reload.
  const { data, error } = await supabase
    .from("profiles")
    .update({ branch_id: branchId })
    .eq("id", profileId)
    .select("id, branch_id")
    .maybeSingle();

  if (error) return { ok: false, error: "Không thể cập nhật cơ sở" };
  if (!data || data.branch_id !== branchId) {
    return {
      ok: false,
      error: "Không có quyền cập nhật cơ sở — hãy chắc chắn đã chạy đủ các migration mới nhất",
    };
  }

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
