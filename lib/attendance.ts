import { startOfDay, endOfDay, startOfMonth, endOfMonth, startOfYear, endOfYear, subDays, format, parse } from "date-fns";
import type { Attendance, LeaveRequest, Profile, Role } from "@/types";

export type OverviewPeriod = "day" | "month" | "year";

/** Plain start/end pair — every period-scoped helper below clips to one. */
export type DateRange = { start: Date; end: Date };

// What the URL asked /manager to show. Built once, on the server, from
// `?p=`/`?from=`/`?to=` — `from`/`to` are "yyyy-MM-dd" and are non-null ONLY
// as a validated, correctly-ordered pair, so nothing downstream has to
// re-check them.
export type OverviewRangeSpec = {
  period: OverviewPeriod;
  from: string | null;
  to: string | null;
};

// The ONE window /manager is looking at, resolved from the spec. Threaded
// down as a prop — no table, popup or helper may derive a window of its own
// from `now`, which is exactly what used to fetch a past ?from=/?to= range
// and then clip it away, rendering every table as zeros.
export type OverviewRange = DateRange & {
  /** The `?p=` tab. Still the active tab unless `isCustom`. */
  period: OverviewPeriod;
  /** True when a valid ?from=/?to= pair produced this window. */
  isCustom: boolean;
};

/** Whether the spec puts the page in custom-range mode (tabs go inactive). */
export function isCustomSpec(spec: OverviewRangeSpec): boolean {
  return spec.from !== null && spec.to !== null;
}

// The single definition of "the window I am looking at". Deliberately
// evaluated in BOTH execution contexts rather than resolved once on the
// server and shipped as instants: this app is Vietnam-only but the server
// process has no TZ set (see app/(app)/attendance/page.tsx), so server-side
// startOfDay()/startOfMonth() land on UTC boundaries while the browser's
// land on Vietnam ones. Shipping the server's instants would silently move
// every ngày/tháng/năm window by 7 hours. Same input spec + same function =
// one definition either way, each side using the calendar it should.
//
// Custom range is a FOURTH, mutually-exclusive mode next to ngày/tháng/năm —
// when it's set, `now` doesn't enter into the window at all, which is what
// finally lets a past range render its own data instead of zeros.
export function resolveOverviewRange(
  spec: OverviewRangeSpec,
  now: Date = new Date()
): OverviewRange {
  if (spec.from && spec.to) {
    return {
      start: startOfDay(parse(spec.from, "yyyy-MM-dd", now)),
      end: endOfDay(parse(spec.to, "yyyy-MM-dd", now)),
      period: spec.period,
      isCustom: true,
    };
  }
  return { ...periodRange(spec.period, now), period: spec.period, isCustom: false };
}

export type StaffOverviewRow = {
  id: string;
  fullName: string;
  role: Role;
  secondaryRole: Role | null;
  totalMinutes: number;
  status: "in_shift" | "checked_out" | "not_clocked";
  onLeaveToday: boolean;
};

// The day/month/year boundaries behind the ?p= tabs. Called in exactly one
// place now (app/(app)/manager/page.tsx, to resolve the page's window);
// still exported because CollapsibleGrid's own local period filter and any
// future caller need the same definition of "what does 'theo tháng' mean".
export function periodRange(period: OverviewPeriod, now: Date) {
  switch (period) {
    case "month":
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case "year":
      return { start: startOfYear(now), end: endOfYear(now) };
    case "day":
    default:
      return { start: startOfDay(now), end: endOfDay(now) };
  }
}

