"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { AlarmClockOffIcon, ClockAlertIcon, TrashIcon } from "lucide-react";
import {
  cancelAttendanceCorrectionAction,
  respondToAttendanceCorrectionAction,
  deleteAttendanceCorrectionAction,
} from "@/actions/attendance-corrections";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ATTENDANCE_CORRECTION_STATUS_LABELS, ATTENDANCE_CORRECTION_ISSUE_LABELS } from "@/lib/constants";
import type { AttendanceCorrectionDetailed } from "@/types";

const ISSUE_ICON = {
  missed_check_in: AlarmClockOffIcon,
  late_check_in: ClockAlertIcon,
};

export default function AttendanceCorrectionCard({
  request,
  canRespond,
  canCancel,
  canDelete,
  showName,
}: {
  request: AttendanceCorrectionDetailed;
  canRespond: boolean;
  canCancel: boolean;
  canDelete: boolean;
  showName: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [deleted, setDeleted] = useState(false);

  async function handleRespond(approve: boolean) {
    setPending(true);
    const result = await respondToAttendanceCorrectionAction(request.id, approve);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (approve) {
      toast.success("Đã duyệt đơn giải trình công");
    } else {
      toast.warning("Đã từ chối đơn giải trình công");
    }
  }

  async function handleCancel() {
    setPending(true);
    const result = await cancelAttendanceCorrectionAction(request.id);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Đã huỷ đơn giải trình công");
  }

  async function handleDelete() {
    setPending(true);
    const result = await deleteAttendanceCorrectionAction(request.id);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Đã xoá đơn giải trình công");
    setDeleted(true);
  }

  if (deleted) return null;

  const statusVariant =
    request.status === "approved" ? "success" : request.status === "pending" ? "gold" : "outline";
  const Icon = ISSUE_ICON[request.issue_type];
  const shiftDate = format(new Date(request.shift.start_at), "EEEE dd/MM/yyyy", { locale: vi });
  const shiftRange = `${format(new Date(request.shift.start_at), "HH:mm")}–${format(
    new Date(request.shift.end_at),
    "HH:mm"
  )}`;

  return (
    <Card
      className="border-l-4 border-l-transparent data-[status=pending]:border-l-gold"
      data-status={request.status}
    >
      <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            {showName && `${request.profile.full_name} · `}
            {shiftDate} · Ca {shiftRange}
          </p>
          <p className="text-xs text-muted-foreground">
            {ATTENDANCE_CORRECTION_ISSUE_LABELS[request.issue_type]}
            {request.issue_type === "late_check_in" && request.actual_check_in_at && (
              <> · Chấm công lúc {format(new Date(request.actual_check_in_at), "HH:mm")}</>
            )}
            {" · Sửa về "}
            {format(new Date(request.requested_check_in_at), "HH:mm")}
          </p>
          <p className="text-sm text-muted-foreground italic">“{request.reason}”</p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={statusVariant}>{ATTENDANCE_CORRECTION_STATUS_LABELS[request.status]}</Badge>
          {canRespond && request.status === "pending" && (
            <>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => handleRespond(false)}>
                Từ chối
              </Button>
              <Button size="sm" disabled={pending} onClick={() => handleRespond(true)}>
                Duyệt
              </Button>
            </>
          )}
          {canCancel && request.status === "pending" && (
            <Button size="sm" variant="outline" disabled={pending} onClick={handleCancel}>
              Huỷ
            </Button>
          )}
          {canDelete && request.status === "pending" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="Xoá đơn" disabled={pending}>
                  <TrashIcon className="size-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Xoá đơn giải trình công?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Đơn sẽ bị xoá hẳn khỏi hệ thống, khác với từ chối — không thể hoàn tác.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Huỷ</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={handleDelete}>
                    Xoá
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
