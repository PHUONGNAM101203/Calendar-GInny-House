"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { cancelShiftRequestAction, respondToShiftRequestAction } from "@/actions/shift-requests";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SHIFT_REQUEST_STATUS_LABELS, SHIFT_TYPE_LABELS } from "@/lib/constants";
import type { ShiftRequestDetailed } from "@/types";

function formatRange(startAt: string, endAt: string) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  return `${format(start, "EEEE dd/MM/yyyy", { locale: vi })} · ${format(start, "h:mm a")} – ${format(end, "h:mm a")}`;
}

export default function ShiftRequestCard({
  request,
  canRespond,
  canCancel,
  showName,
}: {
  request: ShiftRequestDetailed;
  canRespond: boolean;
  canCancel: boolean;
  showName: boolean;
}) {
  const [pending, setPending] = useState(false);

  async function handleRespond(approve: boolean) {
    setPending(true);
    const result = await respondToShiftRequestAction(request.id, approve);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(approve ? "Đã duyệt đăng ký ca làm" : "Đã từ chối đăng ký ca làm");
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
  }

  const statusVariant =
    request.status === "approved" ? "success" : request.status === "pending" ? "gold" : "outline";

  return (
    <Card
      className="border-l-4 border-l-transparent data-[status=pending]:border-l-gold"
      data-status={request.status}
    >
      <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {showName && `${request.profile.full_name} · `}
            {formatRange(request.start_at, request.end_at)}
          </p>
          {request.note && <p className="text-sm text-muted-foreground italic">“{request.note}”</p>}
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline">{SHIFT_TYPE_LABELS[request.shift_type]}</Badge>
          <Badge variant={statusVariant}>{SHIFT_REQUEST_STATUS_LABELS[request.status]}</Badge>
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
