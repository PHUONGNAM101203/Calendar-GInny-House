"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { CalendarView, LeaveRequestWithRole, AttendanceWithProfileRole } from "@/lib/calendar";
import type {
  AttendanceCorrectionDetailed,
  Branch,
  CustomCalendar,
  CustomEvent,
  Profile,
  Role,
  ShiftRequestDetailed,
  ShiftWithAssignee,
  SwapRequestDetailed,
} from "@/types";
import type { GroupPermissions } from "@/lib/permissions";

// react-big-calendar touches the DOM (measuring rows/columns, scroll sync)
// and has no reason to render on the server — forcing it through SSR was
// the actual cause of the recurring "Cannot read properties of null
// (reading 'useMemo')" crash: on a cold Turbopack compile, Next attempted
// to server-render this client component before the library's module graph
// had finished linking against the server's React instance. Loading it
// client-only (`ssr: false`) skips that render pass entirely, which also
// makes the initial /calendar response lighter and faster — the server now
// only ever sends the skeleton, never attempts the heavy calendar render.
const ShiftCalendar = dynamic(() => import("@/components/calendar/ShiftCalendar"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 flex-col gap-3 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-56" />
      </div>
      <Skeleton className="flex-1" />
    </div>
  ),
});

export default function ShiftCalendarLoader(props: {
  shifts: ShiftWithAssignee[];
  pendingSwaps: SwapRequestDetailed[];
  attendance: AttendanceWithProfileRole[];
  leaveRequests: LeaveRequestWithRole[];
  shiftRequests: ShiftRequestDetailed[];
  attendanceCorrections: AttendanceCorrectionDetailed[];
  branches: Branch[];
  customCalendars: CustomCalendar[];
  customEvents: CustomEvent[];
  currentUserId: string;
  currentUserName: string;
  currentUserRole: Role;
  canManageShifts: boolean;
  branchMembers: Pick<Profile, "id" | "full_name" | "role" | "secondary_role" | "branch_ids">[];
  canFollowAll: boolean;
  followedIds: string[];
  followColors: Record<string, string>;
  branchColors: Record<string, string>;
  defaultView: CalendarView;
  permissions: GroupPermissions;
}) {
  return <ShiftCalendar {...props} />;
}
