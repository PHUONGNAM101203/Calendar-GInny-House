"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format, parse, startOfDay } from "date-fns";
import { SendIcon } from "lucide-react";
import { requestShiftAction } from "@/actions/shift-requests";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { TimePickerField } from "@/components/ui/time-picker-field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { SHIFT_TYPE_LABELS, detectShiftType } from "@/lib/constants";
import { SHIFT_TYPES } from "@/lib/validations/shift";
import type { Branch, ShiftType } from "@/types";

const DATE_FORMAT = "yyyy-MM-dd";
const TIME_FORMAT = "HH:mm";

export default function ShiftRequestDialog({
  trigger,
  initialRange,
  branches,
}: {
  trigger?: React.ReactNode;
  initialRange?: { start: Date; end: Date } | null;
  branches: Branch[];
}) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [date, setDate] = useState(() => startOfDay(initialRange?.start ?? new Date()));
  const [startTime, setStartTime] = useState(
    initialRange ? format(initialRange.start, TIME_FORMAT) : "09:00"
  );
  const [endTime, setEndTime] = useState(
    initialRange ? format(initialRange.end, TIME_FORMAT) : "11:00"
  );
  const [shiftType, setShiftType] = useState<ShiftType>(() =>
    detectShiftType(initialRange ? format(initialRange.start, TIME_FORMAT) : "09:00")
  );
  const [note, setNote] = useState("");

  function handleStartTimeChange(value: string) {
    setStartTime(value);
    setShiftType(detectShiftType(value));
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setServerError("");
      const base = initialRange?.start ?? new Date();
      const initialStart = initialRange ? format(initialRange.start, TIME_FORMAT) : "09:00";
      setDate(startOfDay(base));
      setStartTime(initialStart);
      setEndTime(initialRange ? format(initialRange.end, TIME_FORMAT) : "11:00");
      setShiftType(detectShiftType(initialStart));
      setBranchId("");
      setNote("");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError("");

    if (!branchId) {
      setServerError("Vui lòng chọn cơ sở");
      return;
    }

    const startDateTime = parse(startTime, TIME_FORMAT, date);
    const endDateTime = parse(endTime, TIME_FORMAT, date);
    if (endDateTime <= startDateTime) {
      endDateTime.setDate(endDateTime.getDate() + 1);
    }

    setIsSubmitting(true);
    const result = await requestShiftAction({
      start_at: startDateTime.toISOString(),
      end_at: endDateTime.toISOString(),
      branch_id: branchId,
      shift_type: shiftType,
      note: note || undefined,
    });
    setIsSubmitting(false);

    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast.success("Đã gửi đăng ký ca làm cho Tổng giám đốc duyệt");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="justify-start gap-2">
            <SendIcon className="size-4" />
            Đăng ký ca làm
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Đăng ký ca làm</DialogTitle>
          <DialogDescription>
            Gửi ca bạn muốn làm để Tổng giám đốc duyệt trước khi lên lịch chính thức.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-3">
            <DatePickerField
              id="request_date"
              label="Ngày"
              value={format(date, DATE_FORMAT)}
              onChange={(value) => setDate(parse(value, DATE_FORMAT, new Date()))}
            />
            <div className="grid grid-cols-2 gap-3">
              <TimePickerField
                id="request_start_time"
                label="Bắt đầu"
                value={startTime}
                onChange={handleStartTimeChange}
              />
              <TimePickerField id="request_end_time" label="Kết thúc" value={endTime} onChange={setEndTime} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="request_branch_id">Cơ sở</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger id="request_branch_id" className="w-full">
                <SelectValue placeholder="Chọn cơ sở" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="request_shift_type">Loại ca</Label>
            <Select value={shiftType} onValueChange={(v) => setShiftType(v as ShiftType)}>
              <SelectTrigger id="request_shift_type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHIFT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {SHIFT_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="request_note">Ghi chú (không bắt buộc)</Label>
            <Textarea
              id="request_note"
              rows={2}
              maxLength={280}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {serverError && <p className="text-sm text-destructive">{serverError}</p>}

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Đang gửi..." : "Gửi đăng ký"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
