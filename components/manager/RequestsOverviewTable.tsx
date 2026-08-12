"use client";

import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import StaffRequestsDetailDialog from "@/components/manager/StaffRequestsDetailDialog";
import { buildRequestsOverview } from "@/lib/requests-overview";
import { type OverviewPeriod } from "@/lib/attendance";
import { getRoleLabel } from "@/lib/roles";
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
  staff: Pick<Profile, "id" | "full_name" | "role" | "secondary_role">[];
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
              <th className="hidden border-b border-r px-3 py-2 font-medium lg:table-cell">Vai trò</th>
              <th className="hidden border-b border-r px-3 py-2 text-right font-medium lg:table-cell">Nghỉ phép</th>
              <th className="hidden border-b border-r px-3 py-2 text-right font-medium lg:table-cell">Đổi ca</th>
              <th className="hidden border-b border-r px-3 py-2 text-right font-medium lg:table-cell">Đăng ký ca</th>
              <th className="hidden border-b border-r px-3 py-2 text-right font-medium lg:table-cell">Giải trình công</th>
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
                <td className="border-b border-r px-3 py-2 font-medium">
                  {row.fullName}
                  <span className="block text-xs font-normal text-muted-foreground lg:hidden">
                    {getRoleLabel({ role: row.role, secondary_role: row.secondaryRole })}
                  </span>
                  {/* Bốn cột đếm bị ẩn ở màn hẹp, nhưng phần lớn ô của chúng là
                      "—". Nên thay vì nhồi 4 cột rỗng, chỉ hiện loại đơn nào
                      thực sự có số. Chi tiết đầy đủ vẫn nằm trong dialog khi
                      bấm vào dòng. */}
                  {row.total > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1 lg:hidden">
                      {([
                        ["Nghỉ phép", row.leaveCount],
                        ["Đổi ca", row.swapCount],
                        ["Đăng ký", row.shiftRequestCount],
                        ["Giải trình", row.correctionCount],
                      ] as const)
                        .filter(([, n]) => n > 0)
                        .map(([label, n]) => (
                          <span
                            key={label}
                            className="inline-flex rounded-full bg-accent px-2 py-0.5 text-xs font-normal text-accent-foreground"
                          >
                            {label} {n}
                          </span>
                        ))}
                    </span>
                  )}
                </td>
                <td className="hidden border-b border-r px-3 py-2 text-muted-foreground lg:table-cell">{getRoleLabel({ role: row.role, secondary_role: row.secondaryRole })}</td>
                <td className="hidden border-b border-r px-3 py-2 text-right tabular-nums lg:table-cell">
                  {row.leaveCount || <span className="text-muted-foreground">—</span>}
                </td>
                <td className="hidden border-b border-r px-3 py-2 text-right tabular-nums lg:table-cell">
                  {row.swapCount || <span className="text-muted-foreground">—</span>}
                </td>
                <td className="hidden border-b border-r px-3 py-2 text-right tabular-nums lg:table-cell">
                  {row.shiftRequestCount || <span className="text-muted-foreground">—</span>}
                </td>
                <td className="hidden border-b border-r px-3 py-2 text-right tabular-nums lg:table-cell">
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
