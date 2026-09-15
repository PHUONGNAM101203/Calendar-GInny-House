"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format, parse } from "date-fns";
import { vi } from "date-fns/locale";
import { createSwapRequestAction } from "@/actions/swaps";
import { requestShiftChangeAction } from "@/actions/shift-requests";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { TimePickerField } from "@/components/ui/time-picker-field";
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
import type { Branch, ShiftWithAssignee } from "@/types";

const DATE_FORMAT = "yyyy-MM-dd";
const TIME_FORMAT = "HH:mm";

function formatRange(shift: Pick<ShiftWithAssignee, "start_at" | "end_at">) {
  const start = new Date(shift.start_at);
  const end = new Date(shift.end_at);
  return `${format(start, "EEEE dd/MM", { locale: vi })} · ${format(start, "HH:mm")}–${format(
    end,
    "HH:mm"
  )}`;
}

export default function SwapRequestDialog({
  open,
  onOpenChange,
  shift,
  otherShifts,
  branches,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: ShiftWithAssignee;
  otherShifts: ShiftWithAssignee[];
  branches: Branch[];
}) {
  // Hai dạng đổi ca. "person" là thứ vốn có: ca rời khỏi tay mình, sang người
  // khác. "time" giữ nguyên người, chỉ dời khung giờ — trước đây muốn vậy
  // phải huỷ ca rồi đăng ký lại, và giữa hai bước đó suất trực bị bỏ trống.
  const [kind, setKind] = useState<"person" | "time">("person");
  const [mode, setMode] = useState<"open" | "specific">("open");
  const [targetShiftId, setTargetShiftId] = useState<string>("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const shiftStart = new Date(shift.start_at);
  const shiftEnd = new Date(shift.end_at);
  const [date, setDate] = useState(format(shiftStart, DATE_FORMAT));
  const [startTime, setStartTime] = useState(format(shiftStart, TIME_FORMAT));
  const [endTime, setEndTime] = useState(format(shiftEnd, TIME_FORMAT));
  const [branchId, setBranchId] = useState(shift.branch_id);

  // Ca đã bắt đầu thì RPC từ chối. Nói trước ở đây thay vì để người dùng điền
  // xong form mới nhận câu từ chối.
  const alreadyStarted = shiftStart <= new Date();

  function resetAndClose() {
    onOpenChange(false);
    setKind("person");
    setMode("open");
    setTargetShiftId("");
    setMessage("");
    setError("");
  }

  async function submitPersonSwap() {
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
    resetAndClose();
  }

  async function submitTimeChange() {
    if (!branchId) {
      setError("Vui lòng chọn cơ sở");
      return;
    }

    // Dựng mốc thời gian ở client, đúng khuôn ShiftRequestDialog: trình duyệt
    // chạy theo giờ Việt Nam nên toISOString() ra đúng mốc, còn phía server
    // chạy UTC và không được phép parse lại.
    const day = parse(date, DATE_FORMAT, new Date());
    const startDateTime = parse(startTime, TIME_FORMAT, day);
    const endDateTime = parse(endTime, TIME_FORMAT, day);
    if (endDateTime <= startDateTime) {
      endDateTime.setDate(endDateTime.getDate() + 1);
    }

    if (
      startDateTime.getTime() === shiftStart.getTime() &&
      endDateTime.getTime() === shiftEnd.getTime() &&
      branchId === shift.branch_id
    ) {
      setError("Khung giờ mới không khác ca hiện tại");
      return;
    }

    setSubmitting(true);
    const result = await requestShiftChangeAction({
      shift_id: shift.id,
      branch_id: branchId,
      start_at: startDateTime.toISOString(),
      end_at: endDateTime.toISOString(),
      note: message || undefined,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.info("Đã gửi yêu cầu đổi giờ ca cho quản lý duyệt");
    resetAndClose();
  }

  async function onSubmit() {
    setError("");
    if (kind === "time") {
      await submitTimeChange();
      return;
    }
    await submitPersonSwap();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Yêu cầu đổi ca</DialogTitle>
          <DialogDescription>Ca của bạn: {formatRange(shift)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Tabs value={kind} onValueChange={(v) => setKind(v as "person" | "time")}>
            <TabsList className="w-full">
              <TabsTrigger value="person" className="flex-1">
                Đổi cho người khác
              </TabsTrigger>
              <TabsTrigger value="time" className="flex-1">
                Đổi giờ ca của tôi
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {kind === "person" ? (
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
            </div>
          ) : alreadyStarted ? (
            <p className="text-sm text-muted-foreground">
              Ca này đã bắt đầu nên không đổi giờ được nữa. Nếu giờ làm thực tế lệch so với ca, hãy
              dùng phần giải trình công.
            </p>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Ca vẫn là của bạn, chỉ đổi khung giờ. Yêu cầu sẽ được gửi tới quản lý duyệt.
              </p>

              <DatePickerField id="change_date" label="Ngày" value={date} onChange={setDate} />

              <div className="grid grid-cols-2 gap-3">
                <TimePickerField
                  id="change_start_time"
                  label="Bắt đầu"
                  value={startTime}
                  onChange={setStartTime}
                />
                <TimePickerField
                  id="change_end_time"
                  label="Kết thúc"
                  value={endTime}
                  onChange={setEndTime}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="change_branch_id">Cơ sở</Label>
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger id="change_branch_id" className="w-full">
                    <SelectValue placeholder="Chọn cơ sở" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="message">
              {kind === "time" ? "Lý do (không bắt buộc)" : "Lời nhắn (không bắt buộc)"}
            </Label>
            <Textarea
              id="message"
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              // Ctrl/⌘+Enter sends; plain Enter stays a newline. This is a
              // message box, and a lời nhắn people cannot break into lines
              // would be worse than having no keyboard shortcut at all.
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !submitting) {
                  e.preventDefault();
                  void onSubmit();
                }
              }}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={submitting || (kind === "time" && alreadyStarted)}
          >
            {submitting ? "Đang gửi..." : "Gửi yêu cầu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
