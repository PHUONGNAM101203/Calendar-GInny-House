"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format, parse } from "date-fns";
import { vi } from "date-fns/locale";
import { CalendarOffIcon, SunriseIcon, SunsetIcon, ClockIcon } from "lucide-react";
import { cancelLeaveRequestAction, respondToLeaveRequestAction } from "@/actions/leave";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { LEAVE_STATUS_LABELS, LEAVE_REQUEST_TYPE_LABELS } from "@/lib/constants";
import type { LeaveRequestDetailed } from "@/types";

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

function formatTypeDetail(request: LeaveRequestDetailed) {
  if (request.request_type === "late_arrival" && request.start_time) {
    return `Có mặt lúc ${formatTimeOfDay(request.start_time)}`;
  }
  if (request.request_type === "early_leave" && request.end_time) {
    return `Rời đi lúc ${formatTimeOfDay(request.end_time)}`;
  }
  if (request.request_type === "hourly" && request.start_time && request.end_time) {
    return `${formatTimeOfDay(request.start_time)} – ${formatTimeOfDay(request.end_time)}`;
  }
  return null;
}

export default function LeaveRequestCard({
  request,
  canRespond,
  canCancel,
  showName,
}: {
  request: LeaveRequestDetailed;
  canRespond: boolean;
  canCancel: boolean;
  showName: boolean;
}) {
  const [pending, setPending] = useState(false);

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
  }

  async function handleCancel() {
    setPending(true);
    const result = await cancelLeaveRequestAction(request.id);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Đã huỷ đơn nghỉ phép");
  }

  const statusVariant =
    request.status === "approved" ? "success" : request.status === "pending" ? "gold" : "outline";
  const TypeIcon = TYPE_ICON[request.request_type];
  const typeDetail = formatTypeDetail(request);

  return (
    <Card
      className="border-l-4 border-l-transparent data-[status=pending]:border-l-gold"
      data-status={request.status}
    >
      <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <TypeIcon className="size-3.5 shrink-0 text-muted-foreground" />
            {showName && `${request.profile.full_name} · `}
            {formatRange(request.start_date, request.end_date)}
          </p>
          {request.request_type !== "full_day" && (
            <p className="text-xs text-muted-foreground">
              {LEAVE_REQUEST_TYPE_LABELS[request.request_type]}
              {typeDetail && ` · ${typeDetail}`}
            </p>
          )}
          {request.reason && (
            <p className="text-sm text-muted-foreground italic">“{request.reason}”</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={statusVariant}>{LEAVE_STATUS_LABELS[request.status]}</Badge>
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
        </div>
      </CardContent>
    </Card>
  );
}
