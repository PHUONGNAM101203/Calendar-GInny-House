"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { deleteShiftAction } from "@/actions/shifts";
import { deleteShiftSeriesAction } from "@/actions/shift-series";
import type { SeriesDeleteScope } from "@/lib/validations/shift-series";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/date-picker-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const DATE_FORMAT = "yyyy-MM-dd";

type ScopeOption = { value: SeriesDeleteScope; label: string; hint: string };

const SCOPE_OPTIONS: ScopeOption[] = [
  { value: "one", label: "Chỉ xoá ca này", hint: "Các buổi khác của ca cố định giữ nguyên." },
  {
    value: "all",
    label: "Xoá tất cả ca thuộc ca cố định này",
    hint: "Mọi buổi đã tạo, cả trước và sau hôm nay.",
  },
  { value: "range", label: "Xoá trong khoảng ngày", hint: "Chỉ các buổi nằm trong khoảng đã chọn." },
];

export default function ShiftSeriesDeleteDialog({
  open,
  onOpenChange,
  seriesId,
  shiftId,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seriesId: string;
  // Present when the dialog was opened from one occurrence on the calendar, so
  // "Chỉ xoá ca này" has a row to act on. Absent when it was opened from the
  // series list on the dashboard, where that scope has nothing to point at.
  shiftId?: string | null;
  onDeleted?: () => void;
}) {
  const [scope, setScope] = useState<SeriesDeleteScope>(shiftId ? "one" : "all");
  const [from, setFrom] = useState(() => format(startOfDay(new Date()), DATE_FORMAT));
  const [to, setTo] = useState(() => format(startOfDay(new Date()), DATE_FORMAT));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const options = shiftId ? SCOPE_OPTIONS : SCOPE_OPTIONS.filter((option) => option.value !== "one");

  async function onConfirm() {
    setError("");
    setPending(true);
    try {
      if (scope === "one") {
        if (!shiftId) return;
        const result = await deleteShiftAction(shiftId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        toast.success("Đã xoá ca làm việc");
      } else {
        const result = await deleteShiftSeriesAction({
          series_id: seriesId,
          scope,
          from: scope === "range" ? from : undefined,
          to: scope === "range" ? to : undefined,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // The kept count is not a footnote: those occurrences already have a
        // clock-in, and the manager needs to know they are still on the
        // calendar rather than assume the scope emptied.
        toast.success(
          result.data.kept > 0
            ? `Đã xoá ${result.data.deleted} ca — giữ lại ${result.data.kept} ca đã có chấm công`
            : `Đã xoá ${result.data.deleted} ca`
        );
      }
      onOpenChange(false);
      onDeleted?.();
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Xoá ca cố định</DialogTitle>
          <DialogDescription>
            Ca đã có chấm công sẽ được giữ lại ở mọi phạm vi, để không làm sai bảng công.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {options.map((option) => {
            const active = scope === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => setScope(option.value)}
                className={cn(
                  "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                  "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                  active
                    ? "border-primary bg-primary/5"
                    : "border-input hover:border-primary/40 bg-background"
                )}
              >
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="text-muted-foreground block text-xs">{option.hint}</span>
              </button>
            );
          })}
        </div>

        {scope === "range" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <DatePickerField
              id="series_delete_from"
              label="Từ ngày"
              value={from}
              onChange={setFrom}
            />
            <DatePickerField id="series_delete_to" label="Đến ngày" value={to} onChange={setTo} />
          </div>
        )}

        {error && <p className="text-destructive text-sm">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? "Đang xoá..." : "Xoá"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
