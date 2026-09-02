"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { SHIFT_TYPE_LABELS } from "@/lib/constants";
import { updateShiftSeriesAction } from "@/actions/shift-series";
import type { BulkDeleteScope } from "@/lib/validations/shift-series";
import type { Branch, Profile, ShiftSeriesDetailed, ShiftType } from "@/types";
import WeekdayPills from "@/components/shifts/WeekdayPills";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const DATE_FORMAT = "yyyy-MM-dd";
const NO_ASSIGNEE = "__none__";
const INTERVAL_OPTIONS = [1, 2, 3, 4] as const;
const EDITABLE_SHIFT_TYPES: ShiftType[] = ["morning", "afternoon", "evening", "remote"];

type ScopeOption = { value: BulkDeleteScope; label: string; hint: string };

// "Chỉ sửa ca này" is absent on purpose: a single occurrence is edited by
// clicking it on /calendar, which opens ShiftFormDialog and already handles the
// one-row case, its RLS refusal and its notification. Offering it here too
// would be a second path to the same write with none of that.
const SCOPE_OPTIONS: ScopeOption[] = [
  {
    value: "all",
    label: "Sửa tất cả ca thuộc ca cố định này",
    hint: "Đổi luật, rồi tạo lại các buổi từ hôm nay trở đi. Buổi đã qua giữ nguyên.",
  },
  {
    value: "range",
    label: "Sửa trong khoảng ngày",
    hint: "Chỉ đổi giờ / cơ sở / người của các buổi trong khoảng. Luật giữ nguyên.",
  },
];

