"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, requireManager } from "@/lib/auth";
import {
  attendanceCorrectionsSchema,
  checkoutCorrectionSchema,
  correctionPreviewSchema,
} from "@/lib/validations/attendance-correction";
import { sendPushToLeaveApprovers, sendPushToProfile } from "@/lib/push";
import type { ActionResult, Attendance, Shift } from "@/types";

export type CorrectionPreview =
  | { kind: "no_shift" }
  | { kind: "no_discrepancy" }
  | { kind: "missed_check_in"; shift: Pick<Shift, "id" | "start_at" | "end_at"> }
  | { kind: "late_check_in"; shift: Pick<Shift, "id" | "start_at" | "end_at">; actualCheckInAt: string }
  | {
      kind: "check_out_available";
      shift: Pick<Shift, "id" | "start_at" | "end_at">;
      actualCheckInAt: string;
      // Null when they never clocked out — the correction then supplies the
      // missing time rather than adjusting an existing one.
      actualCheckOutAt: string | null;
    };

// "yyyy-MM-dd" for an ISO instant, in Vietnam time. Intl rather than date-fns
// because this server process has no explicit TZ set (see the comment in
// app/(app)/attendance/page.tsx) — the zone has to be pinned explicitly or a
// late-evening shift resolves to the wrong calendar day.
function formatInVietnamDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function mapAttendanceCorrectionError(message: string): string {
  const known = [
    "Không tìm thấy ca làm việc này",
    "Đã quá hạn 1 tuần để giải trình ca này",
    "Ca này không có sai lệch cần giải trình",
    "Ca này đã có đơn giải trình đang chờ duyệt",
    "Vui lòng nhập lý do giải trình",
    "Chỉ quản lý mới được duyệt đơn giải trình công",
    "Bạn không có quyền duyệt đơn của nhân viên này",
    "Đơn giải trình công không hợp lệ hoặc đã được xử lý",
    "Không thể huỷ đơn này",
    "Chỉ Kỹ thuật mới có thể khôi phục đơn",
    "Đơn không hợp lệ hoặc đang chờ duyệt",
    "Đơn duyệt trước khi có tính năng khôi phục — không thể khôi phục tự động",
    "Không tìm thấy bản ghi chấm công liên quan — không thể khôi phục tự động",
    "Bản ghi chấm công đã có giờ ra — không thể khôi phục tự động",
    "Bản ghi chấm công đã bị sửa bởi đơn giải trình khác — không thể khôi phục tự động",
    "Ca này đã có đơn giải trình khác đang chờ duyệt — không thể khôi phục tự động",
    "Vui lòng chọn giờ ra ca",
    "Ca này chưa có giờ vào — vui lòng giải trình giờ vào trước",
    "Giờ ra phải sau giờ vào",
    "Giờ ra không được ở tương lai",
    "Giờ ra không khớp với ca làm việc này",
    "Ca này đã có đơn giải trình giờ ra đang chờ duyệt",
    "Không tìm thấy bản ghi chấm công liên quan — vui lòng gửi lại đơn",
    "Giờ ra không còn hợp lệ so với giờ vào đã được sửa — vui lòng gửi lại đơn",
    "Nhân viên đang có ca chưa chấm công ra — không thể khôi phục tự động",
    "Bản ghi chấm công đã bị sửa sau khi duyệt — không thể khôi phục tự động",
  ];
  return known.find((m) => message.includes(m)) ?? "Không thể xử lý đơn giải trình công";
}

function revalidateAttendanceCorrectionPaths() {
  revalidatePath("/attendance/explain");
  revalidatePath("/manager");
  revalidatePath("/calendar");
  // See actions/leave.ts's revalidateLeavePaths for why this is needed —
  // the notification bell is in the shared app/(app)/layout.tsx.
  revalidatePath("/", "layout");
}

export type AttendanceCorrectionsBatchResult = {
  succeededCount: number;
  failed: { shift_id: string; error: string }[];
};

// Handles both the single-shift case (array of length 1) and the "giải
// trình nhiều ca cùng lúc" case — one submit, N independent RPC calls, each
// shift's own success/failure reported back so the form can keep only the
// failed rows on screen for the user to fix and retry.
export async function requestAttendanceCorrectionsAction(
  input: unknown
): Promise<ActionResult<AttendanceCorrectionsBatchResult>> {
  const profile = await requireProfile();
  const parsed = attendanceCorrectionsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const results = await Promise.all(
    parsed.data.map(async (entry) => {
      const { error } = await supabase.rpc("request_attendance_correction", {
        p_shift_id: entry.shift_id,
        p_reason: entry.reason,
      });
      return { shift_id: entry.shift_id, error: error ? mapAttendanceCorrectionError(error.message) : null };
    })
  );

  const failed = results
    .filter((r) => r.error)
    .map((r) => ({ shift_id: r.shift_id, error: r.error! }));
  const succeededCount = results.length - failed.length;

  if (succeededCount > 0) {
    revalidateAttendanceCorrectionPaths();
    // See actions/leave.ts's requestLeaveAction for why this is wrapped in
    // after() rather than fire-and-forget.
    after(() =>
      sendPushToLeaveApprovers(profile.role, {
        title: "Đơn giải trình công mới",
        body:
          succeededCount === 1
            ? `${profile.full_name} vừa gửi đơn giải trình công`
            : `${profile.full_name} vừa gửi ${succeededCount} đơn giải trình công`,
        url: "/manager",
        tag: "attendance-correction",
      })
    );
  }

  if (failed.length > 0 && succeededCount === 0) {
    return { ok: false, error: failed[0].error };
  }
  return { ok: true, data: { succeededCount, failed } };
}

