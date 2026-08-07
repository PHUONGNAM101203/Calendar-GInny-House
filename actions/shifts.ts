"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth";
import { shiftSchema } from "@/lib/validations/shift";
import { isManagerRole } from "@/lib/roles";
import type { ActionResult } from "@/types";

// Defense in depth — ShiftFormDialog's picker already narrows options to
// the assignee's branches, but a manager could still bypass the client. A
// management-tier assignee has no profile_branches rows by design and is
// exempt (they cover every branch), matching that convention everywhere
// else in the app.
async function assertBranchAllowed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  assigneeId: string,
  branchId: string
): Promise<string | null> {
  const { data: assignee } = await supabase.from("profiles").select("role").eq("id", assigneeId).single();
  if (!assignee) return "Không tìm thấy nhân viên này";
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
  return "Không thể lưu ca làm việc";
}

export async function createShiftAction(input: unknown): Promise<ActionResult> {
  await requireManager();
  const parsed = shiftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();

  const branchError = await assertBranchAllowed(supabase, parsed.data.assignee_id, parsed.data.branch_id);
  if (branchError) return { ok: false, error: branchError };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("shifts").insert({
    assignee_id: parsed.data.assignee_id,
    branch_id: parsed.data.branch_id,
    start_at: parsed.data.start_at,
    end_at: parsed.data.end_at,
    shift_type: parsed.data.shift_type,
    note: parsed.data.note || null,
    created_by: user!.id,
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
  await requireManager();
  const parsed = shiftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();

  const branchError = await assertBranchAllowed(supabase, parsed.data.assignee_id, parsed.data.branch_id);
  if (branchError) return { ok: false, error: branchError };

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
