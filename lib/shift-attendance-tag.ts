import { isReceptionistExempt } from "@/lib/roles";
import type { Role } from "@/types";

export type ShiftAttendanceTag = "receptionist" | "missing" | "in_progress" | "done";

export const SHIFT_ATTENDANCE_TAG_LABELS: Record<ShiftAttendanceTag, string> = {
  receptionist: "Ca lễ tân",
  missing: "Chưa chấm công",
  in_progress: "Đang trong ca",
  done: "Đã xong ca",
};

// Badge variant per tag — matches components/ui/badge.tsx's soft-tint
// convention. "receptionist" uses "secondary" (neutral) since it isn't a
// real attendance outcome, just a person-level exemption label.
export const SHIFT_ATTENDANCE_TAG_VARIANTS: Record<
  ShiftAttendanceTag,
  "secondary" | "destructive" | "default" | "success"
> = {
  receptionist: "secondary",
  missing: "destructive",
  in_progress: "default",
  done: "success",
};

// Thresholds mirror find_late_checkin_shifts()/find_stale_checkout_sessions()
// (supabase/migrations/0062_late_and_stale_attendance_finders.sql, window
// narrowed in 0065) so this display tag never contradicts what the
// attendance-reminders cron actually flags.
const LATE_CHECKIN_GRACE_MS = 15 * 60_000;
const AUTO_CHECKOUT_GRACE_MS = 2 * 60 * 60_000;

// Pure — no `now()` param, so callers pass Date.now() explicitly (this repo's
// scripts can't call Date.now() themselves, but Server Components rendering
// this table can). Returns null for a shift that hasn't started yet (plus
// its 15-minute grace) — not yet meaningful to tag as "missing".
export function computeShiftAttendanceTag(
  shift: {
    start_at: string;
    end_at: string;
    assignee: { secondary_role: Role | null };
    attendance: { check_in_at: string; check_out_at: string | null }[];
  },
  now: Date
): ShiftAttendanceTag | null {
  if (isReceptionistExempt(shift.assignee)) return "receptionist";

  const record = shift.attendance[0];
  if (!record) {
    const startAt = new Date(shift.start_at);
    return now.getTime() >= startAt.getTime() + LATE_CHECKIN_GRACE_MS ? "missing" : null;
  }

  if (record.check_out_at) return "done";

  const endAt = new Date(shift.end_at);
  return now.getTime() > endAt.getTime() + AUTO_CHECKOUT_GRACE_MS ? "done" : "in_progress";
}
