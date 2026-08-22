import { startOfDay, endOfDay, subDays, addDays, parse, isValid } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import {
  resolveOverviewRange,
  type OverviewPeriod,
  type OverviewRangeSpec,
} from "@/lib/attendance";
import { requireManager } from "@/lib/auth";
import { getBranches } from "@/lib/branches";
import {
  MANAGER_GROUP_META,
  isLeaveApprover,
  canApproveLeaveFor,
  canApproveShiftRequestFor,
  isShiftRequestApprover,
  canApproveSwapRequestFor,
  canCreateShiftDirectly,
  isManagerRole,
} from "@/lib/roles";
import { getGrantedTargetRolesUnion, getGrantedTargetRoles } from "@/lib/permissions";
import { getGroupPermissions } from "@/lib/permissions-server";
import { Card, CardContent } from "@/components/ui/card";
import ManagerDashboard from "@/components/manager/ManagerDashboard";
import TechnicalDashboard from "@/components/manager/TechnicalDashboard";
import StaffTable from "@/components/manager/StaffTable";
import ShiftsOverviewTable, { type ShiftOverviewRow } from "@/components/manager/ShiftsOverviewTable";
import ShiftSeriesSection from "@/components/manager/ShiftSeriesSection";
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
  ShiftSeriesDetailed,
  SwapRequestDetailed,
} from "@/types";

const SELECT = `
  *,
  requester:profiles!requester_id(id, full_name, role),
  target:profiles!target_id(id, full_name, role),
  requester_shift:shifts!requester_shift_id(id, start_at, end_at),
  target_shift:shifts!target_shift_id(id, start_at, end_at)
`;

// Matches the SELECT convention above — see the `as unknown as
// ShiftOverviewRow[]` cast further down for why: without generated DB
// types, supabase-js can't know assignee_id/branch_id are to-one relations
// and defaults the embedded join shape to arrays.
const SHIFTS_OVERVIEW_SELECT =
  "id, start_at, end_at, shift_type, assignee:profiles!assignee_id(id, full_name, role, secondary_role), " +
  "branch:branches!branch_id(id, name)";

type ProfileRoleRef = Pick<Profile, "id" | "full_name" | "role">;

const OVERVIEW_PERIODS = ["day", "month", "year"] as const;

// Same defensive shape as the `?from=`/`?to=` parsing below: anything that
// isn't one of the three literals falls back to the default rather than
// being cast through. "month" is the shared default for all three period
// tables on this page — see components/manager/PeriodTabs.tsx.
function parsePeriod(value: string | undefined): OverviewPeriod {
  return OVERVIEW_PERIODS.includes(value as OverviewPeriod) ? (value as OverviewPeriod) : "month";
}

// Earlier/later of two dates — used to widen a fetch window out to the floor
// and ceiling the UI needs (the 7/14-day activity charts) without ever
// narrowing the window the selected period or custom range asked for.
function earliest(a: Date, b: Date): Date {
  return a < b ? a : b;
}

function latest(a: Date, b: Date): Date {
  return a > b ? a : b;
}

