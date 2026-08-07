"use client";

import { useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import LeaveRequestCard from "@/components/leave/LeaveRequestCard";
import SwapRequestCard from "@/components/swaps/SwapRequestCard";
import ShiftRequestCard from "@/components/shifts/ShiftRequestCard";
import AttendanceCorrectionCard from "@/components/attendance/AttendanceCorrectionCard";
import { periodRange, type OverviewPeriod } from "@/lib/attendance";
import type {
  AttendanceCorrectionDetailed,
  LeaveRequestDetailed,
  ShiftRequestDetailed,
  SwapRequestDetailed,
} from "@/types";

// Read-only activity feed for one person in one period — approving/rejecting
// happens in the per-type Sections further down /manager, not here.
export default function StaffRequestsDetailDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  period,
  leaveRequests,
  swapRequests,
  shiftRequests,
  attendanceCorrections,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  employeeName: string;
  period: OverviewPeriod;
  leaveRequests: LeaveRequestDetailed[];
  swapRequests: SwapRequestDetailed[];
  shiftRequests: ShiftRequestDetailed[];
  attendanceCorrections: AttendanceCorrectionDetailed[];
}) {
  const items = useMemo(() => {
    const { start, end } = periodRange(period, new Date());
    const inRange = (createdAt: string) => {
      const t = new Date(createdAt);
      return t >= start && t <= end;
    };

    const entries: { key: string; createdAt: string; node: React.ReactNode }[] = [];

    for (const r of leaveRequests) {
      if (r.profile_id !== employeeId || !inRange(r.created_at)) continue;
      entries.push({
        key: `leave-${r.id}`,
        createdAt: r.created_at,
        node: <LeaveRequestCard key={r.id} request={r} canRespond={false} canCancel={false} showName={false} />,
      });
    }
    for (const r of swapRequests) {
      if (r.requester_id !== employeeId || !inRange(r.created_at)) continue;
      entries.push({
        key: `swap-${r.id}`,
        createdAt: r.created_at,
        node: <SwapRequestCard key={r.id} request={r} canRespond={false} canCancel={false} />,
      });
    }
    for (const r of shiftRequests) {
      if (r.profile_id !== employeeId || !inRange(r.created_at)) continue;
      entries.push({
        key: `shift-${r.id}`,
        createdAt: r.created_at,
        node: <ShiftRequestCard key={r.id} request={r} canRespond={false} canCancel={false} showName={false} />,
      });
    }
    for (const r of attendanceCorrections) {
      if (r.profile_id !== employeeId || !inRange(r.created_at)) continue;
      entries.push({
        key: `correction-${r.id}`,
        createdAt: r.created_at,
        node: (
          <AttendanceCorrectionCard key={r.id} request={r} canRespond={false} canCancel={false} showName={false} />
        ),
      });
    }

    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [employeeId, period, leaveRequests, swapRequests, shiftRequests, attendanceCorrections]);

  const periodLabel = period === "day" ? "Hôm nay" : period === "month" ? "Tháng này" : "Năm này";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{employeeName}</DialogTitle>
          <DialogDescription>
            {items.length === 0
              ? `Chưa gửi đơn nào — ${periodLabel.toLowerCase()}`
              : `${items.length} đơn — ${periodLabel.toLowerCase()}`}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-96 space-y-2 overflow-y-auto">
          {items.map((item) => (
            <div key={item.key}>{item.node}</div>
          ))}
          {items.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">Không có đơn nào trong kỳ này.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
