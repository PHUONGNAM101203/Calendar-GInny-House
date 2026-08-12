"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { TrashIcon } from "lucide-react";
import {
  cancelShiftRequestAction,
  respondToShiftRequestAction,
  deleteShiftRequestAction,
} from "@/actions/shift-requests";
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
  canDelete,
  showName,
}: {
  request: ShiftRequestDetailed;
  canRespond: boolean;
  canCancel: boolean;
  canDelete: boolean;
  showName: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [deleted, setDeleted] = useState(false);

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

  async function handleDelete() {
    setPending(true);
    const result = await deleteShiftRequestAction(request.id);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Đã xoá đăng ký ca làm");
    setDeleted(true);
  }

  if (deleted) return null;

  const statusVariant =
    request.status === "approved" ? "success" : request.status === "pending" ? "gold" : "outline";

  return (
    <Card
      className="border-l-4 border-l-transparent data-[status=pending]:border-l-gold"
      data-status={request.status}
    >
      <CardContent className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
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
          {canDelete && request.status === "pending" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="Xoá đơn" disabled={pending}>
                  <TrashIcon className="size-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Xoá đăng ký ca làm?</AlertDialogTitle>
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