// The one place ?from=/?to= is validated, so every consumer downstream can
// treat a non-null pair as real. parse(), not new Date(value) — see
// app/(app)/calendar/page.tsx's comment: the latter reads "yyyy-MM-dd" as UTC
// midnight, which drifts a day in a positive UTC-offset timezone (Vietnam).
//
// Custom range is a FOURTH, mutually-exclusive mode next to ngày/tháng/năm,
// not an extra narrowing on top of one: it only counts when BOTH ends parse
// AND they're the right way round. A half-filled, unparseable or inverted
// range degrades to the period rather than resolving to an empty window that
// would render every table as zeros.
function parseCustomRange(
  from: string | undefined,
  to: string | undefined,
  now: Date
): { from: string; to: string } | null {
  if (!from || !to) return null;
  const parsedFrom = parse(from, "yyyy-MM-dd", now);
  const parsedTo = parse(to, "yyyy-MM-dd", now);
  if (!isValid(parsedFrom) || !isValid(parsedTo)) return null;
  if (startOfDay(parsedFrom) > startOfDay(parsedTo)) return null;
  return { from, to };
}

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
  searchParams: Promise<{ from?: string; to?: string; p?: string }>;
}) {
  const manager = await requireManager();
  const supabase = await createClient();
  const params = await searchParams;
  // One `now` for the whole render so every window below shares a single
  // boundary — a per-call `new Date()` could straddle midnight mid-render.
  const now = new Date();
  const todayStart = startOfDay(now).toISOString();
  const todayEnd = endOfDay(now).toISOString();

  // THE window for this render, described once: either the ?p= period or an
  // explicit ?from=/?to= range, never a mix. Everything downstream — every
  // query below, every table, every popup — resolves this one spec through
  // resolveOverviewRange(); nothing recomputes a window of its own from
  // `now`, because a component anchored to today can only ever clip a past
  // custom range down to nothing.
  const period = parsePeriod(params.p);
  const customRange = parseCustomRange(params.from, params.to, now);
  const rangeSpec: OverviewRangeSpec = {
    period,
    from: customRange?.from ?? null,
    to: customRange?.to ?? null,
  };
  const range = resolveOverviewRange(rangeSpec, now);

  // Fetch bounds. A custom window is padded a day either side: the browser
  // clips these rows to Vietnam-local boundaries while this process has no TZ
  // set (see app/(app)/attendance/page.tsx), so an unpadded bound would cut
  // the first ~7 hours off the range. Over-fetching costs nothing — every
  // consumer clips. Period windows keep exactly the bounds they always had.
  const fetchStart = range.isCustom ? subDays(range.start, 1) : range.start;
  const fetchEnd = range.isCustom ? addDays(range.end, 1) : range.end;

  // LOAD-BEARING 14-day floor: ManagerDashboard renders a 7-day activity
  // chart and TechnicalDashboard a 14-day one off this same attendance list,
  // and both stay anchored to "the last N days" (they say so on the tin)
  // rather than following the window. Without the floor, `?p=day` would fetch
  // one day of rows and both charts would silently render flat. The matching
  // ceiling exists for the same reason: a custom range ending in the past
  // must not truncate the fetch before today and flatten the charts' tail.
  const attendanceWindowStart = earliest(fetchStart, startOfDay(subDays(now, 14))).toISOString();
  const attendanceWindowEnd = latest(fetchEnd, endOfDay(now)).toISOString();

  // Floor for the four request tables. They feed both the window-scoped
  // Tổng hợp đơn đã gửi and the always-visible approval Sections, so the
  // window is the selected one widened to 90 days — enough recent history
  // for the Sections to stay useful without pulling the entire lifetime of
  // the app. Anything still `pending` is included regardless of age (see the
  // .or() below): a 6-month-old pending request must never fall out of the
  // approve queue.
  const requestsFloor = earliest(fetchStart, startOfDay(subDays(now, 90))).toISOString();
  const recentOrPending = `created_at.gte."${requestsFloor}",status.eq.pending`;

  const [
    { data: staff },
    { data: swaps },
    branches,
    { data: shiftsTodayRows },
    { data: clockedIn },
    { data: leaves },
    { data: windowAttendance },
    { data: shiftRequests },
    { data: attendanceCorrections },
    { data: shiftsOverview },
    permissions,
    { data: shiftSeries },
    // Joined to the batch rather than awaited above it: it depends on none of
    // these queries, so awaiting it first cost every page view an extra
    // serialized round-trip.
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone, role, secondary_role, deactivated_at, profile_branches(branch_id)")
      // Excludes the daily audit routine's dedicated login (0054) — it's
      // not a real employee and would otherwise skew every staff-facing
      // list and the TechnicalDashboard role pie chart fed by staffList.
      .eq("is_monitoring_account", false)
      .order("full_name"),
    supabase
      .from("shift_swap_requests")
      .select(SELECT)
      .or(recentOrPending)
      .order("created_at", { ascending: false }),
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
      .or(recentOrPending)
      .order("created_at", { ascending: false }),
    // Bounded to the selected period (widened to the 14-day chart floor)
    // instead of the whole year. The OR keeps every still-open session no
    // matter how old it is: a Trợ giảng free clock-in has no shift to
    // auto-checkout against (0056), and dropping it would flip that person's
    // "Đang trong ca" badge to "Chưa chấm công" in Tổng hợp chấm công.
    supabase
      .from("attendance")
      .select("*")
      .or(`check_out_at.is.null,check_in_at.gte."${attendanceWindowStart}"`)
      .lte("check_in_at", attendanceWindowEnd)
      .order("check_in_at", { ascending: false }),
    supabase
      .from("shift_requests")
      .select("*, profile:profiles!profile_id(id, full_name, role), branch:branches!branch_id(id, name)")
      .or(recentOrPending)
      .order("created_at", { ascending: false }),
    supabase
      .from("attendance_corrections")
      .select("*, profile:profiles!profile_id(id, full_name, role), shift:shifts!shift_id(id, start_at, end_at)")
      .or(recentOrPending)
      .order("created_at", { ascending: false }),
    // Feeds the "Ca làm việc" section (Xoá ca) and the "Giờ đăng ký" column
    // in Tổng hợp chấm công. Windowed to exactly the resolved range — the
    // same boundaries shiftsInRange() and the table's own filter apply —
    // instead of the old blind .limit(500), which both over-fetched (500 rows
    // for a one-day view) and under-fetched (a busy year past 500 silently
    // lost its oldest shifts). The limit stays purely as a runaway guard, set
    // high enough that at this org's scale it can never trim a real year.
    supabase
      .from("shifts")
      .select(SHIFTS_OVERVIEW_SELECT)
      .gte("start_at", fetchStart.toISOString())
      .lte("start_at", fetchEnd.toISOString())
      .order("start_at", { ascending: false })
      .limit(2000),
    getGroupPermissions(),
    // Ca cố định (0078). Deliberately NOT windowed by the selected range: this
    // is the list of rules, not of occurrences, and a rule whose date range
    // starts next month must still be visible (and deletable) today. RLS
    // already narrows it to the people this manager may schedule.
    supabase
      .from("shift_series")
      .select(
        "*, assignee:profiles!assignee_id(id, full_name, role), branch:branches!branch_id(id, name)"
      )
      .order("created_at", { ascending: false }),
  ]);

  type StaffQueryRow = Pick<
    Profile,
    "id" | "full_name" | "phone" | "role" | "secondary_role" | "deactivated_at"
  > & {
    profile_branches: { branch_id: string }[];
  };
  const staffList = ((staff as StaffQueryRow[] | null) ?? []).map((s) => ({
    id: s.id,
    full_name: s.full_name,
    phone: s.phone,
    role: s.role,
    secondary_role: s.secondary_role,
    deactivated_at: s.deactivated_at,
    branch_ids: s.profile_branches.map((pb) => pb.branch_id),
  }));
  const swapsList = (swaps as SwapRequestDetailed[]) ?? [];
  const leavesList = (leaves as (LeaveRequestDetailed & { profile: ProfileRoleRef })[]) ?? [];
  const clockedInList = (clockedIn as (AttendanceWithProfile & { profile: ProfileRoleRef })[]) ?? [];
  const attendanceList = (windowAttendance as Attendance[]) ?? [];
  const shiftRequestsList = (shiftRequests as ShiftRequestDetailed[]) ?? [];
  const attendanceCorrectionsList = (attendanceCorrections as AttendanceCorrectionDetailed[]) ?? [];
  const shiftsTodayList = (shiftsTodayRows as Pick<{ assignee_id: string }, "assignee_id">[]) ?? [];
  // supabase-js can't infer assignee_id/branch_id as to-one relations
  // without generated DB types, so it defaults the embedded join shape to
  // arrays — cast through unknown since the runtime shape (verified via the
  // query above) is genuinely one assignee/branch per shift row.
  const shiftsOverviewList = (shiftsOverview as unknown as ShiftOverviewRow[]) ?? [];
  // Same cast-through-unknown reason as shiftsOverviewList above: without
  // generated DB types supabase-js models the embedded assignee/branch as
  // arrays, though each series has exactly one of each.
  const shiftSeriesList = (shiftSeries as unknown as ShiftSeriesDetailed[]) ?? [];

  const isTechnical = manager.role === "technical";

  // Trợ giảng's free (shiftless) clock-in — 0056 — has no shift end_at to
  // auto-checkout against (unlike auto_checkout_expired_shifts, 0031), so a
  // forgotten check-out just stays open indefinitely. Only technical gets
  // this list + the manual-backfill action, matching create_attendance_manual's
  // role check.
  const { data: staleFreeAttendanceRows } = isTechnical
    ? await supabase
        .from("attendance")
        .select("*, profile:profiles!profile_id(id, full_name)")
        .is("shift_id", null)
        .is("check_out_at", null)
        .order("check_in_at", { ascending: true })
    : { data: null };
  const staleFreeAttendanceList =
    (staleFreeAttendanceRows as (Attendance & { profile: Pick<Profile, "id" | "full_name"> })[]) ?? [];

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
  const scopedShiftsOverview = rosterRoles
    ? shiftsOverviewList.filter((s) => scopedStaffIds.has(s.assignee.id))
    : shiftsOverviewList;
  const scopedShiftSeries = rosterRoles
    ? shiftSeriesList.filter((s) => scopedStaffIds.has(s.assignee.id))
    : shiftSeriesList;
  // The assignee picker for a new series: the people this manager may schedule,
  // minus anyone deactivated — a fixed weekly shift for someone who has left is
  // the one mistake this feature makes expensive, since it creates dozens of rows.
  const seriesAssignees = scopedStaff.filter((s) => !s.deactivated_at);

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

      {/* key: clicking a period tab strips ?from=/?to= from the URL, so the
          filter must remount to drop the two dates still sitting in its
          local input state — a keyed remount instead of a state-syncing
          effect (react-hooks/set-state-in-effect). */}
      <DateRangeFilter key={`${params.from ?? ""}|${params.to ?? ""}`} spec={rangeSpec} />

      {isTechnical ? (
        <TechnicalDashboard
          staff={staffList}
          attendance={attendanceList}
          leaveRequests={leavesList}
          swapRequests={swapsList}
          shiftRequests={shiftRequestsList}
          attendanceCorrections={attendanceCorrectionsList}
          groupPermissions={permissions}
          staleFreeAttendance={staleFreeAttendanceList}
          branches={branches}
          shifts={scopedShiftsOverview}
          spec={rangeSpec}
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
          shifts={scopedShiftsOverview}
          spec={rangeSpec}
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
          shifts={scopedShiftsOverview}
          spec={rangeSpec}
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
            <StaffTable
              staff={scopedStaff}
              branches={branches}
              currentUserId={manager.id}
              currentUserRole={manager.role}
            />
          </CardContent>
        </Card>
      </Section>

      {/* Kỹ thuật only. Xoá ca is a maintenance tool, not a reporting view —
          CEO/COO/Giám Đốc Đào Tạo/HR read shift totals from the "Giờ đăng ký"
          column in Tổng hợp chấm công instead, so the raw per-shift list just
          added noise to their dashboard. Display gate only: scopedShiftsOverview
          is still computed and still fed to both dashboards. */}
      {isTechnical && (
        <Section id="shifts" title="Ca làm việc" count={scopedShiftsOverview.length}>
          <ShiftsOverviewTable
            shifts={scopedShiftsOverview}
            currentUserRole={manager.role}
            permissions={permissions}
            spec={rangeSpec}
          />
        </Section>
      )}

      {/* Ca cố định — quản lý / giám đốc / kỹ thuật only, the same gate that
          opens the direct-create-shift UI. Staff never set fixed schedules;
          they still send "Đăng ký ca làm" one day at a time. */}
      {canCreateShiftDirectly(manager.role) && (
        <Section id="shift-series" title="Ca cố định" count={scopedShiftSeries.length}>
          <ShiftSeriesSection
            series={scopedShiftSeries}
            branchMembers={seriesAssignees}
            branches={branches}
          />
        </Section>
      )}

      {isShiftRequestApprover(manager.role) && (
        <Section id="shift-requests" title="Đăng ký ca" count={scopedShiftRequests.length}>
          {scopedShiftRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có đăng ký ca làm nào.</p>
          ) : (
            <CollapsibleGrid dates={scopedShiftRequests.map((r) => r.created_at)} className="grid gap-3 lg:grid-cols-2">
              {scopedShiftRequests.map((r) => (
                <ShiftRequestCard
                  key={r.id}
                  request={r}
                  canRespond={r.status === "pending" && canApproveShiftRequestFor(manager.role, r.profile.role, permissions)}
                  canCancel={r.status === "pending"}
                  canDelete={r.status === "pending" && canApproveShiftRequestFor(manager.role, r.profile.role, permissions)}
                  canRevert={false}
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
          <CollapsibleGrid dates={scopedSwaps.map((r) => r.created_at)} className="grid gap-3 lg:grid-cols-2">
            {scopedSwaps.map((r) => (
              <SwapRequestCard
                key={r.id}
                request={r}
                canRespond={
                  r.status === "pending" &&
                  r.target_id !== null &&
                  r.target !== null &&
                  canApproveSwapRequestFor(
                    manager.role,
                    r.requester.role,
                    r.target.role,
                    permissions
                  )
                }
                canCancel={r.status === "pending"}
                canDelete={
                  r.status === "pending" &&
                  r.target_id !== null &&
                  r.target !== null &&
                  canApproveSwapRequestFor(
                    manager.role,
                    r.requester.role,
                    r.target.role,
                    permissions
                  )
                }
                canRevert={false}
              />
            ))}
          </CollapsibleGrid>
        )}
      </Section>

      <Section id="leave" title="Nghỉ phép" count={scopedLeaves.length}>
        {scopedLeaves.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có đơn nghỉ phép nào.</p>
        ) : (
          <CollapsibleGrid dates={scopedLeaves.map((r) => r.created_at)} className="grid gap-3 lg:grid-cols-2">
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
                canDelete={
                  r.status === "pending" &&
                  isLeaveApprover(manager.role) &&
                  canApproveLeaveFor(manager.role, r.profile.role, permissions)
                }
                canRevert={false}
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
          <CollapsibleGrid dates={scopedAttendanceCorrections.map((r) => r.created_at)} className="grid gap-3 lg:grid-cols-2">
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
                canDelete={
                  r.status === "pending" &&
                  isLeaveApprover(manager.role) &&
                  canApproveLeaveFor(manager.role, r.profile.role, permissions)
                }
                canRevert={false}
                showName
              />
            ))}
          </CollapsibleGrid>
        )}
      </Section>
    </div>
  );
}
