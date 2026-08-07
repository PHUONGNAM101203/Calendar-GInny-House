"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { CalendarClockIcon } from "lucide-react";
import { cancelShiftRequestAction, respondToShiftRequestAction } from "@/actions/shift-requests";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SHIFT_TYPE_LABELS } from "@/lib/constants";
import { resolveColor, type ShiftRequestPendingEvent } from "@/lib/calendar";

export default function ShiftRequestDetailDialog({
  open,
  onOpenChange,
  event,
  canRespond,
  canCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: ShiftRequestPendingEvent;
  canRespond: boolean;
  canCancel: boolean;
}) {
  const [pending, setPending] = useState(false);
  const { request, colorVar } = event.resource;

  async function handleRespond(approve: boolean) {
    setPending(true);
    const result = await respondToShiftRequestAction(request.id, approve);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (approve) {
      toast.success("Đã duyệt đăng ký ca làm");
    } else {
      toast.warning("Đã từ chối đăng ký ca làm");
    }
    onOpenChange(false);
  }

  async function handleCancel() {
    setPending(true);
    const result = await cancelShiftRequestAction(request.id);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Đã huỷ đăng ký ca làm");
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
              <CalendarClockIcon className="size-4 text-white" />
            </span>
            <div>
              <DialogTitle>{request.profile.full_name}</DialogTitle>
              <DialogDescription>
                {format(new Date(request.start_at), "EEEE dd/MM/yyyy", { locale: vi })}
              </DialogDescription>
            </div>
          </div>
          <p className="font-heading text-lg font-semibold tabular-nums">
            {format(new Date(request.start_at), "h:mm a")}
            <span className="mx-1.5 text-muted-foreground">–</span>
            {format(new Date(request.end_at), "h:mm a")}
          </p>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Badge variant="outline">{SHIFT_TYPE_LABELS[request.shift_type]}</Badge>
          <Badge variant="gold">Chờ duyệt</Badge>
        </div>

        {request.note && <p className="text-sm text-muted-foreground italic">“{request.note}”</p>}

        {(canRespond || canCancel) && (
          <DialogFooter>
            {canRespond && (
              <>
                <Button variant="outline" disabled={pending} onClick={() => handleRespond(false)}>
                  Từ chối
                </Button>
                <Button disabled={pending} onClick={() => handleRespond(true)}>
                  Duyệt
                </Button>
              </>
            )}
            {!canRespond && canCancel && (
              <Button variant="outline" disabled={pending} onClick={handleCancel}>
                Huỷ đăng ký
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
