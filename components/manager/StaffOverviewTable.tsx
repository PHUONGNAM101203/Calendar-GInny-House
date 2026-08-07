"use client";

import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { buildStaffOverview, type OverviewPeriod } from "@/lib/attendance";
import { ROLE_LABELS } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { Attendance, LeaveRequest, Profile } from "@/types";

// Vietnamese users commonly type without diacritics when searching — strip
// them from both sides so "nam" matches "Nam" as well as "Năm".
function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function formatHours(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  return m > 0 ? `${h}g ${m}p` : `${h}g`;
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
}: {
  title?: string;
  staff: Pick<Profile, "id" | "full_name" | "role">[];
  attendance: Attendance[];
  leaveRequests: Pick<LeaveRequest, "profile_id" | "start_date" | "end_date" | "status">[];
}) {
  const [period, setPeriod] = useState<OverviewPeriod>("day");
  const [search, setSearch] = useState("");
  const allRows = useMemo(
    () => buildStaffOverview(staff, attendance, leaveRequests, period),
    [staff, attendance, leaveRequests, period]
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

      {/* Deliberately a real bordered grid, not cards — a manager scanning
          headcount x hours x status wants a spreadsheet, one row per
          person, not a stack of prose. */}
      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="border-b border-r px-3 py-2 font-medium">Nhân viên</th>
              <th className="border-b border-r px-3 py-2 font-medium">Vai trò</th>
              <th className="border-b border-r px-3 py-2 font-medium">Giờ làm</th>
              <th className="border-b border-r px-3 py-2 font-medium">Trạng thái</th>
              <th className="border-b px-3 py-2 font-medium">Nghỉ phép hôm nay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="transition-colors hover:bg-accent/40">
                <td className="border-b border-r px-3 py-2 font-medium">{row.fullName}</td>
                <td className="border-b border-r px-3 py-2 text-muted-foreground">
                  {ROLE_LABELS[row.role]}
                </td>
                <td className="border-b border-r px-3 py-2 tabular-nums">
                  {formatHours(row.totalMinutes)}
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
                </td>
                <td className="border-b px-3 py-2">
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
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  {search.trim() ? "Không tìm thấy nhân viên phù hợp." : "Chưa có dữ liệu."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
