"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { AlertTriangleIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import StaffOverviewTable from "@/components/manager/StaffOverviewTable";
import type { ShiftOverviewRow } from "@/components/manager/ShiftsOverviewTable";
import RequestsOverviewTable from "@/components/manager/RequestsOverviewTable";
import GroupPermissionsEditor, { type ManagerHolders } from "@/components/manager/GroupPermissionsEditor";
import CreateAttendanceManualDialog from "@/components/manager/CreateAttendanceManualDialog";
import { GROUP_MANAGER_ROLES } from "@/lib/permissions";
import { aggregateStaffByRole, aggregateHoursByDay } from "@/lib/attendance";
import { ROLE_LABELS } from "@/lib/roles";
import type { GroupPermissions } from "@/lib/permissions";
import type {
  Attendance,
  AttendanceCorrectionDetailed,
  Branch,
  LeaveRequestDetailed,
  Profile,
  ShiftRequestDetailed,
  SwapRequestDetailed,
} from "@/types";

// Title + a real headline number, nothing else — no icon chip. The number
// alone (staff count / total hours) already tells you what the chart below
// is about.
function ChartCardHeader({ title, total }: { title: string; total?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h3 className="font-heading text-base font-semibold">{title}</h3>
      {total && (
        <span className="text-sm font-medium tabular-nums text-muted-foreground">{total}</span>
      )}
    </div>
  );
}

// recharts is ~300KB and both charts sit below the fold, behind the stale
// check-out list and the permissions editor a technical user actually comes
// here for. ssr: false for the same reason ShiftCalendarLoader forces it —
// these charts measure their own container to lay out, which the server has
// no DOM to do, so SSR only produced markup that hydration threw away.
const RolePieChart = dynamic(() => import("@/components/manager/RolePieChart"), {
  ssr: false,
  loading: () => <Skeleton className="size-full" />,
});
const HoursAreaChart = dynamic(() => import("@/components/manager/HoursAreaChart"), {
  ssr: false,
  loading: () => <Skeleton className="size-full" />,
});

// Same 6-hue set the calendar already uses for people, reused here so the
// dashboard doesn't introduce a second, unrelated color language.
const ROLE_PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--gold)",
  "var(--success)",
  "var(--muted-foreground)",
  "var(--destructive)",
];

export default function TechnicalDashboard({
  staff,
  attendance,
  leaveRequests,
  swapRequests,
  shiftRequests,
  attendanceCorrections,
  groupPermissions,
  staleFreeAttendance,
  branches,
  shifts,
}: {
  staff: Pick<Profile, "id" | "full_name" | "role" | "secondary_role">[];
  attendance: Attendance[];
  leaveRequests: LeaveRequestDetailed[];
  swapRequests: SwapRequestDetailed[];
  shiftRequests: ShiftRequestDetailed[];
  attendanceCorrections: AttendanceCorrectionDetailed[];
  groupPermissions: GroupPermissions;
  /** Trợ giảng free (shiftless) sessions still open — see 0056. Technical only. */
  staleFreeAttendance: (Attendance & { profile: Pick<Profile, "id" | "full_name"> })[];
  branches: Branch[];
  shifts: ShiftOverviewRow[];
}) {
  const roleCounts = aggregateStaffByRole(staff);
  const hoursByDay = aggregateHoursByDay(attendance);
  const totalHours = Math.round(hoursByDay.reduce((sum, d) => sum + d.hours, 0));
  const peakDay = useMemo(
    () => hoursByDay.reduce((max, d) => (d.hours > max.hours ? d : max), hoursByDay[0]),
    [hoursByDay]
  );

  // Who actually holds each manager role right now — the permissions editor
  // titles its cards with the person's name rather than an abstract group
  // label. Kept as an array per role because nothing stops two people sharing
  // one role, and silently showing only the first would hide that.
  const managerHolders: ManagerHolders = useMemo(() => {
    const byRole: ManagerHolders = {};
    for (const role of GROUP_MANAGER_ROLES) {
      const names = staff.filter((s) => s.role === role).map((s) => s.full_name);
      if (names.length > 0) byRole[role] = names;
    }
    return byRole;
  }, [staff]);

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold">Chấm công trợ giảng chưa chấm ra</h2>
          <CreateAttendanceManualDialog staff={staff} branches={branches} />
        </div>
        {staleFreeAttendance.length === 0 ? (
          <p className="text-sm text-muted-foreground">Không có phiên nào đang mở quá lâu.</p>
        ) : (
          <ul className="space-y-2">
            {staleFreeAttendance.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-xl border border-gold/40 bg-gold/10 px-4 py-2.5 text-sm"
              >
                <AlertTriangleIcon className="size-4 shrink-0 text-gold-foreground" />
                <span className="font-medium">{a.profile.full_name}</span>
                <span className="text-muted-foreground">
                  vào lúc {format(new Date(a.check_in_at), "HH:mm dd/MM/yyyy", { locale: vi })}, chưa chấm ra
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="mb-3 font-heading text-lg font-semibold">Phân quyền theo nhóm</h2>
        <GroupPermissionsEditor permissions={groupPermissions} managerHolders={managerHolders} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="transition-shadow hover:shadow-md">
          <CardContent>
            <ChartCardHeader title="Nhân sự theo vai trò" total={`${staff.length} người`} />
            <div className="relative h-64">
              <RolePieChart data={roleCounts} colors={ROLE_PIE_COLORS} />
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-heading text-2xl font-semibold tabular-nums">{staff.length}</span>
                <span className="text-xs text-muted-foreground">người</span>
              </div>
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {roleCounts.map((r, i) => (
                <li key={r.role} className="flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: ROLE_PIE_COLORS[i % ROLE_PIE_COLORS.length] }}
                  />
                  {ROLE_LABELS[r.role]} · {r.count}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="transition-shadow hover:shadow-md">
          <CardContent>
            <ChartCardHeader title="Giờ làm toàn hệ thống · 14 ngày qua" total={`${totalHours} giờ`} />
            <div className="h-64">
              <HoursAreaChart data={hoursByDay} gradientId="techHoursFill" peakDay={peakDay} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent>
          <StaffOverviewTable
            title="Toàn hệ thống"
            staff={staff}
            attendance={attendance}
            leaveRequests={leaveRequests}
            shifts={shifts}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <RequestsOverviewTable
            title="Tổng hợp đơn đã gửi — Toàn hệ thống"
            staff={staff}
            leaveRequests={leaveRequests}
            swapRequests={swapRequests}
            shiftRequests={shiftRequests}
            attendanceCorrections={attendanceCorrections}
            canRevert={true}
          />
        </CardContent>
      </Card>
    </div>
  );
}
