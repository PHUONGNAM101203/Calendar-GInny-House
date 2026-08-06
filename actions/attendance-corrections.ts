"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { attendanceCorrectionSchema, correctionPreviewSchema } from "@/lib/validations/attendance-correction";
import type { ActionResult, Attendance, Shift } from "@/types";

export type CorrectionPreview =
  | { kind: "no_shift" }
  | { kind: "no_discrepancy" }
  | { kind: "missed_check_in"; shift: Pick<Shift, "id" | "start_at" | "end_at"> }
  | { kind: "late_check_in"; shift: Pick<Shift, "id" | "start_at" | "end_at">; actualCheckInAt: string };

function mapAttendanceCorrectionError(message: string): string {
  const known = [
    "Không tìm thấy ca làm việc này",
    "Đã quá hạn 2 ngày để giải trình ca này",
    "Ca này không có sai lệch cần giải trình",
    "Ca này đã có đơn giải trình đang chờ duyệt",
    "Vui lòng nhập lý do giải trình",
    "Chỉ quản lý mới được duyệt đơn giải trình công",
    "Bạn không có quyền duyệt đơn của nhân viên này",
    "Đơn giải trình công không hợp lệ hoặc đã được xử lý",
    "Không thể huỷ đơn này",
  ];
  return known.find((m) => message.includes(m)) ?? "Không thể xử lý đơn giải trình công";
}

function revalidateAttendanceCorrectionPaths() {
  revalidatePath("/attendance/explain");
  revalidatePath("/manager");
}

export async function requestAttendanceCorrectionAction(input: unknown): Promise<ActionResult> {
  await requireProfile();
  const parsed = attendanceCorrectionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_attendance_correction", {
    p_shift_id: parsed.data.shift_id,
    p_reason: parsed.data.reason,
  });

  if (error) return { ok: false, error: mapAttendanceCorrectionError(error.message) };

  revalidateAttendanceCorrectionPaths();
  return { ok: true, data: undefined };
}

export async function respondToAttendanceCorrectionAction(
  id: string,
  approve: boolean
): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_to_attendance_correction", {
    p_id: id,
    p_approve: approve,
  });

  if (error) return { ok: false, error: mapAttendanceCorrectionError(error.message) };

  revalidateAttendanceCorrectionPaths();
  return { ok: true, data: undefined };
}

export async function cancelAttendanceCorrectionAction(id: string): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_attendance_correction", { p_id: id });

  if (error) return { ok: false, error: mapAttendanceCorrectionError(error.message) };

  revalidateAttendanceCorrectionPaths();
  return { ok: true, data: undefined };
}

// Deliberate exception to "actions only mutate" — see design spec §5. The
// submit form needs a live preview as the user picks an arbitrary date;
// there's no other established idiom in this codebase for a client-driven
// ad hoc read (no API routes, no client-side Supabase query pattern for
// this).
export async function getAttendanceCorrectionPreviewAction(
  input: unknown
): Promise<ActionResult<CorrectionPreview>> {
  const profile = await requireProfile();
  const parsed = correctionPreviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const dayStart = `${parsed.data.date}T00:00:00+07:00`;
  const dayEnd = `${parsed.data.date}T23:59:59+07:00`;

  const { data: shifts } = await supabase
    .from("shifts")
    .select("id, start_at, end_at")
    .eq("assignee_id", profile.id)
    .gte("start_at", dayStart)
    .lte("start_at", dayEnd)
    .limit(1);

  const shift = ((shifts as Pick<Shift, "id" | "start_at" | "end_at">[]) ?? [])[0];
  if (!shift) {
    return { ok: true, data: { kind: "no_shift" } };
  }

  const { data: attendanceRows } = await supabase
    .from("attendance")
    .select("*")
    .eq("profile_id", profile.id)
    .gte("check_in_at", dayStart)
    .lte("check_in_at", dayEnd)
    .order("check_in_at", { ascending: false })
    .limit(1);

  const attendance = ((attendanceRows as Attendance[]) ?? [])[0];
  if (!attendance) {
    return { ok: true, data: { kind: "missed_check_in", shift } };
  }
  if (attendance.check_in_at > shift.start_at) {
    return { ok: true, data: { kind: "late_check_in", shift, actualCheckInAt: attendance.check_in_at } };
  }
  return { ok: true, data: { kind: "no_discrepancy" } };
}
