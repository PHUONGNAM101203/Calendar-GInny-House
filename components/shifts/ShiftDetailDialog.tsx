"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { cancelSwapRequestAction, respondToSwapRequestAction } from "@/actions/swaps";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import SwapRequestDialog from "@/components/swaps/SwapRequestDialog";
import { resolveColor } from "@/lib/calendar";
import type { ShiftEvent } from "@/lib/calendar";
import type { ShiftWithAssignee } from "@/types";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "");
}

export default function ShiftDetailDialog({
  open,
  onOpenChange,
  event,
  otherShifts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: ShiftEvent;
  otherShifts: ShiftWithAssignee[];
}) {
  const [swapDialogOpen, setSwapDialogOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const { shift, isMine, pendingSwap, pendingSwapId, colorVar } = event.resource;

  async function handleRespond(accept: boolean) {
    if (!pendingSwapId) return;
    setPending(true);
    const result = await respondToSwapRequestAction(pendingSwapId, accept);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(accept ? "Đã nhận ca thành công" : "Đã từ chối yêu cầu");
    onOpenChange(false);
  }

  async function handleCancel() {
    if (!pendingSwapId) return;
    setPending(true);
    const result = await cancelSwapRequestAction(pendingSwapId);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Đã huỷ yêu cầu đổi ca");
    onOpenChange(false);
  }

  return (
    <>
      <Dialog open={open && !swapDialogOpen} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-full font-heading text-xs font-semibold uppercase text-primary-foreground"
                style={{
                  backgroundColor: isMine ? "var(--primary)" : resolveColor(colorVar),
                }}
              >
                {initials(shift.assignee.full_name)}
              </span>
              <div>
                <DialogTitle>{shift.assignee.full_name}</DialogTitle>
                <DialogDescription>
                  {format(new Date(shift.start_at), "EEEE dd/MM/yyyy", { locale: vi })}
                </DialogDescription>
              </div>
            </div>
            <p className="font-heading text-lg font-semibold tabular-nums">
              {format(new Date(shift.start_at), "h:mm a")}
              <span className="mx-1.5 text-muted-foreground">–</span>
              {format(new Date(shift.end_at), "h:mm a")}
            </p>
          </DialogHeader>

          {shift.note && <p className="text-sm text-muted-foreground">{shift.note}</p>}

          {isMine && pendingSwap === "none" && (
            <p className="text-sm text-muted-foreground">Đây là ca của bạn.</p>
          )}
          {isMine && (pendingSwap === "outgoing" || pendingSwap === "open") && (
            <p className="text-sm text-muted-foreground">
              {pendingSwap === "open"
                ? "Ca này đang chờ đồng nghiệp nhận."
                : "Đang chờ đồng nghiệp phản hồi yêu cầu đổi ca."}
            </p>
          )}
          {isMine && pendingSwap === "incoming" && (
            <p className="text-sm text-muted-foreground">
              Một đồng nghiệp muốn đổi ca với bạn cho ca này.
            </p>
          )}
          {!isMine && pendingSwap === "open" && (
            <p className="text-sm text-muted-foreground">
              {shift.assignee.full_name} đang cần người nhận ca này.
            </p>
          )}

          <DialogFooter>
            {isMine && pendingSwap === "none" && (
              <Button onClick={() => setSwapDialogOpen(true)}>Yêu cầu đổi ca</Button>
            )}
            {isMine && (pendingSwap === "outgoing" || pendingSwap === "open") && (
              <Button variant="outline" disabled={pending} onClick={handleCancel}>
                Huỷ yêu cầu
              </Button>
            )}
            {isMine && pendingSwap === "incoming" && (
              <>
                <Button variant="outline" disabled={pending} onClick={() => handleRespond(false)}>
                  Từ chối
                </Button>
                <Button disabled={pending} onClick={() => handleRespond(true)}>
                  Đồng ý đổi ca
                </Button>
              </>
            )}
            {!isMine && pendingSwap === "open" && (
              <Button disabled={pending} onClick={() => handleRespond(true)}>
                Nhận ca này
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isMine && (
        <SwapRequestDialog
          open={swapDialogOpen}
          onOpenChange={(next) => {
            setSwapDialogOpen(next);
            if (!next) onOpenChange(false);
          }}
          shift={shift}
          otherShifts={otherShifts}
        />
      )}
    </>
  );
}
