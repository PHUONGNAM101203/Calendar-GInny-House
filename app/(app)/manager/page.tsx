import { startOfDay, endOfDay, startOfYear, parse, isValid } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth";
import { getBranches } from "@/lib/branches";
import {
  MANAGER_GROUP_META,
  isLeaveApprover,
  canApproveLeaveFor,
  canApproveShiftRequestFor,
  isShiftRequestApprover,
  canApproveSwapRequestFor,
  isManagerRole,
} from "@/lib/roles";
import { getGroupPermissions, getGrantedTargetRolesUnion, getGrantedTargetRoles } from "@/lib/permissions";
import { Card, CardContent } from "@/components/ui/card";
import ManagerDashboard from "@/components/manager/ManagerDashboard";
import TechnicalDashboard from "@/components/manager/TechnicalDashboard";
import StaffTable from "@/components/manager/StaffTable";
import DateRangeFilter from "@/components/manager/DateRangeFilter";
import SwapRequestCard from "@/components/swaps/SwapRequestCard";
import LeaveRequestCard from "@/components/leave/LeaveRequestCard";
import ShiftRequestCard from "@/components/shifts/ShiftRequestCard";
import AttendanceCorrectionCard from "@/components/attendance/AttendanceCorrectionCard";
import CollapsibleGrid from "@/components/manager/CollapsibleGrid";
import type {
  Attendance,
  AttendanceCorrectionDetailed,
  AttendanceWithProfile,
  LeaveRequestDetailed,
  Profile,
  ShiftRequestDetailed,
  SwapRequestDetailed,
} from "@/types";

const SELECT = `
  *,
  requester:profiles!requester_id(id, full_name, role),
  target:profiles!target_id(id, full_name, role),
  requester_shift:shifts!requester_shift_id(id, start_at, end_at),
  target_shift:shifts!target_shift_id(id, start_at, end_at)
`;

type ProfileRoleRef = Pick<Profile, "id" | "full_name" | "role">;

