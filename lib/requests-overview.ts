import type {
  AttendanceCorrection,
  LeaveRequest,
  Profile,
  Role,
  ShiftRequest,
  SwapRequest,
} from "@/types";
import { periodRange, type OverviewPeriod } from "@/lib/attendance";

export type RequestsOverviewRow = {
  id: string;
  fullName: string;
  role: Role;
  leaveCount: number;
  swapCount: number;
  shiftRequestCount: number;
  correctionCount: number;
  total: number;
};

function countByProfile<T extends { created_at: string }>(
  records: T[],
  profileIdOf: (record: T) => string,
  start: Date,
  end: Date
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const createdAt = new Date(record.created_at);
    if (createdAt < start || createdAt > end) continue;
    const profileId = profileIdOf(record);
    counts.set(profileId, (counts.get(profileId) ?? 0) + 1);
  }
  return counts;
}

// One row per employee — mirrors buildStaffOverview's shape/intent
// (lib/attendance.ts), but for "how many requests did each person submit"
// instead of "how many hours did each person work". Counts every request
// submitted in the period regardless of status (pending/approved/rejected/
// cancelled) — this is an activity overview, not an approval queue (that's
// "Cần xử lý" and the per-type Sections further down /manager).
export function buildRequestsOverview(
  staff: Pick<Profile, "id" | "full_name" | "role">[],
  leaveRequests: Pick<LeaveRequest, "profile_id" | "created_at">[],
  swapRequests: Pick<SwapRequest, "requester_id" | "created_at">[],
  shiftRequests: Pick<ShiftRequest, "profile_id" | "created_at">[],
  attendanceCorrections: Pick<AttendanceCorrection, "profile_id" | "created_at">[],
  period: OverviewPeriod,
  now: Date = new Date()
): RequestsOverviewRow[] {
  const { start, end } = periodRange(period, now);

  const leaveCounts = countByProfile(leaveRequests, (r) => r.profile_id, start, end);
  const swapCounts = countByProfile(swapRequests, (r) => r.requester_id, start, end);
  const shiftRequestCounts = countByProfile(shiftRequests, (r) => r.profile_id, start, end);
  const correctionCounts = countByProfile(attendanceCorrections, (r) => r.profile_id, start, end);

  return staff
    .map((s) => {
      const leaveCount = leaveCounts.get(s.id) ?? 0;
      const swapCount = swapCounts.get(s.id) ?? 0;
      const shiftRequestCount = shiftRequestCounts.get(s.id) ?? 0;
      const correctionCount = correctionCounts.get(s.id) ?? 0;
      return {
        id: s.id,
        fullName: s.full_name,
        role: s.role,
        leaveCount,
        swapCount,
        shiftRequestCount,
        correctionCount,
        total: leaveCount + swapCount + shiftRequestCount + correctionCount,
      };
    })
    .sort((a, b) => b.total - a.total || a.fullName.localeCompare(b.fullName, "vi"));
}