// Single-shift only, unlike the check-in batch action: each check-out
// correction carries its own chosen time, so there is no "same treatment for
// N shifts" shortcut to batch over.
export async function requestCheckoutCorrectionAction(input: unknown): Promise<ActionResult> {
  const profile = await requireProfile();
  const parsed = checkoutCorrectionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();

  // The RPC needs an absolute instant, but the user picked a wall-clock time.
  // Resolve it against the shift's own date in Vietnam time — the shift is
  // what the RPC validates against, and building the timestamp from the
  // browser's clock would drift for anyone not on Asia/Ho_Chi_Minh.
  const { data: shiftRows } = await supabase
    .from("shifts")
    .select("start_at")
    .eq("id", parsed.data.shift_id)
    .eq("assignee_id", profile.id)
    .limit(1);

  const shift = ((shiftRows as Pick<Shift, "start_at">[]) ?? [])[0];
  if (!shift) {
    return { ok: false, error: "Không tìm thấy ca làm việc này" };
  }

  const requestedCheckOutAt = `${formatInVietnamDate(shift.start_at)}T${parsed.data.check_out_time}:00+07:00`;

  const { error } = await supabase.rpc("request_attendance_correction_checkout", {
    p_shift_id: parsed.data.shift_id,
    p_requested_check_out_at: requestedCheckOutAt,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return { ok: false, error: mapAttendanceCorrectionError(error.message) };
  }

  revalidateAttendanceCorrectionPaths();
  // See requestAttendanceCorrectionsAction for why this is wrapped in after().
  after(() =>
    sendPushToLeaveApprovers(profile.role, {
      title: "Đơn giải trình công mới",
      body: `${profile.full_name} vừa gửi đơn giải trình giờ ra ca`,
      url: "/manager",
      tag: "attendance-correction",
    })
  );

  return { ok: true, data: undefined };
}

export async function respondToAttendanceCorrectionAction(
  id: string,
  approve: boolean
): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("respond_to_attendance_correction", {
    p_id: id,
    p_approve: approve,
  });

  if (error) return { ok: false, error: mapAttendanceCorrectionError(error.message) };

  revalidateAttendanceCorrectionPaths();
  if (data) {
    const targetId = (data as { profile_id: string }).profile_id;
    after(() =>
      sendPushToProfile(targetId, {
        title: approve ? "Đơn giải trình công đã được duyệt" : "Đơn giải trình công bị từ chối",
        body: approve ? "Đơn giải trình công của bạn đã được duyệt" : "Đơn giải trình công của bạn đã bị từ chối",
        url: "/attendance/explain",
        tag: "attendance-correction",
      })
    );
  }
  return { ok: true, data: undefined };
}

// Manager-side hard delete — distinct from cancelAttendanceCorrectionAction
// above, which is the requester's own self-service cancel. Only works while
// pending; RLS policy attendance_corrections_delete_manager (0050) is the
// real authorization boundary. count: "exact" so a denied delete surfaces
// as a real error instead of a false "Đã xoá" toast.
export async function deleteAttendanceCorrectionAction(id: string): Promise<ActionResult> {
  await requireManager();
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("attendance_corrections")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("status", "pending");

  if (error) return { ok: false, error: "Không thể xoá đơn giải trình công" };
  if (!count) return { ok: false, error: "Bạn không có quyền xoá đơn này" };

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

// Technical-only: undoes an accidental Từ chối/Huỷ/Duyệt click. If the
// correction was approved, revert_attendance_correction also undoes the
// attendance write it made — deleting the inserted row (missed_check_in)
// or restoring the prior check_in_at (late_check_in) — but only if that
// attendance row hasn't since been checked out or touched by another
// approved correction.
export async function revertAttendanceCorrectionAction(id: string): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revert_attendance_correction", { p_id: id });

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
  // Clocked in on time. A check-out correction is still available — either to
  // supply a check-out they never made, or to adjust the one on record.
  return {
    ok: true,
    data: {
      kind: "check_out_available",
      shift,
      actualCheckInAt: attendance.check_in_at,
      actualCheckOutAt: attendance.check_out_at,
    },
  };
}
