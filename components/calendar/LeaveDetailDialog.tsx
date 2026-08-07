"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format, parse } from "date-fns";
import { vi } from "date-fns/locale";
import { CalendarOffIcon, SunriseIcon, SunsetIcon, ClockIcon } from "lucide-react";
import { respondToLeaveRequestAction } from "@/actions/leave";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { LEAVE_STATUS_LABELS, LEAVE_REQUEST_TYPE_LABELS } from "@/lib/constants";
import { resolveColor, type LeaveCalendarEvent } from "@/lib/calendar";

const TYPE_ICON = {
  full_day: CalendarOffIcon,
  late_arrival: SunriseIcon,
  early_leave: SunsetIcon,
  hourly: ClockIcon,
};

function formatRange(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (startDate === endDate) return format(start, "EEEE dd/MM/yyyy", { locale: vi });
  return `${format(start, "dd/MM/yyyy")} – ${format(end, "dd/MM/yyyy")}`;
}

function formatTimeOfDay(value: string) {
  return format(parse(value.slice(0, 5), "HH:mm", new Date()), "h:mm a");
}

export default function LeaveDetailDialog({
  open,
  onOpenChange,
  event,
  canRespond,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: LeaveCalendarEvent;
  canRespond: boolean;
}) {
  const [pending, setPending] = useState(false);
  const request = event.resource.request;
  const Icon = TYPE_ICON[event.resource.requestType];
  const statusVariant =
    request.status === "approved" ? "success" : request.status === "pending" ? "gold" : "outline";

  async function handleRespond(approve: boolean) {
    setPending(true);
    const result = await respondToLeaveRequestAction(request.id, approve);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (approve) {
      toast.success("Đã duyệt đơn nghỉ phép");
    } else {
      toast.warning("Đã từ chối đơn nghỉ phép");
    }
    onOpenChange(false);
  }

  let timeDetail: string | null = null;
  if (request.request_type === "late_arrival" && request.start_time) {
    timeDetail = `Có mặt lúc ${formatTimeOfDay(request.start_time)}`;
  } else if (request.request_type === "early_leave" && request.end_time) {
    timeDetail = `Rời đi lúc ${formatTimeOfDay(request.end_time)}`;
  } else if (request.request_type === "hourly" && request.start_time && request.end_time) {
    timeDetail = `${formatTimeOfDay(request.start_time)} – ${formatTimeOfDay(request.end_time)}`;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: resolveColor(event.resource.colorVar) }}
            >
              <Icon className="size-4 text-white" />
            </span>
            <div>
              <DialogTitle>{request.profile.full_name}</DialogTitle>
              <DialogDescription>{formatRange(request.start_date, request.end_date)}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant={statusVariant}>{LEAVE_STATUS_LABELS[request.status]}</Badge>
            <span className="text-sm text-muted-foreground">
              {LEAVE_REQUEST_TYPE_LABELS[request.request_type]}
              {timeDetail && ` · ${timeDetail}`}
            </span>
          </div>
          {request.reason && (
            <p className="text-sm text-muted-foreground italic">“{request.reason}”</p>
          )}
        </div>

        {canRespond && request.status === "pending" && (
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => handleRespond(false)}>
              Từ chối
            </Button>
            <Button disabled={pending} onClick={() => handleRespond(true)}>
              Duyệt
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
