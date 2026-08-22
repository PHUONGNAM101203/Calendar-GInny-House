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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import CollapsibleGrid from "@/components/manager/CollapsibleGrid";
import type { ShiftOverviewRow } from "@/components/manager/ShiftsOverviewTable";
import {
  buildAttendanceEntries,
  formatHours,
  shiftsInRange,
  sumShiftMinutes,
  type OverviewRange,
} from "@/lib/attendance";
import { SHIFT_TYPE_LABELS } from "@/lib/constants";
import { computeShiftKind, SHIFT_KIND_LABELS } from "@/lib/shift-kind-tag";
import type { Attendance } from "@/types";

// Full list of this person's shifts within the selected window — ngày/tháng/
// năm or an explicit khoảng ngày, arriving as the very same `range` object
// the parent table clipped its own rows with, so Giờ đăng ký and this total
// can never drift apart. Each is tagged by what duty it actually was (Ca
// quản sinh/Ca trợ giảng/Ca lễ tân/...) — not an attendance/check-in
// breakdown, since "Toàn hệ thống"'s own Giờ làm/Trạng thái columns already
// cover that. CollapsibleGrid caps it at ~4 visible with "Xem thêm" so a busy
// month doesn't turn into a scroll of shifts.
export default function StaffAttendanceDetailDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  range,
  shifts,
  attendance,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  employeeName: string;
  range: OverviewRange;
  shifts: ShiftOverviewRow[];
  attendance: Attendance[];
}) {
  const now = useMemo(() => new Date(), []);

  const personShifts = useMemo(
    () => shiftsInRange(shifts, employeeId, range),
    [shifts, employeeId, range]
  );

  const totalShiftMinutes = useMemo(() => sumShiftMinutes(personShifts), [personShifts]);

  const attendanceEntries = useMemo(
    () => buildAttendanceEntries(attendance, employeeId, range, now),
    [attendance, employeeId, range, now]
  );
  const totalAttendanceMinutes = useMemo(
    () => attendanceEntries.reduce((sum, e) => sum + e.minutes, 0),
    [attendanceEntries]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{employeeName}</DialogTitle>
          <DialogDescription>
            {range.isCustom
              ? `${format(range.start, "dd/MM/yyyy")} – ${format(range.end, "dd/MM/yyyy")}`
              : range.period === "day"
                ? `Hôm nay · ${format(now, "dd/MM/yyyy")}`
                : range.period === "month"
                  ? `Tháng ${now.getMonth() + 1}/${now.getFullYear()}`
                  : `Cả năm ${now.getFullYear()}`}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="shifts">
          <TabsList className="w-full">
            <TabsTrigger value="shifts" className="flex-1">
              Tổng số giờ đăng ký
            </TabsTrigger>
            <TabsTrigger value="attendance" className="flex-1">
              Chấm công
            </TabsTrigger>
          </TabsList>

          <TabsContent value="shifts" className="space-y-3">
            <p className="font-heading text-lg font-semibold tabular-nums">
              Tổng {formatHours(totalShiftMinutes)}
            </p>

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
          </TabsContent>

          <TabsContent value="attendance" className="space-y-3">
            <p className="font-heading text-lg font-semibold tabular-nums">
              Tổng {formatHours(totalAttendanceMinutes)}
            </p>

            {attendanceEntries.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Không có dữ liệu chấm công trong kỳ đã chọn.
              </p>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                <CollapsibleGrid className="space-y-2">
                  {attendanceEntries.map((entry) => (
                    <div key={entry.id} className="rounded-md border bg-muted/40 p-2.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium capitalize">
                          {format(new Date(entry.checkInAt), "EEEE dd/MM", { locale: vi })}
                        </p>
                        <Badge variant="outline">{formatHours(entry.minutes)}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                        {format(new Date(entry.checkInAt), "HH:mm")}–
                        {entry.checkOutAt ? format(new Date(entry.checkOutAt), "HH:mm") : "đang trong ca"}
                      </p>
                    </div>
                  ))}
                </CollapsibleGrid>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
