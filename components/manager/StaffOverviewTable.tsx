"use client";

import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import StaffAttendanceDetailDialog from "@/components/manager/StaffAttendanceDetailDialog";
import type { ShiftOverviewRow } from "@/components/manager/ShiftsOverviewTable";
import {
  buildStaffOverview,
  formatHours,
  shiftsInPeriod,
  sumShiftMinutes,
  type OverviewPeriod,
} from "@/lib/attendance";
import { getRoleLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";
import TableScroller from "@/components/manager/TableScroller";
import type { Attendance, LeaveRequest, Profile } from "@/types";

// Vietnamese users commonly type without diacritics when searching — strip
// them from both sides so "nam" matches "Nam" as well as "Năm".
function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const STATUS_LABEL = {
  in_shift: "Đang trong ca",
  checked_out: "Đã checkout",
  not_clocked: "Chưa chấm công",
} as const;

export default function StaffOverviewTable({
  title = "Tổng hợp chấm công",
  staff,
  attendance,
  leaveRequests,
  shifts,
}: {
  title?: string;
  staff: Pick<Profile, "id" | "full_name" | "role" | "secondary_role">[];
  attendance: Attendance[];
  leaveRequests: Pick<LeaveRequest, "profile_id" | "start_date" | "end_date" | "status">[];
  shifts: ShiftOverviewRow[];
}) {
  const [period, setPeriod] = useState<OverviewPeriod>("day");
  const [search, setSearch] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState<{ id: string; fullName: string } | null>(null);
  const allRows = useMemo(
    () => buildStaffOverview(staff, attendance, leaveRequests, period),
    [staff, attendance, leaveRequests, period]
  );
  const rows = useMemo(() => {
    const query = normalizeForSearch(search.trim());
    if (!query) return allRows;
    return allRows.filter((row) => normalizeForSearch(row.fullName).includes(query));
  }, [allRows, search]);

  // Frozen at mount so every row shares one period boundary — a `new Date()`
  // per row could straddle midnight mid-render.
  const now = useMemo(() => new Date(), []);
  // Registered-shift hours per person, so a manager sees committed vs actual
  // side by side without opening each popup. Computed off the `shifts` prop
  // that was already being forwarded to the dialog — no extra query — and via
  // the same helpers the dialog uses, so the row and the popup always agree.
  const registeredMinutesById = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of allRows) {
      totals.set(row.id, sumShiftMinutes(shiftsInPeriod(shifts, row.id, period, now)));
    }
    return totals;
  }, [allRows, shifts, period, now]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading text-base font-semibold">{title}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={period} onValueChange={(v) => setPeriod(v as OverviewPeriod)}>
            <TabsList>
              <TabsTrigger value="day">Theo ngày</TabsTrigger>
              <TabsTrigger value="month">Theo tháng</TabsTrigger>
              <TabsTrigger value="year">Theo năm</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm nhân viên..."
              className="h-8 w-40 pl-8 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Deliberately a real bordered grid, not cards — a manager scanning
          headcount x hours x status wants a spreadsheet, one row per
          person, not a stack of prose. */}
      <TableScroller visibleRows={10}>
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="border-b border-r px-3 py-2 font-medium">Nhân viên</th>
              <th className="hidden border-b border-r px-3 py-2 font-medium lg:table-cell">Vai trò</th>
              <th className="border-b border-r px-3 py-2 font-medium">Giờ làm</th>
              <th className="border-b border-r px-3 py-2 font-medium">Giờ đăng ký</th>
              <th className="border-b border-r px-3 py-2 font-medium">Trạng thái</th>
              <th className="hidden border-b px-3 py-2 font-medium lg:table-cell">Nghỉ phép hôm nay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer transition-colors hover:bg-accent/40"
                onClick={() => setSelectedEmployee({ id: row.id, fullName: row.fullName })}
              >
                <td className="border-b border-r px-3 py-2 font-medium">
                  {row.fullName}
                  {/* Vai trò chui xuống dưới tên khi cột riêng của nó bị ẩn —
                      đổi chỗ chứ không cắt bỏ, nên điện thoại không mất thông tin. */}
                  <span className="block text-xs font-normal text-muted-foreground lg:hidden">
                    {getRoleLabel({ role: row.role, secondary_role: row.secondaryRole })}
                  </span>
                </td>
                <td className="hidden border-b border-r px-3 py-2 text-muted-foreground lg:table-cell">
                  {getRoleLabel({ role: row.role, secondary_role: row.secondaryRole })}
                </td>
                <td className="border-b border-r px-3 py-2 tabular-nums">
                  {formatHours(row.totalMinutes)}
                </td>
                <td className="border-b border-r px-3 py-2 tabular-nums">
                  {formatHours(registeredMinutesById.get(row.id) ?? 0)}
                </td>
                <td className="border-b border-r px-3 py-2">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                      row.status === "in_shift" && "bg-primary/15 text-primary",
                      row.status === "checked_out" && "bg-muted text-muted-foreground",
                      row.status === "not_clocked" &&
                        "border border-dashed border-muted-foreground/40 text-muted-foreground"
                    )}
                  >
                    {STATUS_LABEL[row.status]}
                  </span>
                  {/* Ở hẹp, cột "Nghỉ phép hôm nay" bị ẩn — huy hiệu bám theo
                      trạng thái để tin đó không biến mất khỏi màn hình nhỏ. */}
                  {row.onLeaveToday && (
                    <span className="ml-1.5 inline-flex rounded-full bg-gold/20 px-2 py-0.5 text-xs font-medium text-gold-foreground lg:hidden">
                      Nghỉ phép
                    </span>
                  )}
                </td>
                <td className="hidden border-b px-3 py-2 lg:table-cell">
                  {row.onLeaveToday ? (
                    <span className="inline-flex rounded-full bg-gold/20 px-2 py-0.5 text-xs font-medium text-gold-foreground">
                      Nghỉ phép
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  {search.trim() ? "Không tìm thấy nhân viên phù hợp." : "Chưa có dữ liệu."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableScroller>

      {selectedEmployee && (
        <StaffAttendanceDetailDialog
          key={`${selectedEmployee.id}-${period}`}
          open={Boolean(selectedEmployee)}
          onOpenChange={(next) => {
            if (!next) setSelectedEmployee(null);
          }}
          employeeId={selectedEmployee.id}
          employeeName={selectedEmployee.fullName}
          period={period}
          shifts={shifts}
          attendance={attendance}
        />
      )}
    </div>
  );
}
