"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format, parse } from "date-fns";
import { vi } from "date-fns/locale";
import { MapPinIcon, PencilIcon, TimerIcon, TrashIcon } from "lucide-react";
import { respondToAttendanceCorrectionAction } from "@/actions/attendance-corrections";
import { updateAttendanceAction, deleteAttendanceAction } from "@/actions/attendance";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { TimePickerField } from "@/components/ui/time-picker-field";
import { Badge } from "@/components/ui/badge";
import { ATTENDANCE_CORRECTION_ISSUE_LABELS } from "@/lib/constants";
import { isLeaveApprover, canApproveLeaveFor, canManageAttendanceFor } from "@/lib/roles";
import { resolveColor, type AttendanceCalendarEvent, type AttendanceSession } from "@/lib/calendar";
import type { Role } from "@/types";

const TIME_FORMAT = "HH:mm";

// Time-of-day only — keeps the session's original calendar date, since a
// manager fixing an erroneous check-in/out is correcting a mistyped time,
// not moving the record to a different day.
function combineDateAndTime(originalIso: string, time: string): string {
  const original = new Date(originalIso);
  const withNewTime = parse(time, TIME_FORMAT, original);
  return new Date(
    original.getFullYear(),
    original.getMonth(),
    original.getDate(),
    withNewTime.getHours(),
    withNewTime.getMinutes()
  ).toISOString();
}

function formatMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  if (hours <= 0) return `${mins} phút`;
  return mins > 0 ? `${hours} giờ ${mins} phút` : `${hours} giờ`;
}

export default function AttendanceDetailDialog({
  open,
  onOpenChange,
  event,
  currentUserRole,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: AttendanceCalendarEvent;
  currentUserRole: Role;
}) {
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCheckIn, setEditCheckIn] = useState("");
  const [editCheckOut, setEditCheckOut] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { profileName, profileRole, colorVar, totalMinutes, isOpen, sessions } = event.resource;

  const canManage = canManageAttendanceFor(currentUserRole, profileRole);

  async function handleRespond(correctionId: string, approve: boolean) {
    setRespondingId(correctionId);
    const result = await respondToAttendanceCorrectionAction(correctionId, approve);
    setRespondingId(null);
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

  function startEdit(session: AttendanceSession) {
    setEditingId(session.id);
    setEditCheckIn(format(new Date(session.checkInAt), TIME_FORMAT));
    setEditCheckOut(format(session.checkOutAt ? new Date(session.checkOutAt) : new Date(), TIME_FORMAT));
  }

  async function handleSave(session: AttendanceSession) {
    setSavingId(session.id);
    const result = await updateAttendanceAction(session.id, {
      check_in_at: combineDateAndTime(session.checkInAt, editCheckIn),
      check_out_at: combineDateAndTime(session.checkOutAt ?? session.checkInAt, editCheckOut),
    });
    setSavingId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Đã cập nhật chấm công");
    setEditingId(null);
  }

  async function handleDelete(session: AttendanceSession) {
    setDeletingId(session.id);
    const result = await deleteAttendanceAction(session.id);
    setDeletingId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Đã xoá chấm công");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: resolveColor(colorVar) }}
            >
              <TimerIcon className="size-4 text-white" />
            </span>
            <div>
              <DialogTitle>{profileName}</DialogTitle>
              <DialogDescription>
                {format(event.start, "EEEE dd/MM/yyyy", { locale: vi })}
              </DialogDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <p className="font-heading text-lg font-semibold tabular-nums">
              Tổng {formatMinutes(totalMinutes)}
            </p>
            {isOpen && (
              <Badge variant="success" className="animate-pulse">
                Đang chấm công
              </Badge>
            )}
          </div>
        </DialogHeader>

        <ul className="space-y-2">
          {sessions.map((s, i) => {
            const correction = s.correction;
            const canRespond =
              correction !== null &&
              isLeaveApprover(currentUserRole) &&
              canApproveLeaveFor(currentUserRole, correction.profile.role);
            const canManageSession = canManage && Boolean(s.id);
            return (
              <li key={i} className="rounded-md border bg-muted/40 p-2.5 text-sm">
                {editingId === s.id ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <TimePickerField id={`edit-checkin-${s.id}`} label="Vào" value={editCheckIn} onChange={setEditCheckIn} />
                      <TimePickerField id={`edit-checkout-${s.id}`} label="Ra" value={editCheckOut} onChange={setEditCheckOut} />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                        Huỷ
                      </Button>
                      <Button size="sm" disabled={savingId === s.id} onClick={() => handleSave(s)}>
                        {savingId === s.id ? "Đang lưu..." : "Lưu"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium tabular-nums">
                        {format(new Date(s.checkInAt), "h:mm a")}
                        <span className="mx-1.5 text-muted-foreground">–</span>
                        {s.checkOutAt ? format(new Date(s.checkOutAt), "h:mm a") : "đang làm"}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPinIcon className="size-3 shrink-0" />
                        {s.branchName}
                      </p>
                    </div>
                    {canManageSession && (
                      <div className="flex shrink-0 gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Sửa chấm công"
                          onClick={() => startEdit(s)}
                        >
                          <PencilIcon className="size-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon-sm" variant="ghost" aria-label="Xoá chấm công">
                              <TrashIcon className="size-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Xoá bản ghi chấm công?</AlertDialogTitle>
                              <AlertDialogDescription>Hành động này không thể hoàn tác.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Huỷ</AlertDialogCancel>
                              <AlertDialogAction
                                variant="destructive"
                                disabled={deletingId === s.id}
                                onClick={() => handleDelete(s)}
                              >
                                Xoá
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                  </div>
                )}

                {correction && (
                  <div className="mt-2 space-y-1.5 border-t pt-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="gold">Chờ duyệt giải trình</Badge>
                      <span className="text-xs text-muted-foreground">
                        {ATTENDANCE_CORRECTION_ISSUE_LABELS[correction.issue_type]}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground italic">“{correction.reason}”</p>
                    {canRespond && (
                      <div className="flex gap-2 pt-0.5">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={respondingId === correction.id}
                          onClick={() => handleRespond(correction.id, false)}
                        >
                          Từ chối
                        </Button>
                        <Button
                          size="sm"
                          disabled={respondingId === correction.id}
                          onClick={() => handleRespond(correction.id, true)}
                        >
                          Duyệt
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