// A section is a titled panel — count on the right when there's something
// to count — so the page reads as one continuous dashboard grid instead of
// a stack of unrelated blocks (per the reference: everything is a card in
// a grid, nothing is a bare unstyled list).
function Section({
  id,
  title,
  count,
  children,
}: {
  id?: string;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-heading text-lg font-semibold tracking-tight">{title}</h2>
        {count !== undefined && (
          <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}

export default async function ManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const manager = await requireManager();
  const supabase = await createClient();
  const permissions = await getGroupPermissions();
  const params = await searchParams;
  const todayStart = startOfDay(new Date()).toISOString();
  const todayEnd = endOfDay(new Date()).toISOString();

  // parse(), not new Date(params.from) — see app/(app)/calendar/page.tsx's
  // comment: the latter reads "yyyy-MM-dd" as UTC midnight, which drifts a
  // day in a positive UTC-offset timezone (Vietnam). Falls back to the
  // original whole-year window when no filter is set, so existing behavior
  // is unchanged unless the user explicitly picks a range.
  const parsedFrom = params.from ? parse(params.from, "yyyy-MM-dd", new Date()) : null;
  const parsedTo = params.to ? parse(params.to, "yyyy-MM-dd", new Date()) : null;
  const attendanceWindowStart =
    parsedFrom && isValid(parsedFrom) ? startOfDay(parsedFrom).toISOString() : startOfYear(new Date()).toISOString();
  const attendanceWindowEnd = parsedTo && isValid(parsedTo) ? endOfDay(parsedTo).toISOString() : null;

  const [
    { data: staff },
    { data: swaps },
    branches,
    { data: shiftsTodayRows },
    { data: clockedIn },
    { data: leaves },
    { data: yearAttendance },
    { data: shiftRequests },
    { data: attendanceCorrections },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone, role, profile_branches(branch_id)")
      .order("full_name"),
    supabase.from("shift_swap_requests").select(SELECT).order("created_at", { ascending: false }),
    getBranches(),
    supabase
      .from("shifts")
      .select("assignee_id")
      .gte("start_at", todayStart)
      .lte("start_at", todayEnd),
    supabase
      .from("attendance")
      .select("*, profile:profiles!profile_id(id, full_name, role)")
      .is("check_out_at", null)
      .order("check_in_at", { ascending: false }),
    supabase
      .from("leave_requests")
      .select("*, profile:profiles!profile_id(id, full_name, role)")
      .order("created_at", { ascending: false }),
    (() => {
      let query = supabase.from("attendance").select("*").gte("check_in_at", attendanceWindowStart);
      if (attendanceWindowEnd) query = query.lte("check_in_at", attendanceWindowEnd);
      return query.order("check_in_at", { ascending: false });
    })(),
    supabase
      .from("shift_requests")
      .select("*, profile:profiles!profile_id(id, full_name, role)")
      .order("created_at", { ascending: false }),
    supabase
      .from("attendance_corrections")
      .select("*, profile:profiles!profile_id(id, full_name, role), shift:shifts!shift_id(id, start_at, end_at)")
      .order("created_at", { ascending: false }),
  ]);

  type StaffQueryRow = Pick<Profile, "id" | "full_name" | "phone" | "role"> & {
    profile_branches: { branch_id: string }[];
  };
  const staffList = ((staff as StaffQueryRow[] | null) ?? []).map((s) => ({
    id: s.id,
    full_name: s.full_name,
    phone: s.phone,
    role: s.role,
    branch_ids: s.profile_branches.map((pb) => pb.branch_id),
  }));
  const swapsList = (swaps as SwapRequestDetailed[]) ?? [];
  const leavesList = (leaves as (LeaveRequestDetailed & { profile: ProfileRoleRef })[]) ?? [];
  const clockedInList = (clockedIn as (AttendanceWithProfile & { profile: ProfileRoleRef })[]) ?? [];
  const attendanceList = (yearAttendance as Attendance[]) ?? [];
  const shiftRequestsList = (shiftRequests as ShiftRequestDetailed[]) ?? [];
  const attendanceCorrectionsList = (attendanceCorrections as AttendanceCorrectionDetailed[]) ?? [];
  const shiftsTodayList = (shiftsTodayRows as Pick<{ assignee_id: string }, "assignee_id">[]) ?? [];

  const isTechnical = manager.role === "technical";

  // Each dashboard section is scoped by ITS OWN permission type now that
  // group grants are independent per (manager, target, permission) — see
  // docs/superpowers/specs/2026-08-09-dynamic-group-permissions-design.md.
  // There's no single "my group" set anymore; the staff roster uses the
  // union of all 6 types (broadest "who do I manage in any capacity"),
  // while each request-list section uses the specific permission type
  // that actually governs it.
  const isGroupManager = manager.role === "coo" || manager.role === "training_director" || manager.role === "hr";
  const groupMeta = isGroupManager ? MANAGER_GROUP_META[manager.role] : undefined;

  const rosterRoles = isGroupManager ? getGrantedTargetRolesUnion(permissions, manager.role) : null;
  const calendarRoles = isGroupManager ? getGrantedTargetRoles(permissions, manager.role, "view_calendar") : null;
  const leaveRoles = isGroupManager ? getGrantedTargetRoles(permissions, manager.role, "approve_leave") : null;
  const shiftRequestRoles = isGroupManager
    ? getGrantedTargetRoles(permissions, manager.role, "approve_shift_request")
    : null;

  const scopedStaff = rosterRoles ? staffList.filter((s) => rosterRoles.has(s.role)) : staffList;
  const scopedStaffIds = new Set(scopedStaff.map((s) => s.id));
  const scopedClockedIn = calendarRoles
    ? clockedInList.filter((a) => calendarRoles.has(a.profile.role))
    : clockedInList;
  const scopedAttendance = calendarRoles
    ? attendanceList.filter((a) => scopedStaffIds.has(a.profile_id))
    : attendanceList;
  const scopedLeaves = leaveRoles ? leavesList.filter((l) => leaveRoles.has(l.profile.role)) : leavesList;
  const scopedSwaps = rosterRoles
    ? swapsList.filter(
        (s) => scopedStaffIds.has(s.requester_id) || (!!s.target_id && scopedStaffIds.has(s.target_id))
      )
    : swapsList;
  const scopedShiftRequests = shiftRequestRoles
    ? shiftRequestsList.filter((r) => shiftRequestRoles.has(r.profile.role))
    : shiftRequestsList;
  const scopedAttendanceCorrections = leaveRoles
    ? attendanceCorrectionsList.filter((r) => leaveRoles.has(r.profile.role))
    : attendanceCorrectionsList;
  const scopedShiftsToday = rosterRoles
    ? shiftsTodayList.filter((s) => scopedStaffIds.has(s.assignee_id)).length
    : shiftsTodayList.length;

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 space-y-8 overflow-y-auto p-4 sm:p-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Quản lý</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {groupMeta
            ? `Theo dõi nhân sự và yêu cầu đổi ca trong ${groupMeta.label.toLowerCase()} bạn quản lý.`
            : "Theo dõi nhân sự và yêu cầu đổi ca trong cơ sở của bạn."}
        </p>
      </div>

      <DateRangeFilter />

      {isTechnical ? (
        <TechnicalDashboard
          staff={staffList}
          attendance={attendanceList}
          leaveRequests={leavesList}
          swapRequests={swapsList}
          shiftRequests={shiftRequestsList}
          attendanceCorrections={attendanceCorrectionsList}
          groupPermissions={permissions}
        />
      ) : isGroupManager ? (
        <ManagerDashboard
          totalStaff={scopedStaff.length}
          unassignedStaff={scopedStaff.filter((s) => s.branch_ids.length === 0).length}
          shiftsToday={scopedShiftsToday}
          pendingSwaps={scopedSwaps.filter((s) => s.status === "pending").length}
          pendingLeave={scopedLeaves.filter((l) => l.status === "pending").length}
          pendingShiftRequests={
            isShiftRequestApprover(manager.role)
              ? scopedShiftRequests.filter((r) => r.status === "pending").length
              : 0
          }
          pendingAttendanceCorrections={scopedAttendanceCorrections.filter((r) => r.status === "pending").length}
          clockedInCount={scopedClockedIn.length}
          staff={scopedStaff}
          attendance={scopedAttendance}
          leaveRequests={scopedLeaves}
          swapRequests={scopedSwaps}
          shiftRequests={scopedShiftRequests}
          attendanceCorrections={scopedAttendanceCorrections}
          overviewTitle={groupMeta ? `Tổng hợp chấm công — ${groupMeta.label}` : undefined}
        />
      ) : (
        <ManagerDashboard
          totalStaff={staffList.length}
          unassignedStaff={staffList.filter((s) => s.branch_ids.length === 0 && !isManagerRole(s.role)).length}
          shiftsToday={scopedShiftsToday}
          pendingSwaps={swapsList.filter((s) => s.status === "pending").length}
          pendingLeave={leavesList.filter((l) => l.status === "pending").length}
          pendingShiftRequests={shiftRequestsList.filter((r) => r.status === "pending").length}
          pendingAttendanceCorrections={attendanceCorrectionsList.filter((r) => r.status === "pending").length}
          clockedInCount={clockedInList.length}
          staff={staffList}
          attendance={attendanceList}
          leaveRequests={leavesList}
          swapRequests={swapsList}
          shiftRequests={shiftRequestsList}
          attendanceCorrections={attendanceCorrectionsList}
        />
      )}

      <Section
        id="staff"
        title={groupMeta ? `Nhân viên — ${groupMeta.label}` : "Nhân viên"}
        count={scopedStaff.length}
      >
        {groupMeta && <p className="mb-4 text-sm text-muted-foreground">{groupMeta.description}</p>}
        <Card>
          <CardContent>
            <StaffTable staff={scopedStaff} branches={branches} currentUserId={manager.id} />
          </CardContent>
        </Card>
      </Section>

      {isShiftRequestApprover(manager.role) && (
        <Section id="shift-requests" title="Đăng ký ca" count={scopedShiftRequests.length}>
          {scopedShiftRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có đăng ký ca làm nào.</p>
          ) : (
            <CollapsibleGrid dates={scopedShiftRequests.map((r) => r.created_at)} className="grid gap-3 sm:grid-cols-2">
              {scopedShiftRequests.map((r) => (
                <ShiftRequestCard
                  key={r.id}
                  request={r}
                  canRespond={r.status === "pending" && canApproveShiftRequestFor(manager.role, r.profile.role, permissions)}
                  canCancel={r.status === "pending"}
                  showName
                />
              ))}
            </CollapsibleGrid>
          )}
        </Section>
      )}

      <Section id="swaps" title="Yêu cầu đổi ca" count={scopedSwaps.length}>
        {scopedSwaps.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có yêu cầu đổi ca nào.</p>
        ) : (
          <CollapsibleGrid dates={scopedSwaps.map((r) => r.created_at)} className="grid gap-3 sm:grid-cols-2">
            {scopedSwaps.map((r) => (
              <SwapRequestCard
                key={r.id}
                request={r}
                canRespond={
                  r.status === "pending" &&
                  r.target_id !== null &&
                  r.target !== null &&
                  canApproveSwapRequestFor(manager.role, r.requester.role, r.target.role, permissions)
                }
                canCancel={r.status === "pending"}
              />
            ))}
          </CollapsibleGrid>
        )}
      </Section>

      <Section id="leave" title="Nghỉ phép" count={scopedLeaves.length}>
        {scopedLeaves.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có đơn nghỉ phép nào.</p>
        ) : (
          <CollapsibleGrid dates={scopedLeaves.map((r) => r.created_at)} className="grid gap-3 sm:grid-cols-2">
            {scopedLeaves.map((r) => (
              <LeaveRequestCard
                key={r.id}
                request={r}
                canRespond={
                  r.status === "pending" &&
                  isLeaveApprover(manager.role) &&
                  canApproveLeaveFor(manager.role, r.profile.role, permissions)
                }
                canCancel={r.status === "pending"}
                showName
              />
            ))}
          </CollapsibleGrid>
        )}
      </Section>

      <Section id="attendance-corrections" title="Giải trình công" count={scopedAttendanceCorrections.length}>
        {scopedAttendanceCorrections.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có đơn giải trình công nào.</p>
        ) : (
          <CollapsibleGrid dates={scopedAttendanceCorrections.map((r) => r.created_at)} className="grid gap-3 sm:grid-cols-2">
            {scopedAttendanceCorrections.map((r) => (
              <AttendanceCorrectionCard
                key={r.id}
                request={r}
                canRespond={
                  r.status === "pending" &&
                  isLeaveApprover(manager.role) &&
                  canApproveLeaveFor(manager.role, r.profile.role, permissions)
                }
                canCancel={r.status === "pending"}
                showName
              />
            ))}
          </CollapsibleGrid>
        )}
      </Section>
    </div>
  );
}
