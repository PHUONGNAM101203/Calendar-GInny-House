import { startOfDay, endOfDay, startOfMonth, endOfMonth, startOfYear, endOfYear, subDays, format } from "date-fns";
import type { Attendance, LeaveRequest, Profile, Role } from "@/types";

export type OverviewPeriod = "day" | "month" | "year";

// Exported so drill-down UI and the requests overview (lib/requests-overview.ts)
// compute the exact same day/month/year boundaries as this table — one
// definition of "what does 'theo tháng' mean".
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

export function formatHours(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  return m > 0 ? `${h}g ${m}p` : `${h}g`;
}

// Generalizes the date-overlap check every "on leave" badge in the app needs
// (approved OR pending, per the same convention used everywhere else leave
// status gates a UI hint rather than an authorization decision) to any single
// date — not hardcoded to "today", so callers like ShiftsOverviewTable can
// check a specific shift's own date instead of only "right now".
export function isOnLeaveForDate(
  leaveRequests: Pick<LeaveRequest, "profile_id" | "start_date" | "end_date" | "status">[],
  profileId: string,
  date: Date
): boolean {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);
  return leaveRequests.some(
    (r) =>
      r.profile_id === profileId &&
      (r.status === "approved" || r.status === "pending") &&
      new Date(r.end_date) >= dayStart &&
      new Date(r.start_date) <= dayEnd
  );
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
