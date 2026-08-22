"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canManageAttendanceFor } from "@/lib/roles";
import { getGroupPermissions } from "@/lib/permissions-server";
import {
  emitNotifications,
  formatShiftWindow,
  formatVietnamMoment,
} from "@/lib/notifications-emit";
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

// The row as the permission check and the notification copy both need it.
// Read once, before the mutation: these are the values the staff member is
// being told changed, and re-reading afterwards would describe the new state
// (or, for a delete, nothing at all).
type ManageableAttendanceRow = {
  profile_id: string;
  check_in_at: string;
  check_out_at: string | null;
};

// Two-step lookup (not a join) — an embedded profiles() select infers as an
// array without generated Supabase types, matching the pattern already used
// in actions/shifts.ts's assertBranchAllowed().
async function loadManageableAttendanceRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  viewerRole: Role,
  attendanceId: string
): Promise<ManageableAttendanceRow | null> {
  const { data: row } = await supabase
    .from("attendance")
    .select("profile_id, check_in_at, check_out_at")
    .eq("id", attendanceId)
    .single<ManageableAttendanceRow>();
  if (!row) return null;

  const { data: target } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", row.profile_id)
    .single();
  if (!target) return null;

  const permissions = await getGroupPermissions();
  return canManageAttendanceFor(viewerRole, target.role, permissions) ? row : null;
}

// "08:00–12:00 ngày 22/08/2026", or the check-in alone when the session was
// never closed. Baked into the stored body so the notification still names
// the right session after the row it describes has been edited or deleted.
function formatAttendanceWindow(checkInAt: string, checkOutAt: string | null): string {
  return checkOutAt
    ? formatShiftWindow(checkInAt, checkOutAt)
    : `${formatVietnamMoment(checkInAt)} (chưa có giờ ra)`;
}

export async function updateAttendanceAction(
  id: string,
  input: { check_in_at: string; check_out_at: string | null }
): Promise<ActionResult> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const row = await loadManageableAttendanceRow(supabase, profile.role, id);
  if (!row) {
    return { ok: false, error: "Bạn không có quyền sửa chấm công này" };
  }

  const { error } = await supabase
    .from("attendance")
    .update({ check_in_at: input.check_in_at, check_out_at: input.check_out_at })
    .eq("id", id);

  if (error) return { ok: false, error: "Không thể cập nhật chấm công" };

  revalidateAttendanceManagePaths();
  // This changes the hours the person is paid for, so they are told what it
  // was and what it became. ceo/technical may manage their own row
  // (canManageAttendanceFor returns true for any target), so skip the
  // self-edit — nobody needs "your attendance was edited" for their own
  // click. See actions/leave.ts's requestLeaveAction for why after() is used.
  if (row.profile_id !== profile.id) {
    const before = formatAttendanceWindow(row.check_in_at, row.check_out_at);
    const now = formatAttendanceWindow(input.check_in_at, input.check_out_at);
    after(() =>
      emitNotifications([
        {
          profileId: row.profile_id,
          kind: "attendance_updated",
          title: "Chấm công của bạn đã được sửa",
          body: `${profile.full_name} đã sửa chấm công ${before} của bạn thành ${now}.`,
          url: "/attendance",
          relatedId: id,
        },
      ])
    );
  }
  return { ok: true, data: undefined };
}

export async function deleteAttendanceAction(id: string): Promise<ActionResult> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const row = await loadManageableAttendanceRow(supabase, profile.role, id);
  if (!row) {
    return { ok: false, error: "Bạn không có quyền xoá chấm công này" };
  }

  const { error } = await supabase.from("attendance").delete().eq("id", id);
  if (error) return { ok: false, error: "Không thể xoá chấm công" };

  revalidateAttendanceManagePaths();
  // Same reasoning as updateAttendanceAction: the deleted session is hours
  // they no longer get paid for. The window has to come from the pre-delete
  // read — after the delete there is nothing left to describe.
  if (row.profile_id !== profile.id) {
    const window = formatAttendanceWindow(row.check_in_at, row.check_out_at);
    after(() =>
      emitNotifications([
        {
          profileId: row.profile_id,
          kind: "attendance_deleted",
          title: "Chấm công của bạn đã bị xoá",
          body: `${profile.full_name} đã xoá bản ghi chấm công ${window} của bạn.`,
          url: "/attendance",
          relatedId: id,
        },
      ])
    );
  }
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
