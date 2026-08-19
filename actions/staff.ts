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

// Display/grouping only — never authorization (see lib/roles.ts's
// getRoleLabel comment). The CHECK constraint in migration 0051 is the
// real validation authority; mapStaffSecondaryRoleError translates its
// violation into the one Vietnamese message a manager could actually hit
// through this UI (the checkbox only ever appears for eligible roles, so
// this is a race-condition backstop, not the primary gate).
function mapStaffSecondaryRoleError(message: string): string {
  if (message.includes("profiles_secondary_role_valid_pair")) {
    return "Chỉ Giáo viên hoặc Quản sinh mới có thể kiêm nhiệm Trợ giảng";
  }
  return "Không thể cập nhật vai trò kiêm nhiệm";
}

export async function updateStaffSecondaryRoleAction(
  profileId: string,
  secondaryRole: Role | null
): Promise<ActionResult> {
  await requireManager();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ secondary_role: secondaryRole })
    .eq("id", profileId)
    .select("id, secondary_role")
    .maybeSingle();

  if (error) return { ok: false, error: mapStaffSecondaryRoleError(error.message) };
  if (!data || data.secondary_role !== secondaryRole) {
    return {
      ok: false,
      error: "Không có quyền cập nhật vai trò kiêm nhiệm — hãy chắc chắn đã chạy đủ các migration mới nhất",
    };
  }

  revalidatePath("/manager");
  revalidatePath("/calendar");
  return { ok: true, data: undefined };
}

// Soft-delete only — reversible, keeps every shift/request/attendance row
// intact for history. Login is blocked in requireProfile() (lib/auth.ts),
// not here. Restricted to technical, unlike updateStaffRoleAction/
// updateStaffBranchesAction above which any manager-tier role can call —
// deactivation is a much larger blast radius than a role/branch edit.
export async function deactivateStaffAction(
  profileId: string,
  deactivate: boolean
): Promise<ActionResult> {
  const manager = await requireManager();
  if (manager.role !== "technical") {
    return { ok: false, error: "Chỉ Kỹ thuật mới có quyền vô hiệu hoá tài khoản" };
  }
  if (profileId === manager.id) {
    return { ok: false, error: "Không thể tự vô hiệu hoá tài khoản của chính mình" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ deactivated_at: deactivate ? new Date().toISOString() : null })
    .eq("id", profileId);

  if (error) return { ok: false, error: "Không thể cập nhật trạng thái tài khoản" };

  revalidatePath("/manager");
  return { ok: true, data: undefined };
}
