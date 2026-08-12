"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { TrashIcon } from "lucide-react";
import {
  cancelSwapRequestAction,
  respondToSwapRequestAction,
  deleteSwapRequestAction,
} from "@/actions/swaps";
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
  canDelete,
}: {
  request: SwapRequestDetailed;
  canRespond: boolean;
  canCancel: boolean;
  canDelete: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [deleted, setDeleted] = useState(false);

  async function handleRespond(accept: boolean) {
    setPending(true);
    const result = await respondToSwapRequestAction(request.id, accept);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (accept) {
      toast.success("Đã nhận ca thành công");
    } else {
      toast.warning("Đã từ chối yêu cầu");
    }
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

  async function handleDelete() {
    setPending(true);
    const result = await deleteSwapRequestAction(request.id);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Đã xoá yêu cầu đổi ca");
    setDeleted(true);
  }

  if (deleted) return null;

  const statusVariant =
    request.status === "accepted"
      ? "success"
      : request.status === "pending"
        ? "gold"
        : "outline";

  return (
    <Card className="border-l-4 border-l-transparent data-[status=pending]:border-l-gold" data-status={request.status}>
      <CardContent className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
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
          {canDelete && request.status === "pending" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="Xoá yêu cầu" disabled={pending}>
                  <TrashIcon className="size-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Xoá yêu cầu đổi ca?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Yêu cầu sẽ bị xoá hẳn khỏi hệ thống, khác với từ chối — không thể hoàn tác.
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