// One row per employee — the "mỗi tính năng 1 table" dashboard view: for the
// selected window, how many minutes did they actually work, are they
// currently clocked in or already checked out, and are they on approved/
// pending leave today. Built client-side off one broad attendance fetch (see
// app/(app)/manager/page.tsx) so switching Ngày/Tháng/Năm is instant, no
// refetch. `range` is the page's resolved window; `now` is only "right now"
// (open sessions, nghỉ phép hôm nay) and never defines the window.
export function buildStaffOverview(
  staff: Pick<Profile, "id" | "full_name" | "role" | "secondary_role">[],
  attendance: Attendance[],
  leaveRequests: Pick<LeaveRequest, "profile_id" | "start_date" | "end_date" | "status">[],
  range: DateRange,
  now: Date = new Date()
): StaffOverviewRow[] {
  const { start, end } = range;

  const minutesByProfile = new Map<string, number>();
  const openByProfile = new Set<string>();
  const closedInRangeByProfile = new Set<string>();

  for (const record of attendance) {
    const checkIn = new Date(record.check_in_at);
    const checkOut = record.check_out_at ? new Date(record.check_out_at) : null;
    if (!checkOut) openByProfile.add(record.profile_id);

    const effectiveEnd = checkOut ?? now;
    const overlapStart = checkIn > start ? checkIn : start;
    const overlapEnd = effectiveEnd < end ? effectiveEnd : end;
    if (overlapEnd > overlapStart) {
      const minutes = (overlapEnd.getTime() - overlapStart.getTime()) / 60000;
      minutesByProfile.set(record.profile_id, (minutesByProfile.get(record.profile_id) ?? 0) + minutes);
      if (checkOut) closedInRangeByProfile.add(record.profile_id);
    }
  }

  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const onLeaveToday = new Set(
    leaveRequests
      .filter((r) => r.status === "approved" || r.status === "pending")
      .filter((r) => new Date(r.end_date) >= todayStart && new Date(r.start_date) <= todayEnd)
      .map((r) => r.profile_id)
  );

  return staff
    .map((s) => ({
      id: s.id,
      fullName: s.full_name,
      role: s.role,
      secondaryRole: s.secondary_role,
      totalMinutes: Math.round(minutesByProfile.get(s.id) ?? 0),
      status: (openByProfile.has(s.id)
        ? "in_shift"
        : closedInRangeByProfile.has(s.id)
          ? "checked_out"
          : "not_clocked") as StaffOverviewRow["status"],
      onLeaveToday: onLeaveToday.has(s.id),
    }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes || a.fullName.localeCompare(b.fullName, "vi"));
}


export type AttendanceEntry = {
  id: string;
  checkInAt: string;
  checkOutAt: string | null;
  minutes: number;
};

// Per-session breakdown for the "Chấm công" tab of the per-person popup —
// same overlap-with-range math as buildStaffOverview's totalMinutes (so the
// tab's sum matches the table's Giờ làm column), just kept per-record
// instead of collapsed into one total. Takes the same resolved `range` the
// table got, so the two can't disagree.
export function buildAttendanceEntries(
  attendance: Pick<Attendance, "id" | "profile_id" | "check_in_at" | "check_out_at">[],
  profileId: string,
  range: DateRange,
  now: Date = new Date()
): AttendanceEntry[] {
  const { start, end } = range;

  return attendance
    .filter((r) => r.profile_id === profileId)
    .map((r) => {
      const checkIn = new Date(r.check_in_at);
      const checkOut = r.check_out_at ? new Date(r.check_out_at) : null;
      const effectiveEnd = checkOut ?? now;
      const overlapStart = checkIn > start ? checkIn : start;
      const overlapEnd = effectiveEnd < end ? effectiveEnd : end;
      const minutes = overlapEnd > overlapStart ? Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 60000) : 0;
      return { id: r.id, checkInAt: r.check_in_at, checkOutAt: r.check_out_at, minutes };
    })
    .filter((entry) => entry.minutes > 0)
    .sort((a, b) => b.checkInAt.localeCompare(a.checkInAt));
}

// Structural, not `ShiftOverviewRow` — lib/ must never import from
// components/, and these three fields are all the shift-hours math needs.
type ShiftLike = { start_at: string; end_at: string; assignee: { id: string } };

// The shifts one person is REGISTERED for in the window, newest first.
// Deliberately NOT the overlap-clipping math buildStaffOverview uses for
// attendance: a shift is a commitment, so it counts for its full scheduled
// length. Shared by the "Giờ đăng ký" column and the per-person popup — both
// are handed the SAME resolved `range`, so the row total and the popup total
// can never drift apart.
export function shiftsInRange<T extends ShiftLike>(
  shifts: T[],
  profileId: string,
  range: DateRange
): T[] {
  const { start, end } = range;
  return shifts
    .filter((s) => s.assignee.id === profileId)
    .filter((s) => {
      const t = new Date(s.start_at);
      return t >= start && t <= end;
    })
    .sort((a, b) => b.start_at.localeCompare(a.start_at));
}

export function sumShiftMinutes(shifts: ShiftLike[]): number {
  return shifts.reduce(
    (sum, s) => sum + (new Date(s.end_at).getTime() - new Date(s.start_at).getTime()) / 60000,
    0
  );
}

// "41g 37p", dropping the minutes when it lands on the hour ("8g"). Lives here
// because the overview table and the detail popup both render totals and had
// drifted into two identical private copies.
export function formatHours(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  return m > 0 ? `${h}g ${m}p` : `${h}g`;
}

export type DayHours = { date: string; label: string; hours: number };

// System-wide hours-worked-per-day, last N days — feeds the line chart in
// the Kỹ thuật analytics dashboard. Deliberately org-wide (not per-person):
// the point is "is total attendance trending normally," a shape anomaly is
// what technical is meant to catch here.
export function aggregateHoursByDay(records: Attendance[], days = 14, now: Date = new Date()): DayHours[] {
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    buckets.set(format(subDays(now, i), "yyyy-MM-dd"), 0);
  }

  for (const record of records) {
    const checkIn = new Date(record.check_in_at);
    const checkOut = record.check_out_at ? new Date(record.check_out_at) : now;
    const key = format(checkIn, "yyyy-MM-dd");
    if (!buckets.has(key)) continue;
    const minutes = Math.max(0, (checkOut.getTime() - checkIn.getTime()) / 60000);
    buckets.set(key, (buckets.get(key) ?? 0) + minutes);
  }

  return Array.from(buckets.entries()).map(([date, minutes]) => ({
    date,
    label: format(new Date(`${date}T00:00:00`), "dd/MM"),
    hours: Math.round((minutes / 60) * 10) / 10,
  }));
}

export type RoleCount = { role: Role; count: number };

// Staff distribution by role — feeds the pie chart.
export function aggregateStaffByRole(staff: Pick<Profile, "role">[]): RoleCount[] {
  const counts = new Map<Role, number>();
  for (const s of staff) counts.set(s.role, (counts.get(s.role) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => b.count - a.count);
}
