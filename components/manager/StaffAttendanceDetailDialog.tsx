"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import CollapsibleGrid from "@/components/manager/CollapsibleGrid";
import type { ShiftOverviewRow } from "@/components/manager/ShiftsOverviewTable";
import { periodRange, type OverviewPeriod } from "@/lib/attendance";
import { SHIFT_TYPE_LABELS } from "@/lib/constants";
import { computeShiftKind, SHIFT_KIND_LABELS } from "@/lib/shift-kind-tag";

// Full list of this person's shifts within the selected period (ngày/tháng/
// năm — same period the parent table's tabs already picked), each tagged by
// what duty it actually was (Ca quản sinh/Ca trợ giảng/Ca lễ tân/...) — not
// an attendance/check-in breakdown, since "Toàn hệ thống"'s own Giờ làm/
// Trạng thái columns already cover that. CollapsibleGrid caps it at ~4
// visible with "Xem thêm" so a busy month doesn't turn into a scroll of
// shifts.
export default function StaffAttendanceDetailDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  period,
  shifts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  employeeName: string;
  period: OverviewPeriod;
  shifts: ShiftOverviewRow[];
}) {
  const now = useMemo(() => new Date(), []);

  const personShifts = useMemo(() => {
    const { start, end } = periodRange(period, now);
    return shifts
      .filter((s) => s.assignee.id === employeeId)
      .filter((s) => {
        const t = new Date(s.start_at);
        return t >= start && t <= end;
      })
      .sort((a, b) => b.start_at.localeCompare(a.start_at));
  }, [shifts, employeeId, period, now]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{employeeName}</DialogTitle>
          <DialogDescription>
            {period === "day" && `Hôm nay · ${format(now, "dd/MM/yyyy")}`}
            {period === "month" && `Tháng ${now.getMonth() + 1}/${now.getFullYear()}`}
            {period === "year" && `Cả năm ${now.getFullYear()}`}
          </DialogDescription>
        </DialogHeader>

        <p className="font-heading text-lg font-semibold tabular-nums">{personShifts.length} ca</p>

        {personShifts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Không có ca nào trong kỳ đã chọn.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            <CollapsibleGrid className="space-y-2">
              {personShifts.map((shift) => (
                <div key={shift.id} className="rounded-md border bg-muted/40 p-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium capitalize">
                      {format(new Date(shift.start_at), "EEEE dd/MM", { locale: vi })}
                    </p>
                    <Badge variant="outline">{SHIFT_KIND_LABELS[computeShiftKind(shift.assignee)]}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                    {format(new Date(shift.start_at), "HH:mm")}–{format(new Date(shift.end_at), "HH:mm")}
                    <span className="mx-1.5">·</span>
                    {SHIFT_TYPE_LABELS[shift.shift_type]}
                    {shift.branch && (
                      <>
                        <span className="mx-1.5">·</span>
                        {shift.branch.name}
                      </>
                    )}
                  </p>
                </div>
              ))}
            </CollapsibleGrid>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
