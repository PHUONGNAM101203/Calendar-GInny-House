"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { createSwapRequestAction } from "@/actions/swaps";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ShiftWithAssignee } from "@/types";

function formatRange(shift: Pick<ShiftWithAssignee, "start_at" | "end_at">) {
  const start = new Date(shift.start_at);
  const end = new Date(shift.end_at);
  return `${format(start, "EEEE dd/MM", { locale: vi })} · ${format(start, "h:mm a")}–${format(
    end,
    "h:mm a"
  )}`;
}

export default function SwapRequestDialog({
  open,
  onOpenChange,
  shift,
  otherShifts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: ShiftWithAssignee;
  otherShifts: ShiftWithAssignee[];
}) {
  const [mode, setMode] = useState<"open" | "specific">("open");
  const [targetShiftId, setTargetShiftId] = useState<string>("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit() {
    setError("");
    if (mode === "specific" && !targetShiftId) {
      setError("Vui lòng chọn ca muốn đổi");
      return;
    }

    const targetShift = otherShifts.find((s) => s.id === targetShiftId);
    setSubmitting(true);
    const result = await createSwapRequestAction({
      shift_id: shift.id,
      target_id: mode === "specific" ? targetShift?.assignee_id : undefined,
      target_shift_id: mode === "specific" ? targetShiftId : undefined,
      message: message || undefined,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.info("Đã gửi yêu cầu đổi ca");
    onOpenChange(false);
    setMode("open");
    setTargetShiftId("");
    setMessage("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Yêu cầu đổi ca</DialogTitle>
          <DialogDescription>Ca của bạn: {formatRange(shift)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Tabs value={mode} onValueChange={(v) => setMode(v as "open" | "specific")}>
            <TabsList className="w-full">
              <TabsTrigger value="open" className="flex-1">
                Nhường ca (mở)
              </TabsTrigger>
              <TabsTrigger value="specific" className="flex-1">
                Đổi với đồng nghiệp
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {mode === "open" ? (
            <p className="text-sm text-muted-foreground">
              Ca này sẽ hiển thị cho mọi đồng nghiệp trong cơ sở, ai nhận trước sẽ nhận ca.
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="target_shift">Ca muốn đổi</Label>
              <Select value={targetShiftId} onValueChange={setTargetShiftId}>
                <SelectTrigger id="target_shift" className="w-full">
                  <SelectValue placeholder="Chọn ca của đồng nghiệp" />
                </SelectTrigger>
                <SelectContent>
                  {otherShifts.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.assignee.full_name} · {formatRange(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="message">Lời nhắn (không bắt buộc)</Label>
            <Textarea
              id="message"
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button onClick={onSubmit} disabled={submitting}>
            {submitting ? "Đang gửi..." : "Gửi yêu cầu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
