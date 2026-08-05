"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import {
  cancelSwapRequestAction,
  respondToSwapRequestAction,
} from "@/actions/swaps";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SWAP_STATUS_LABELS } from "@/lib/constants";
import type { SwapRequestDetailed } from "@/types";

function formatShift(shift: { start_at: string; end_at: string }) {
  const start = new Date(shift.start_at);
  const end = new Date(shift.end_at);
  return `${format(start, "EEEE dd/MM", { locale: vi })} · ${format(start, "HH:mm")}–${format(
    end,
    "HH:mm"
  )}`;
}

export default function SwapRequestCard({
  request,
  canRespond,
  canCancel,
}: {
  request: SwapRequestDetailed;
  canRespond: boolean;
  canCancel: boolean;
}) {
  const [pending, setPending] = useState(false);

  async function handleRespond(accept: boolean) {
    setPending(true);
    const result = await respondToSwapRequestAction(request.id, accept);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(accept ? "Đã nhận ca thành công" : "Đã từ chối yêu cầu");
  }

  async function handleCancel() {
    setPending(true);
    const result = await cancelSwapRequestAction(request.id);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Đã huỷ yêu cầu");
  }

  const statusVariant =
    request.status === "accepted"
      ? "success"
      : request.status === "pending"
        ? "gold"
        : "outline";

  return (
    <Card className="border-l-4 border-l-transparent data-[status=pending]:border-l-gold" data-status={request.status}>
      <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {request.requester.full_name} nhường ca: {formatShift(request.requester_shift)}
          </p>
          {request.target_shift && request.target ? (
            <p className="text-sm text-muted-foreground">
              Đổi với {request.target.full_name}: {formatShift(request.target_shift)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {request.target ? `Gửi riêng cho ${request.target.full_name}` : "Mở cho cả cơ sở"}
            </p>
          )}
          {request.message && (
            <p className="text-sm text-muted-foreground italic">“{request.message}”</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={statusVariant}>{SWAP_STATUS_LABELS[request.status]}</Badge>
          {canRespond && request.status === "pending" && (
            <>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => handleRespond(false)}>
                Từ chối
              </Button>
              <Button size="sm" disabled={pending} onClick={() => handleRespond(true)}>
                {request.target_shift_id ? "Đồng ý" : "Nhận ca"}
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
