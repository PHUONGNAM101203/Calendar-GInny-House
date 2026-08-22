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
  // More than one shift that day and the user hasn't said which — staff here
  // routinely work a split day (08:00–12:00 and 14:00–18:00). Without the
  // pick, only whichever shift the database returned first was correctable.
  | { kind: "multiple_shifts"; shifts: Pick<Shift, "id" | "start_at" | "end_at">[] }
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

// Mirrors request_attendance_correction_checkout's resolution order (0074):
// the row clock_in(p_shift_id) actually wrote for THIS shift, and only then
// the shiftless free-clock-in fallback restricted to the shift's own Vietnam
// date. Matching by date alone would grab an unrelated same-day session.
// Shared by the preview and the request action so the time the user is shown
// and the time the roll-forward anchors on are resolved identically — they
// used to be able to disagree.
async function resolveAttendanceForShift(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profileId: string,
  shift: Pick<Shift, "id" | "start_at">
): Promise<Attendance | null> {
  const { data: byShiftRows } = await supabase
    .from("attendance")
    .select("*")
    .eq("profile_id", profileId)
    .eq("shift_id", shift.id)
    .order("check_in_at", { ascending: false })
    .limit(1);

  const forShift = ((byShiftRows as Attendance[]) ?? [])[0] ?? null;
  if (forShift) return forShift;

  const shiftDate = formatInVietnamDate(shift.start_at);
  const { data: shiftlessRows } = await supabase
    .from("attendance")
    .select("*")
    .eq("profile_id", profileId)
    .is("shift_id", null)
    .gte("check_in_at", `${shiftDate}T00:00:00+07:00`)
    .lte("check_in_at", `${shiftDate}T23:59:59+07:00`)
    .order("check_in_at", { ascending: false })
    .limit(1);

  return ((shiftlessRows as Attendance[]) ?? [])[0] ?? null;
}

// Resolve a wall-clock "HH:mm" into an absolute instant.
//
// Overnight shifts end on the calendar day AFTER they start — ShiftFormDialog
// rolls end_at forward when it would otherwise precede start_at, and
// shifts_time_valid permits that — so a check-out of e.g. 02:00 on a
// 22:00→02:00 shift belongs to the next day.
//
// The roll anchors on the resolved session's check_in_at, NOT on
// shift.start_at. On 0074's shiftless-fallback branch the shift describes a
// session the row was never tied to, and both shift-anchored gates are
// skipped there — so anchoring on the shift would roll a legitimate
// 06:00→07:30 free session's check-out to the next day and record a 25-hour
// session that the RPC has no bound left to reject. check_in_at is the one
// gate 0074 applies on both branches, which makes it the safe anchor.
//
// The check_in_at is resolved server-side by the caller and never accepted
// from the client: a caller claiming a late check-in could otherwise push the
// resolved day forward and slip a many-hour session past the shiftless branch.
//
// Two guards bound the roll. Both only ever turn a roll into a non-roll, and
// the un-rolled instant then falls through to the RPC — neither can turn a
// rejection into an acceptance.
//
//  1. Never roll into the future: a rolled instant later than now() cannot be
//     a check-out that already happened. This is a wash for message quality
//     rather than a pure win — a same-day user who typed a time earlier than
//     their check-in now gets the accurate "Giờ ra phải sau giờ vào", but a
//     prompt overnight filer (declaring 02:00 at 01:55) gets that same message
//     for a time that genuinely IS after their check-in, with no hint that
//     waiting five minutes would work. Both paths reject either way, so this
//     trades one misleading message for another rather than removing one.
//  2. Never roll past a 16-hour session. Every legitimate roll is an overnight
//     session, and no real session — shift-tied or free — runs 16 hours. This
//     is what bounds the shiftless branch: 0074 skips both shift-anchored
//     gates there and 0073's approval re-check only re-tests > check_in_at, so
//     without this a free 06:00 clock-in could have a 05:30 typo rolled to the
//     next day and approved as a 23.5-hour session. The shift-tied branch is
//     already capped near 10h by end_at + 6h, so 16h is a generous outer bound
//     that still kills that case.
//
// No upper bound on lateness is applied here on purpose: the RPC's
// end_at + 6h guard is the authority on how late is too late. Vietnam has no
// DST, so +24h is exactly one calendar day.
const MAX_ROLLED_SESSION_MS = 16 * 60 * 60_000;
function resolveCheckOutInstant(
  shiftStartAt: string,
  checkOutTime: string,
  checkInAt: string | null
): string {
  const onShiftDate = `${formatInVietnamDate(shiftStartAt)}T${checkOutTime}:00+07:00`;
  // With no session resolved there is nothing to anchor to; leave it alone and
  // let the RPC raise "Ca này chưa có giờ vào — vui lòng giải trình giờ vào trước".
  if (!checkInAt) return onShiftDate;
  if (new Date(onShiftDate) > new Date(checkInAt)) return onShiftDate;

  // The rolled date advances from the SHIFT's day, not the check-in's: a late
  // check-in that already landed after midnight is itself on day+1, and
  // advancing from it would overshoot to day+2.
  const nextDate = formatInVietnamDate(
    new Date(new Date(shiftStartAt).getTime() + 24 * 60 * 60_000).toISOString()
  );
  const rolled = `${nextDate}T${checkOutTime}:00+07:00`;
  const rolledAt = new Date(rolled);
  if (rolledAt > new Date()) return onShiftDate;
  if (rolledAt.getTime() - new Date(checkInAt).getTime() > MAX_ROLLED_SESSION_MS) {
    return onShiftDate;
  }
  return rolled;
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
  const { data: shiftRows, error: shiftError } = await supabase
    .from("shifts")
    .select("id, start_at")
    .eq("id", parsed.data.shift_id)
    .eq("assignee_id", profile.id)
    .limit(1);

  // Distinguish "the query failed" from "no such shift" — conflating them
  // told the user their shift didn't exist after a transient RLS/network
  // hiccup, giving them no reason to retry.
  if (shiftError) {
    return { ok: false, error: "Không thể xử lý đơn giải trình công" };
  }

  const shift = ((shiftRows as Pick<Shift, "id" | "start_at">[]) ?? [])[0];
  if (!shift) {
    return { ok: false, error: "Không tìm thấy ca làm việc này" };
  }

  // Resolved here rather than taken from the client: this anchors the
  // roll-forward, so trusting a caller-supplied check-in would let them push
  // the resolved day forward past the shiftless branch's missing bounds.
  const attendance = await resolveAttendanceForShift(supabase, profile.id, shift);

  const requestedCheckOutAt = resolveCheckOutInstant(
    shift.start_at,
    parsed.data.check_out_time,
    attendance?.check_in_at ?? null
  );

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
    .order("start_at");

  const shiftList = (shifts as Pick<Shift, "id" | "start_at" | "end_at">[]) ?? [];
  if (shiftList.length === 0) {
    return { ok: true, data: { kind: "no_shift" } };
  }

  // A supplied id that isn't on this date is ignored rather than trusted, so
  // a stale pick can't describe another day's shift.
  const picked = parsed.data.shift_id
    ? shiftList.find((s) => s.id === parsed.data.shift_id)
    : undefined;
  const shift = picked ?? (shiftList.length === 1 ? shiftList[0] : null);
  if (!shift) {
    return { ok: true, data: { kind: "multiple_shifts", shifts: shiftList } };
  }

  // Same resolution the request action uses, so the time shown here is the
  // time the roll-forward will anchor on.
  const attendance = await resolveAttendanceForShift(supabase, profile.id, shift);
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
