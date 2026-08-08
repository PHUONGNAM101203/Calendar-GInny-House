"use client";

import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import StaffRequestsDetailDialog from "@/components/manager/StaffRequestsDetailDialog";
import { buildRequestsOverview } from "@/lib/requests-overview";
import { type OverviewPeriod } from "@/lib/attendance";
import { ROLE_LABELS } from "@/lib/roles";
import TableScroller from "@/components/manager/TableScroller";
import type {
  AttendanceCorrectionDetailed,
  LeaveRequestDetailed,
  Profile,
  ShiftRequestDetailed,
  SwapRequestDetailed,
} from "@/types";

// Vietnamese users commonly type without diacritics when searching — strip
// them from both sides so "nam" matches "Nam" as well as "Năm".
function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Mirrors StaffOverviewTable's shape/UX (period tabs, search, click-to-drill-
// down) but for "how many of each request type did each person submit" —
// a convenient activity overview, separate from the approval queue.
export default function RequestsOverviewTable({
  title = "Tổng hợp đơn đã gửi",
  staff,
  leaveRequests,
  swapRequests,
  shiftRequests,
  attendanceCorrections,
}: {
  title?: string;
  staff: Pick<Profile, "id" | "full_name" | "role">[];
  leaveRequests: LeaveRequestDetailed[];
  swapRequests: SwapRequestDetailed[];
  shiftRequests: ShiftRequestDetailed[];
  attendanceCorrections: AttendanceCorrectionDetailed[];
}) {
  const [period, setPeriod] = useState<OverviewPeriod>("month");
  const [search, setSearch] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState<{ id: string; fullName: string } | null>(null);

  const allRows = useMemo(
    () => buildRequestsOverview(staff, leaveRequests, swapRequests, shiftRequests, attendanceCorrections, period),
    [staff, leaveRequests, swapRequests, shiftRequests, attendanceCorrections, period]
  );
  const rows = useMemo(() => {
    const query = normalizeForSearch(search.trim());
    if (!query) return allRows;
    return allRows.filter((row) => normalizeForSearch(row.fullName).includes(query));
  }, [allRows, search]);

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

      <TableScroller visibleRows={10}>
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="border-b border-r px-3 py-2 font-medium">Nhân viên</th>
              <th className="border-b border-r px-3 py-2 font-medium">Vai trò</th>
              <th className="border-b border-r px-3 py-2 text-right font-medium">Nghỉ phép</th>
              <th className="border-b border-r px-3 py-2 text-right font-medium">Đổi ca</th>
              <th className="border-b border-r px-3 py-2 text-right font-medium">Đăng ký ca</th>
              <th className="border-b border-r px-3 py-2 text-right font-medium">Giải trình công</th>
              <th className="border-b px-3 py-2 text-right font-medium">Tổng</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer transition-colors hover:bg-accent/40"
                onClick={() => setSelectedEmployee({ id: row.id, fullName: row.fullName })}
              >
                <td className="border-b border-r px-3 py-2 font-medium">{row.fullName}</td>
                <td className="border-b border-r px-3 py-2 text-muted-foreground">{ROLE_LABELS[row.role]}</td>
                <td className="border-b border-r px-3 py-2 text-right tabular-nums">
                  {row.leaveCount || <span className="text-muted-foreground">—</span>}
                </td>
                <td className="border-b border-r px-3 py-2 text-right tabular-nums">
                  {row.swapCount || <span className="text-muted-foreground">—</span>}
                </td>
                <td className="border-b border-r px-3 py-2 text-right tabular-nums">
                  {row.shiftRequestCount || <span className="text-muted-foreground">—</span>}
                </td>
                <td className="border-b border-r px-3 py-2 text-right tabular-nums">
                  {row.correctionCount || <span className="text-muted-foreground">—</span>}
                </td>
                <td className="border-b px-3 py-2 text-right font-medium tabular-nums">{row.total}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  {search.trim() ? "Không tìm thấy nhân viên phù hợp." : "Chưa có đơn nào."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableScroller>

      {selectedEmployee && (
        <StaffRequestsDetailDialog
          key={`${selectedEmployee.id}-${period}`}
          open={Boolean(selectedEmployee)}
          onOpenChange={(next) => {
            if (!next) setSelectedEmployee(null);
          }}
          employeeId={selectedEmployee.id}
          employeeName={selectedEmployee.fullName}
          period={period}
          leaveRequests={leaveRequests}
          swapRequests={swapRequests}
          shiftRequests={shiftRequests}
          attendanceCorrections={attendanceCorrections}
        />
      )}
    </div>
  );
}