export default function ShiftSeriesEditDialog({
  open,
  onOpenChange,
  series,
  branches,
  branchMembers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  series: ShiftSeriesDetailed;
  branches: Branch[];
  branchMembers: Pick<Profile, "id" | "full_name" | "role" | "secondary_role" | "branch_ids">[];
}) {
  const [scope, setScope] = useState<BulkDeleteScope>("all");
  const [assigneeId, setAssigneeId] = useState(series.assignee_id ?? NO_ASSIGNEE);
  const [branchId, setBranchId] = useState(series.branch_id);
  const [shiftType, setShiftType] = useState<ShiftType>(series.shift_type);
  const [weekdays, setWeekdays] = useState<number[]>(series.weekdays);
  const [intervalWeeks, setIntervalWeeks] = useState(series.interval_weeks);
  // Postgres hands `time` back as "HH:MM:SS"; the pickers speak "HH:MM".
  const [startTime, setStartTime] = useState(series.start_time.slice(0, 5));
  const [endTime, setEndTime] = useState(series.end_time.slice(0, 5));
  const [endsOn, setEndsOn] = useState(
    series.ends_on ?? format(startOfDay(new Date()), DATE_FORMAT)
  );
  const [openEnded, setOpenEnded] = useState(series.ends_on === null);
  const [note, setNote] = useState(series.note ?? "");
  const [from, setFrom] = useState(() => format(startOfDay(new Date()), DATE_FORMAT));
  const [to, setTo] = useState(() => format(startOfDay(new Date()), DATE_FORMAT));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const isRange = scope === "range";

  async function onConfirm(event?: React.FormEvent) {
    event?.preventDefault();
    setError("");
    setPending(true);
    try {
      const result = await updateShiftSeriesAction({
        series_id: series.id,
        scope,
        shift_type: shiftType,
        branch_id: shiftType === "remote" ? undefined : branchId,
        assignee_id: assigneeId === NO_ASSIGNEE ? undefined : assigneeId,
        weekdays,
        interval_weeks: intervalWeeks,
        start_time: startTime,
        end_time: endTime,
        ends_on: openEnded ? "" : endsOn,
        note: note.trim() || undefined,
        from: isRange ? from : undefined,
        to: isRange ? to : undefined,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      // kept and conflicts are not footnotes. "kept" means those occurrences
      // already have a clock-in and were deliberately left on their old times;
      // "conflicts" means the new rule could not be placed on those dates. A
      // manager who reads only "Đã cập nhật N ca" would assume the whole scope
      // moved, which is exactly the wrong thing to assume about a roster.
      const parts = [`Đã cập nhật ${result.data.updated} ca`];
      if (result.data.kept > 0) parts.push(`giữ nguyên ${result.data.kept} ca đã có chấm công`);
      if (result.data.conflicts > 0) parts.push(`${result.data.conflicts} buổi trùng giờ bị bỏ qua`);
      toast.success(parts.join(" — "));

      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {/* Wrapped in a real <form> so Enter saves, the way every other form in
            the app behaves. Safe here because every control inside is either
            type="button" (scope options, the "Không kết thúc" pill, Huỷ,
            DatePickerField's trigger, WeekdayPills) or swallows Enter itself —
            TimePickerField calls preventDefault(), so Enter in a time field
            commits the time and stops there rather than also saving. */}
        <form className="space-y-4" onSubmit={onConfirm}>
        <DialogHeader>
          <DialogTitle>Sửa ca cố định</DialogTitle>
          <DialogDescription>
            Ca đã có chấm công và các buổi đã qua luôn được giữ nguyên, để không làm sai bảng công.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {SCOPE_OPTIONS.map((option) => {
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

        {isRange && (
          <div className="grid gap-3 sm:grid-cols-2">
            <DatePickerField id="series_edit_from" label="Từ ngày" value={from} onChange={setFrom} />
            <DatePickerField id="series_edit_to" label="Đến ngày" value={to} onChange={setTo} />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="series_edit_assignee">Nhân viên</Label>
          <Select value={assigneeId} onValueChange={setAssigneeId}>
            <SelectTrigger id="series_edit_assignee" className="w-full">
              <SelectValue placeholder="Chọn nhân viên" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_ASSIGNEE}>Để trống — gán người sau</SelectItem>
              {branchMembers.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="series_edit_type">Loại ca</Label>
            <Select value={shiftType} onValueChange={(value) => setShiftType(value as ShiftType)}>
              <SelectTrigger id="series_edit_type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EDITABLE_SHIFT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {SHIFT_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {shiftType !== "remote" && (
            <div className="space-y-1.5">
              <Label htmlFor="series_edit_branch">Cơ sở</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger id="series_edit_branch" className="w-full">
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
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <TimePickerField
            id="series_edit_start"
            label="Giờ bắt đầu"
            value={startTime}
            onChange={setStartTime}
          />
          <TimePickerField
            id="series_edit_end"
            label="Giờ kết thúc"
            value={endTime}
            onChange={setEndTime}
          />
        </div>

        {/* Rule-wide fields. Hidden for "range" because they have no coherent
            meaning over a slice — there is no way to make one fortnight of a
            Monday series run on Tuesdays. The RPC ignores them there too. */}
        {!isRange && (
          <>
            <div className="space-y-1.5">
              <Label>Ngày trong tuần</Label>
              <WeekdayPills value={weekdays} onChange={setWeekdays} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="series_edit_interval">Lặp mỗi</Label>
                <Select
                  value={String(intervalWeeks)}
                  onValueChange={(value) => setIntervalWeeks(Number(value))}
                >
                  <SelectTrigger id="series_edit_interval" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERVAL_OPTIONS.map((weeks) => (
                      <SelectItem key={weeks} value={String(weeks)}>
                        {weeks} tuần
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {openEnded ? (
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground text-xs tracking-wide uppercase">
                    Đến ngày
                  </Label>
                  <div className="border-input text-muted-foreground flex h-9 items-center rounded-md border border-dashed px-3 text-sm">
                    Không kết thúc
                  </div>
                </div>
              ) : (
                <DatePickerField
                  id="series_edit_ends_on"
                  label="Đến ngày"
                  value={endsOn}
                  onChange={setEndsOn}
                />
              )}
            </div>

            <button
              type="button"
              aria-pressed={openEnded}
              onClick={() => setOpenEnded((previous) => !previous)}
              className={cn(
                "h-8 w-fit rounded-full border px-3 text-xs font-medium transition-colors",
                "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                openEnded
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-input bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
              )}
            >
              Không kết thúc
            </button>

            <p className="text-muted-foreground text-xs">
              Ngày bắt đầu ({series.starts_on}) không đổi được — nó là mốc đếm tuần của cả luật.
            </p>
          </>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="series_edit_note">Ghi chú</Label>
          <Input
            id="series_edit_note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Không bắt buộc"
          />
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Đang lưu..." : "Lưu thay đổi"}
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
