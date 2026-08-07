"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildDayBreakdown, buildMonthBreakdown, periodRange, type OverviewPeriod } from "@/lib/attendance";
import type { Attendance } from "@/types";

function formatMinutes(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  return m > 0 ? `${h}g ${m}p` : `${h}g`;
}

const MONTH_ALL = "all";

// The parent (StaffOverviewTable) remounts this via a `key` tied to
// employeeId+period, so selectedMonth naturally resets to MONTH_ALL for a
// new person/period without any manual reset effect here.
export default function StaffAttendanceDetailDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  period,
  attendance,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  employeeName: string;
  period: OverviewPeriod;
  attendance: Attendance[];
}) {
  const now = useMemo(() => new Date(), []);
  const year = now.getFullYear();
  const [selectedMonth, setSelectedMonth] = useState<string>(MONTH_ALL);

  const showMonthPicker = period === "year";
  const isDayBreakdown = period !== "year" || selectedMonth !== MONTH_ALL;

  const dayEntries = useMemo(() => {
    if (!isDayBreakdown) return [];
    let rangeStart: Date;
    let rangeEnd: Date;
    if (period === "year" && selectedMonth !== MONTH_ALL) {
      const monthIndex = Number(selectedMonth) - 1;
      rangeStart = new Date(year, monthIndex, 1, 0, 0, 0, 0);
      rangeEnd = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
    } else {
      const range = periodRange(period, now);
      rangeStart = range.start;
      rangeEnd = range.end;
    }
    return buildDayBreakdown(attendance, employeeId, rangeStart, rangeEnd, now);
  }, [attendance, employeeId, isDayBreakdown, period, selectedMonth, year, now]);

  const monthEntries = useMemo(() => {
    if (isDayBreakdown) return [];
    return buildMonthBreakdown(attendance, employeeId, year, now);
  }, [attendance, employeeId, isDayBreakdown, year, now]);

  const periodTotal = isDayBreakdown
    ? dayEntries.reduce((sum, e) => sum + e.totalMinutes, 0)
    : monthEntries.reduce((sum, e) => sum + e.totalMinutes, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{employeeName}</DialogTitle>
          <DialogDescription>
            {period === "day" && `Hôm nay · ${format(now, "dd/MM/yyyy")}`}
            {period === "month" && `Tháng ${now.getMonth() + 1}/${year}`}
            {period === "year" &&
              (selectedMonth === MONTH_ALL ? `Cả năm ${year}` : `Tháng ${selectedMonth}/${year}`)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <p className="font-heading text-lg font-semibold tabular-nums">Tổng {formatMinutes(periodTotal)}</p>
          {showMonthPicker && (
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MONTH_ALL}>Cả năm</SelectItem>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    Tháng {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {isDayBreakdown ? (
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {dayEntries.map((entry) => (
              <li key={entry.date} className="rounded-md border bg-muted/40 p-2.5 text-sm">
                <div className="flex items-center justify-between">
                  <p className="font-medium capitalize">
                    {format(new Date(`${entry.date}T00:00:00`), "EEEE dd/MM", { locale: vi })}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">{formatMinutes(entry.totalMinutes)}</p>
                </div>
                <div className="mt-1 space-y-0.5">
                  {entry.sessions.map((s, i) => (
                    <p key={i} className="text-xs text-muted-foreground tabular-nums">
                      {format(new Date(s.checkInAt), "HH:mm")}
                      <span className="mx-1">–</span>
                      {s.checkOutAt ? format(new Date(s.checkOutAt), "HH:mm") : "đang làm"}
                    </p>
                  ))}
                </div>
              </li>
            ))}
            {dayEntries.length === 0 && (
              <li className="py-6 text-center text-sm text-muted-foreground">Không có dữ liệu chấm công.</li>
            )}
          </ul>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {monthEntries.map((entry) => (
              <li key={entry.month}>
                <button
                  type="button"
                  onClick={() => setSelectedMonth(String(entry.month))}
                  className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent"
                >
                  <span>Tháng {entry.month}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {entry.totalMinutes > 0 ? formatMinutes(entry.totalMinutes) : "—"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
