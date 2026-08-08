"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth";
import { shiftSchema } from "@/lib/validations/shift";
import { isManagerRole, canCreateShiftFor } from "@/lib/roles";
import type { ActionResult, Role } from "@/types";

// Defense in depth — ShiftFormDialog's picker already narrows assignee
// options to the caller's group and branch, but a manager could still
// bypass the client. Looks up the assignee's role once and checks both
// group-scoping (canCreateShiftFor) and branch membership off that single
// lookup. A management-tier assignee has no profile_branches rows by design
// and is exempt from the branch check (they cover every branch), matching
// that convention everywhere else in the app.
async function assertAssigneeAllowed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  callerRole: Role,
  assigneeId: string,
  branchId: string
): Promise<string | null> {
  const { data: assignee } = await supabase.from("profiles").select("role").eq("id", assigneeId).single();
  if (!assignee) return "Không tìm thấy nhân viên này";
  if (!canCreateShiftFor(callerRole, assignee.role)) {
    return "Bạn không có quyền xếp ca cho nhân viên này";
  }
  if (isManagerRole(assignee.role)) return null;

  const { data: isMember } = await supabase.rpc("is_branch_member", {
    p_profile_id: assigneeId,
    p_branch_id: branchId,
  });
  return isMember ? null : "Nhân viên này không thuộc cơ sở đã chọn";
}

function mapShiftError(message: string): string {
  if (message.includes("shifts_no_overlap")) {
    return "Nhân viên này đã có ca trùng giờ";
  }
  if (message.includes("shifts_time_valid")) {
    return "Giờ kết thúc phải sau giờ bắt đầu";
  }
  if (message.includes("Nhân viên chưa được gán cơ sở")) {
    return "Nhân viên chưa được gán cơ sở";
  }
  if (message.includes("Ca này đã có đăng ký quản sinh")) {
    return "Ca này đã có đăng ký quản sinh";
  }
  // Safety net if assertAssigneeAllowed's app-level check gets bypassed by a
  // race (assignee's role changed between form-open and submit) — the RLS
  // policy (can_manage_shift_for, 0043) is the real boundary either way.
  if (message.includes("row-level security policy") || message.includes("permission denied")) {
    return "Bạn không có quyền xếp ca cho nhân viên này";
  }
  return "Không thể lưu ca làm việc";
}

export async function createShiftAction(input: unknown): Promise<ActionResult> {
  const manager = await requireManager();
  const parsed = shiftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();

  const assigneeError = await assertAssigneeAllowed(
    supabase,
    manager.role,
    parsed.data.assignee_id,
    parsed.data.branch_id
  );
  if (assigneeError) return { ok: false, error: assigneeError };

  const { error } = await supabase.from("shifts").insert({
    assignee_id: parsed.data.assignee_id,
    branch_id: parsed.data.branch_id,
    start_at: parsed.data.start_at,
    end_at: parsed.data.end_at,
    shift_type: parsed.data.shift_type,
    // manager.id, not a second auth.getUser(). requireManager() above already
    // resolved this identity; re-fetching it cost a full network round-trip to
    // the auth server on every shift creation for a value already in hand. It
    // also removes a `user!` non-null assertion that was only safe by accident.
    created_by: manager.id,
  });

  if (error) return { ok: false, error: mapShiftError(error.message) };

  revalidatePath("/calendar");
  revalidatePath("/manager");
  return { ok: true, data: undefined };
}

export async function updateShiftAction(
  id: string,
  input: unknown
): Promise<ActionResult> {
  const manager = await requireManager();
  const parsed = shiftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();

  const assigneeError = await assertAssigneeAllowed(
    supabase,
    manager.role,
    parsed.data.assignee_id,
    parsed.data.branch_id
  );
  if (assigneeError) return { ok: false, error: assigneeError };

  const { error } = await supabase
    .from("shifts")
    .update({
      assignee_id: parsed.data.assignee_id,
      branch_id: parsed.data.branch_id,
      start_at: parsed.data.start_at,
      end_at: parsed.data.end_at,
      shift_type: parsed.data.shift_type,
      note: parsed.data.note || null,
    })
    .eq("id", id);

  if (error) return { ok: false, error: mapShiftError(error.message) };

  revalidatePath("/calendar");
  revalidatePath("/manager");
  return { ok: true, data: undefined };
}

export async function deleteShiftAction(id: string): Promise<ActionResult> {
  await requireManager();
  const supabase = await createClient();
  const { error } = await supabase.from("shifts").delete().eq("id", id);

  if (error) return { ok: false, error: "Không thể xoá ca làm việc" };

  revalidatePath("/calendar");
  revalidatePath("/manager");
  return { ok: true, data: undefined };
}
