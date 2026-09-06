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
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Badge } from "@/components/ui/badge";
import { ATTENDANCE_CORRECTION_ISSUE_LABELS } from "@/lib/constants";
import { isLeaveApprover, canApproveLeaveFor, canManageAttendanceFor } from "@/lib/roles";
import { resolveColor, type AttendanceCalendarEvent, type AttendanceSession } from "@/lib/calendar";
import type { GroupPermissions } from "@/lib/permissions";
import type { Role } from "@/types";

const TIME_FORMAT = "HH:mm";
const DATE_FORMAT = "yyyy-MM-dd";

// Time-of-day only, anchored on a date the caller chooses.
function combineDateAndTime(anchorIso: string, time: string): string {
  const anchor = new Date(anchorIso);
  const withNewTime = parse(time, TIME_FORMAT, anchor);
  return new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate(),
    withNewTime.getHours(),
    withNewTime.getMinutes()
  ).toISOString();
}

// The check-out is anchored on the date the editor picked, not on whatever
// date the stored check-out happens to carry, and only rolls to the next day
// when the entered time falls at or before the check-in — the same overnight
// rule the shift forms and create_shift_series already use.
//
// This is the fix for a real bug. The old version anchored on the existing
// check_out_at, which for a forgotten check-out is the day somebody finally
// noticed, not the day of the shift. A session opened 05/09 19:20 and closed
// 06/09 21:32 read as 26 giờ, and a manager editing the time to "21:32" kept
// the 06/09 date — so the hours never came down, and there was no way to bring
// them down from this dialog at all.
function combineCheckOut(checkInIso: string, time: string): string {
  const checkIn = new Date(checkInIso);
  const sameDay = new Date(combineDateAndTime(checkInIso, time));
  if (sameDay > checkIn) return sameDay.toISOString();
  const nextDay = new Date(sameDay);
  nextDay.setDate(nextDay.getDate() + 1);
  return nextDay.toISOString();
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
  permissions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: AttendanceCalendarEvent;
  currentUserRole: Role;
  permissions: GroupPermissions;
}) {
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editCheckIn, setEditCheckIn] = useState("");
  const [editCheckOut, setEditCheckOut] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { profileName, profileRole, colorVar, totalMinutes, isOpen, sessions } = event.resource;

  const canManage = canManageAttendanceFor(currentUserRole, profileRole, permissions);

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
    onOpenChange(false);
  }

  function startEdit(session: AttendanceSession) {
    setEditingId(session.id);
    // Mặc định là ngày check-in — với ca quên check-out thì đây mới là
    // ngày làm ca thật, còn ngày trong check_out_at là ngày phát hiện ra.
    setEditDate(format(new Date(session.checkInAt), DATE_FORMAT));
    setEditCheckIn(format(new Date(session.checkInAt), TIME_FORMAT));
    setEditCheckOut(format(session.checkOutAt ? new Date(session.checkOutAt) : new Date(), TIME_FORMAT));
  }

  async function handleSave(session: AttendanceSession) {
    setSavingId(session.id);
    // Ngày do người sửa chọn là mốc cho CẢ giờ vào lẫn giờ ra; giờ ra chỉ
    // nhảy sang hôm sau khi nó sớm hơn hoặc bằng giờ vào (ca qua đêm).
    const anchorIso = parse(editDate, DATE_FORMAT, new Date()).toISOString();
    const result = await updateAttendanceAction(session.id, {
      check_in_at: combineDateAndTime(anchorIso, editCheckIn),
      check_out_at: combineCheckOut(anchorIso, editCheckOut),
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
              canApproveLeaveFor(currentUserRole, correction.profile.role, permissions);
            const canManageSession = canManage && Boolean(s.id);
            return (
              <li key={i} className="rounded-md border bg-muted/40 p-2.5 text-sm">
                {editingId === s.id ? (
                  <div className="space-y-2">
                    <DatePickerField
                      id={`edit-date-${s.id}`}
                      label="Ngày của ca"
                      value={editDate}
                      onChange={setEditDate}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <TimePickerField id={`edit-checkin-${s.id}`} label="Vào" value={editCheckIn} onChange={setEditCheckIn} />
                      <TimePickerField id={`edit-checkout-${s.id}`} label="Ra" value={editCheckOut} onChange={setEditCheckOut} />
                    </div>
                    {/* Cái bẫy thật sự: quên check-out thì hôm sau mới sửa, và
                        lúc đó ngày ghi trong máy là ngày PHÁT HIỆN chứ không
                        phải ngày làm ca — nên sửa mỗi giờ thì số giờ không bao
                        giờ giảm. Nói thẳng ra đây thay vì để người sửa tự đoán. */}
                    <p className="text-muted-foreground text-xs">
                      Sửa hôm sau thì nhớ chọn lại <strong>ngày của ca</strong>, không thì số giờ
                      vẫn tính từ hôm trước sang. Giờ ra sớm hơn hoặc bằng giờ vào được hiểu là ca
                      qua đêm, tự tính sang hôm sau.
                    </p>
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
                        {format(new Date(s.checkInAt), "HH:mm")}
                        <span className="mx-1.5 text-muted-foreground">–</span>
                        {s.checkOutAt ? format(new Date(s.checkOutAt), "HH:mm") : "đang làm"}
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
