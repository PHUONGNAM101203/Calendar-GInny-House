import { startOfDay, endOfDay, startOfYear } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth";
import { getBranches } from "@/lib/branches";
import {
  isOperationsGroupRole,
  isCeo,
  isLeaveApprover,
  canApproveLeaveFor,
  canApproveShiftRequestFor,
  isManagerRole,
} from "@/lib/roles";
import { Card, CardContent } from "@/components/ui/card";
import ManagerDashboard from "@/components/manager/ManagerDashboard";
import TechnicalDashboard from "@/components/manager/TechnicalDashboard";
import StaffTable from "@/components/manager/StaffTable";
import SwapRequestCard from "@/components/swaps/SwapRequestCard";
import LeaveRequestCard from "@/components/leave/LeaveRequestCard";
import ShiftRequestCard from "@/components/shifts/ShiftRequestCard";
import type {
  Attendance,
  AttendanceWithProfile,
  LeaveRequestDetailed,
  Profile,
  ShiftRequestDetailed,
  SwapRequestDetailed,
} from "@/types";

const SELECT = `
  *,
  requester:profiles!requester_id(id, full_name),
  target:profiles!target_id(id, full_name),
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
          <span className="font-mono text-xs text-muted-foreground">{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}

export default async function ManagerPage() {
  const manager = await requireManager();
  const supabase = await createClient();
  const todayStart = startOfDay(new Date()).toISOString();
  const todayEnd = endOfDay(new Date()).toISOString();
  // One fetch covers the whole page now that it's a single scroll, not a
  // per-tab lazy load — every section below reads from these same arrays.
  const yearWindowStart = startOfYear(new Date()).toISOString();

  const [
    { data: staff },
    { data: swaps },
    branches,
    { count: shiftsToday },
    { data: clockedIn },
    { data: leaves },
    { data: yearAttendance },
    { data: shiftRequests },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone, role, branch_id")
      .order("full_name"),
    supabase.from("shift_swap_requests").select(SELECT).order("created_at", { ascending: false }),
    getBranches(),
    supabase
      .from("shifts")
      .select("*", { count: "exact", head: true })
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
    supabase
      .from("attendance")
      .select("*")
      .gte("check_in_at", yearWindowStart)
      .order("check_in_at", { ascending: false }),
    supabase
      .from("shift_requests")
      .select("*, profile:profiles!profile_id(id, full_name, role)")
      .order("created_at", { ascending: false }),
  ]);

  const staffList = (staff as Pick<Profile, "id" | "full_name" | "phone" | "role" | "branch_id">[]) ?? [];
  const swapsList = (swaps as SwapRequestDetailed[]) ?? [];
  const leavesList = (leaves as (LeaveRequestDetailed & { profile: ProfileRoleRef })[]) ?? [];
  const clockedInList = (clockedIn as (AttendanceWithProfile & { profile: ProfileRoleRef })[]) ?? [];
  const attendanceList = (yearAttendance as Attendance[]) ?? [];
  const shiftRequestsList = (shiftRequests as ShiftRequestDetailed[]) ?? [];

  const isCoo = manager.role === "coo";
  const isTechnical = manager.role === "technical";
  const managerIsCeo = isCeo(manager.role);
  const opsStaff = staffList.filter((s) => isOperationsGroupRole(s.role));
  const opsStaffIds = new Set(opsStaff.map((s) => s.id));
  const opsClockedIn = clockedInList.filter((a) => isOperationsGroupRole(a.profile.role));
  const opsAttendance = attendanceList.filter((a) => opsStaffIds.has(a.profile_id));
  const opsLeaves = leavesList.filter((l) => isOperationsGroupRole(l.profile.role));

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 space-y-8 overflow-y-auto p-4 sm:p-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Quản lý</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Theo dõi nhân sự và yêu cầu đổi ca trong cơ sở của bạn.
        </p>
      </div>

      {isTechnical ? (
        <TechnicalDashboard staff={staffList} attendance={attendanceList} leaveRequests={leavesList} />
      ) : (
        <ManagerDashboard
          totalStaff={staffList.length}
          unassignedStaff={staffList.filter((s) => !s.branch_id && !isManagerRole(s.role)).length}
          shiftsToday={shiftsToday ?? 0}
          pendingSwaps={swapsList.filter((s) => s.status === "pending").length}
          pendingLeave={leavesList.filter((l) => l.status === "pending").length}
          clockedInCount={clockedInList.length}
          staff={staffList}
          attendance={attendanceList}
          leaveRequests={leavesList}
        />
      )}

      {isCoo && (
        <Section title="Nhóm vận hành">
          <p className="mb-4 text-sm text-muted-foreground">
            HR, CSKH và Nhân viên vận hành — {opsStaff.length} người.
          </p>
          <div className="space-y-4">
            <ManagerDashboard
              totalStaff={opsStaff.length}
              unassignedStaff={opsStaff.filter((s) => !s.branch_id).length}
              shiftsToday={shiftsToday ?? 0}
              pendingSwaps={swapsList.filter(
                (s) => s.status === "pending" && opsStaff.some((m) => m.id === s.requester_id)
              ).length}
              pendingLeave={opsLeaves.filter((l) => l.status === "pending").length}
              clockedInCount={opsClockedIn.length}
              staff={opsStaff}
              attendance={opsAttendance}
              leaveRequests={opsLeaves}
              overviewTitle="Tổng hợp chấm công — Nhóm vận hành"
            />
            <Card>
              <CardContent>
                <StaffTable staff={opsStaff} branches={branches} currentUserId={manager.id} />
              </CardContent>
            </Card>
          </div>
        </Section>
      )}

      <Section id="staff" title="Nhân viên" count={staffList.length}>
        <Card>
          <CardContent>
            <StaffTable staff={staffList} branches={branches} currentUserId={manager.id} />
          </CardContent>
        </Card>
      </Section>

      {(managerIsCeo || manager.role === "hr") && (
        <Section title="Đăng ký ca" count={shiftRequestsList.length}>
          {shiftRequestsList.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có đăng ký ca làm nào.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {shiftRequestsList.map((r) => (
                <ShiftRequestCard
                  key={r.id}
                  request={r}
                  canRespond={r.status === "pending" && canApproveShiftRequestFor(manager.role, r.profile.role)}
                  canCancel={r.status === "pending"}
                  showName
                />
              ))}
            </div>
          )}
        </Section>
      )}

      <Section id="swaps" title="Yêu cầu đổi ca" count={swapsList.length}>
        {swapsList.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có yêu cầu đổi ca nào.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {swapsList.map((r) => (
              <SwapRequestCard key={r.id} request={r} canRespond={false} canCancel={r.status === "pending"} />
            ))}
          </div>
        )}
      </Section>

      <Section id="leave" title="Nghỉ phép" count={leavesList.length}>
        {leavesList.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có đơn nghỉ phép nào.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {leavesList.map((r) => (
              <LeaveRequestCard
                key={r.id}
                request={r}
                canRespond={
                  r.status === "pending" &&
                  isLeaveApprover(manager.role) &&
                  canApproveLeaveFor(manager.role, r.profile.role)
                }
                canCancel={r.status === "pending"}
                showName
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
