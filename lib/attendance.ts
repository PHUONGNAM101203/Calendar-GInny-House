import { startOfDay, endOfDay, startOfMonth, endOfMonth, startOfYear, endOfYear, subDays, format } from "date-fns";
import type { Attendance, LeaveRequest, Profile, Role } from "@/types";

export type OverviewPeriod = "day" | "month" | "year";

export type StaffOverviewRow = {
  id: string;
  fullName: string;
  role: Role;
  secondaryRole: Role | null;
  totalMinutes: number;
  status: "in_shift" | "checked_out" | "not_clocked";
  onLeaveToday: boolean;
};

// Exported so drill-down UI (StaffAttendanceDetailDialog) and the requests
// overview (lib/requests-overview.ts) compute the exact same day/month/year
// boundaries as this table — one definition of "what does 'theo tháng' mean".
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
// selected period, how many minutes did they actually work, are they
// currently clocked in or already checked out, and are they on approved/
// pending leave today. Built client-side off one broad attendance fetch (see
// app/(app)/manager/page.tsx) so switching Ngày/Tháng/Năm is instant, no
// refetch.
export function buildStaffOverview(
  staff: Pick<Profile, "id" | "full_name" | "role" | "secondary_role">[],
  attendance: Attendance[],
  leaveRequests: Pick<LeaveRequest, "profile_id" | "start_date" | "end_date" | "status">[],
  period: OverviewPeriod,
  now: Date = new Date()
): StaffOverviewRow[] {
  const { start, end } = periodRange(period, now);

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

export type AttendanceSession = { checkInAt: string; checkOutAt: string | null };
export type DayBreakdownEntry = { date: string; sessions: AttendanceSession[]; totalMinutes: number };

// One entry per calendar day within [rangeStart, rangeEnd] that has at least
// one attendance record for this person — feeds StaffAttendanceDetailDialog's
// day-by-day view (used for "theo ngày"/"theo tháng", and for a single month
// drilled into from "theo năm").
export function buildDayBreakdown(
  attendance: Attendance[],
  profileId: string,
  rangeStart: Date,
  rangeEnd: Date,
  now: Date = new Date()
): DayBreakdownEntry[] {
  const byDate = new Map<string, DayBreakdownEntry>();
  for (const record of attendance) {
    if (record.profile_id !== profileId) continue;
    const checkIn = new Date(record.check_in_at);
    if (checkIn < rangeStart || checkIn > rangeEnd) continue;
    const key = format(checkIn, "yyyy-MM-dd");
    const checkOut = record.check_out_at ? new Date(record.check_out_at) : null;
    const minutes = Math.max(0, ((checkOut ?? now).getTime() - checkIn.getTime()) / 60000);
    const entry = byDate.get(key) ?? { date: key, sessions: [], totalMinutes: 0 };
    entry.sessions.push({ checkInAt: record.check_in_at, checkOutAt: record.check_out_at });
    entry.totalMinutes += minutes;
    byDate.set(key, entry);
  }
  return Array.from(byDate.values())
    .map((entry) => ({ ...entry, totalMinutes: Math.round(entry.totalMinutes) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export type MonthBreakdownEntry = { month: number; totalMinutes: number };

// 12-month rollup for one person in one calendar year — feeds the "cả năm"
// summary in StaffAttendanceDetailDialog, which a manager then drills into
// (picks a month) to get the day-by-day view above.
export function buildMonthBreakdown(
  attendance: Attendance[],
  profileId: string,
  year: number,
  now: Date = new Date()
): MonthBreakdownEntry[] {
  const totals = new Array(12).fill(0) as number[];
  for (const record of attendance) {
    if (record.profile_id !== profileId) continue;
    const checkIn = new Date(record.check_in_at);
    if (checkIn.getFullYear() !== year) continue;
    const checkOut = record.check_out_at ? new Date(record.check_out_at) : now;
    totals[checkIn.getMonth()] += Math.max(0, (checkOut.getTime() - checkIn.getTime()) / 60000);
  }
  return totals.map((totalMinutes, i) => ({ month: i + 1, totalMinutes: Math.round(totalMinutes) }));
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
