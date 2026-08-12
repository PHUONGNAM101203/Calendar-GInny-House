"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canManageAttendanceFor } from "@/lib/roles";
import { getGroupPermissions } from "@/lib/permissions-server";
import type { ActionResult, Attendance, Role } from "@/types";

function mapAttendanceError(message: string): string {
  if (message.includes("đã chấm công vào rồi")) return "Bạn đã chấm công vào rồi";
  if (message.includes("chưa chấm công vào")) return "Bạn chưa chấm công vào";
  if (message.includes("không có ca làm việc nào")) return "Bạn không có ca làm việc nào trong khung giờ này";
  if (message.includes("Vui lòng chọn cơ sở")) return "Vui lòng chọn cơ sở";
  if (message.includes("không thuộc cơ sở này")) return "Bạn không thuộc cơ sở này";
  return "Không thể ghi nhận chấm công";
}

// branchId is only read when the caller has no matching shift right now —
// see clock_in() (0056): a real matching shift always wins and this value
// is ignored, so passing it for every clock-in (not just the trợ giảng
// no-shift path) is harmless.
export async function clockInAction(branchId?: string): Promise<ActionResult<Attendance>> {
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clock_in", { p_branch_id: branchId ?? null });

  if (error) return { ok: false, error: mapAttendanceError(error.message) };

  revalidatePath("/attendance");
  revalidatePath("/manager");
  return { ok: true, data: data as Attendance };
}

function revalidateAttendanceManagePaths() {
  revalidatePath("/calendar");
  revalidatePath("/manager");
  revalidatePath("/attendance");
}

// Two-step lookup (not a join) — an embedded profiles() select infers as an
// array without generated Supabase types, matching the pattern already used
// in actions/shifts.ts's assertBranchAllowed().
async function canCurrentUserManageAttendanceRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  viewerRole: Role,
  attendanceId: string
): Promise<boolean> {
  const { data: row } = await supabase
    .from("attendance")
    .select("profile_id")
    .eq("id", attendanceId)
    .single();
  if (!row) return false;

  const { data: target } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", row.profile_id)
    .single();
  if (!target) return false;

  const permissions = await getGroupPermissions();
  return canManageAttendanceFor(viewerRole, target.role, permissions);
}

export async function updateAttendanceAction(
  id: string,
  input: { check_in_at: string; check_out_at: string | null }
): Promise<ActionResult> {
  const profile = await requireProfile();
  const supabase = await createClient();

  if (!(await canCurrentUserManageAttendanceRow(supabase, profile.role, id))) {
    return { ok: false, error: "Bạn không có quyền sửa chấm công này" };
  }

  const { error } = await supabase
    .from("attendance")
    .update({ check_in_at: input.check_in_at, check_out_at: input.check_out_at })
    .eq("id", id);

  if (error) return { ok: false, error: "Không thể cập nhật chấm công" };

  revalidateAttendanceManagePaths();
  return { ok: true, data: undefined };
}

export async function deleteAttendanceAction(id: string): Promise<ActionResult> {
  const profile = await requireProfile();
  const supabase = await createClient();

  if (!(await canCurrentUserManageAttendanceRow(supabase, profile.role, id))) {
    return { ok: false, error: "Bạn không có quyền xoá chấm công này" };
  }

  const { error } = await supabase.from("attendance").delete().eq("id", id);
  if (error) return { ok: false, error: "Không thể xoá chấm công" };

  revalidateAttendanceManagePaths();
  return { ok: true, data: undefined };
}

export async function clockOutAction(): Promise<ActionResult<Attendance>> {
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clock_out");

  if (error) return { ok: false, error: mapAttendanceError(error.message) };

  revalidatePath("/attendance");
  revalidatePath("/manager");
  return { ok: true, data: data as Attendance };
}

function mapManualAttendanceError(message: string): string {
  if (message.includes("không có quyền tạo chấm công thủ công")) {
    return "Bạn không có quyền tạo chấm công thủ công";
  }
  if (message.includes("Giờ ra phải sau giờ vào")) return "Giờ ra phải sau giờ vào";
  if (message.includes("không thuộc cơ sở đã chọn")) return "Nhân viên này không thuộc cơ sở đã chọn";
  return "Không thể tạo chấm công thủ công";
}

// Backfill for a missed trợ giảng free (shiftless) clock-in — see
// create_attendance_manual() (0056). Role-gated server-side by the RPC
// itself (technical only); requireProfile() here is just the auth floor.
export async function createAttendanceManualAction(input: {
  profile_id: string;
  branch_id: string;
  check_in_at: string;
  check_out_at: string;
}): Promise<ActionResult<Attendance>> {
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_attendance_manual", {
    p_profile_id: input.profile_id,
    p_branch_id: input.branch_id,
    p_check_in_at: input.check_in_at,
    p_check_out_at: input.check_out_at,
  });

  if (error) return { ok: false, error: mapManualAttendanceError(error.message) };

  revalidateAttendanceManagePaths();
  return { ok: true, data: data as Attendance };
}
