"use client";

import { useEffect, useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { addDays, format, startOfDay } from "date-fns";
import { CalendarSyncIcon } from "lucide-react";
import { createShiftSeriesAction, type SeriesCreateSummary } from "@/actions/shift-series";
import { SHIFT_TYPE_LABELS, detectShiftType } from "@/lib/constants";
import { SHIFT_TYPES } from "@/lib/validations/shift";
import { formatSeriesDate } from "@/lib/shift-series";
import { isManagerRole } from "@/lib/roles";
import type { Branch, Profile, ShiftType } from "@/types";
import WeekdayPills from "@/components/shifts/WeekdayPills";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { TimePickerField } from "@/components/ui/time-picker-field";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
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
} from "@/components/ui/dialog";

const DATE_FORMAT = "yyyy-MM-dd";
const DEFAULT_SPAN_DAYS = 84; // 12 tuần — đúng tầm nhìn spec đặt ra cho Đợt 2.
const INTERVAL_OPTIONS = [1, 2, 3, 4] as const;

// Only the three fields react-hook-form is actually useful for. Everything
// else (weekdays, times, dates, interval, shift type) is local state, the same
// split ShiftFormDialog uses — those controls aren't inputs and don't register.
// Radix Select cannot hold an empty string as an item value, so "leave it
// empty" needs a sentinel of its own rather than "".
const NO_ASSIGNEE = "__none__";

const formSchema = z.object({
  // Optional since Đợt 3 — an empty assignee plans the rule as unfilled slots
  // that a manager assigns later. Validated as a uuid only when present.
  assignee_id: z.union([z.uuid(), z.literal(NO_ASSIGNEE)]).optional(),
  branch_id: z.uuid("Vui lòng chọn cơ sở").optional(),
  note: z.string().max(280, "Ghi chú tối đa 280 ký tự").optional(),
});
type FormValues = z.infer<typeof formSchema>;

export default function ShiftSeriesFormDialog({
  open,
  onOpenChange,
  branchMembers,
  branches,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchMembers: Pick<Profile, "id" | "full_name" | "role" | "secondary_role" | "branch_ids">[];
  branches: Branch[];
}) {
  const [serverError, setServerError] = useState("");
  const [weekdayError, setWeekdayError] = useState("");
  const [wasOpen, setWasOpen] = useState(false);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [intervalWeeks, setIntervalWeeks] = useState(1);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("11:00");
  const [shiftType, setShiftType] = useState<ShiftType>("morning");
  const [startsOn, setStartsOn] = useState(() => format(startOfDay(new Date()), DATE_FORMAT));
  const [endsOn, setEndsOn] = useState(() =>
    format(addDays(startOfDay(new Date()), DEFAULT_SPAN_DAYS), DATE_FORMAT)
  );
  // "Không kết thúc" (Đợt 2). Its own flag rather than inferred from
  // endsOn === "": toggling it back off has to restore a sensible date, which
  // is only possible if the previous value survives somewhere. The submitted
  // payload sends "" while this is on, which actions/shift-series.ts maps to a
  // null p_ends_on.
  const [openEnded, setOpenEnded] = useState(false);
  // Set once the RPC has run. Its presence swaps the form out for the report —
  // the skipped weeks are the whole point of the "bỏ qua rồi báo lại" design
  // and would be lost if the dialog just closed on success.
  const [summary, setSummary] = useState<SeriesCreateSummary | null>(null);

  function handleStartTimeChange(value: string) {
    setStartTime(value);
    setShiftType(detectShiftType(value));
  }

  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    getValues,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  // Same branch narrowing as ShiftFormDialog: management-tier staff have no
  // profile_branches rows (they cover every branch by design), everyone else
  // is limited to the branches they actually belong to.
  const selectedAssigneeId = watch("assignee_id");
  const selectedAssignee = branchMembers.find((member) => member.id === selectedAssigneeId);
  const allowedBranches =
    !selectedAssignee || isManagerRole(selectedAssignee.role)
      ? branches
      : branches.filter((branch) => selectedAssignee.branch_ids.includes(branch.id));

  const previousAssigneeIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      previousAssigneeIdRef.current !== undefined &&
      previousAssigneeIdRef.current !== selectedAssigneeId
    ) {
      const currentBranchId = getValues("branch_id");
      if (currentBranchId && !allowedBranches.some((branch) => branch.id === currentBranchId)) {
        setValue("branch_id", "");
      }
    }
    previousAssigneeIdRef.current = selectedAssigneeId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssigneeId]);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const today = startOfDay(new Date());
      setServerError("");
      setWeekdayError("");
      setSummary(null);
      setWeekdays([]);
      setIntervalWeeks(1);
      setStartTime("09:00");
      setEndTime("11:00");
      setShiftType("morning");
      setStartsOn(format(today, DATE_FORMAT));
      setEndsOn(format(addDays(today, DEFAULT_SPAN_DAYS), DATE_FORMAT));
      reset({ assignee_id: undefined, branch_id: undefined, note: "" });
    }
  }

  async function onSubmit(values: FormValues) {
    setServerError("");
    setWeekdayError("");

    if (weekdays.length === 0) {
      setWeekdayError("Vui lòng chọn ít nhất một ngày trong tuần");
      return;
    }
    if (shiftType !== "remote" && !values.branch_id) {
      setError("branch_id", { message: "Vui lòng chọn cơ sở" });
      return;
    }

    // Times and dates are sent as they are typed — "18:00", "2026-09-01" —
    // never converted to an instant here. A rule has no instant, and this
    // browser's timezone is not the one the shifts belong to.
    const assigneeId =
      values.assignee_id && values.assignee_id !== NO_ASSIGNEE ? values.assignee_id : undefined;

    const result = await createShiftSeriesAction({
      assignee_id: assigneeId,
      branch_id: values.branch_id,
      shift_type: shiftType,
      weekdays,
      interval_weeks: intervalWeeks,
      start_time: startTime,
      end_time: endTime,
      starts_on: startsOn,
      ends_on: openEnded ? "" : endsOn,
      note: values.note || undefined,
    });

    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    setSummary(result.data);
    if (result.data.created > 0) {
      toast.success(
        result.data.unassigned
          ? `Đã tạo ${result.data.created} ô ca chưa gán người`
          : `Đã tạo ${result.data.created} ca cố định`
      );
    }
  }

  const overnight = endTime <= startTime;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="from-primary to-primary/70 text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br">
              <CalendarSyncIcon className="size-4" />
            </span>
            <div>
              <DialogTitle>Tạo ca cố định</DialogTitle>
              <DialogDescription>
                Lặp lại cùng một ca hằng tuần cho một nhân viên, trong khoảng ngày đã chọn.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {summary ? (
          <div className="space-y-4">
            <p className="text-sm">
              Đã tạo <span className="font-semibold tabular-nums">{summary.created}</span>{" "}
              {summary.unassigned ? "ô ca chưa gán người." : "ca."}
            </p>
            {summary.unassigned && summary.created > 0 && (
              <p className="text-muted-foreground text-sm">
                Gán người cho từng ô ở mục &ldquo;Ô ca chưa gán người&rdquo; bên dưới.
              </p>
            )}
            {summary.skipped.length > 0 && (
              <div className="border-input space-y-2 rounded-lg border p-3">
                <p className="text-sm font-medium">Bỏ qua {summary.skipped.length} ngày:</p>
                <ul className="text-muted-foreground space-y-1 text-sm">
                  {summary.skipped.map((skip) => (
                    <li key={skip.date}>
                      {formatSeriesDate(skip.date)} — {skip.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {summary.created === 0 && summary.skipped.length === 0 && (
              <p className="text-muted-foreground text-sm">
                Không có ngày nào khớp với luật lặp trong khoảng đã chọn.
              </p>
            )}
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Đóng
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="series_assignee_id">Nhân viên (không bắt buộc)</Label>
              <Controller
                control={control}
                name="assignee_id"
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger id="series_assignee_id" className="w-full">
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
                )}
              />
              {errors.assignee_id && (
                <p className="text-destructive text-sm">{errors.assignee_id.message}</p>
              )}
              <p className="text-muted-foreground text-xs">
                Để trống nếu chưa biết ai trực — hệ thống tạo sẵn các ô ca để gán người sau.
                Nhân viên không nhìn thấy ô trống.
              </p>
            </div>

            {shiftType !== "remote" && (
              <div className="space-y-1.5">
                <Label htmlFor="series_branch_id">Cơ sở</Label>
                <Controller
                  control={control}
                  name="branch_id"
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger id="series_branch_id" className="w-full">
                        <SelectValue placeholder="Chọn cơ sở" />
                      </SelectTrigger>
                      <SelectContent>
                        {allowedBranches.map((branch) => (
                          <SelectItem key={branch.id} value={branch.id}>
                            {branch.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.branch_id && (
                  <p className="text-destructive text-sm">{errors.branch_id.message}</p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Lặp vào các thứ</Label>
              <WeekdayPills value={weekdays} onChange={setWeekdays} />
              {weekdayError && <p className="text-destructive text-sm">{weekdayError}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="series_interval">Tần suất</Label>
              <Select
                value={String(intervalWeeks)}
                onValueChange={(value) => setIntervalWeeks(Number(value))}
              >
                <SelectTrigger id="series_interval" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVAL_OPTIONS.map((weeks) => (
                    <SelectItem key={weeks} value={String(weeks)}>
                      {weeks === 1 ? "Hằng tuần" : `Mỗi ${weeks} tuần`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <TimePickerField
                  id="series_start_time"
                  label="Bắt đầu"
                  value={startTime}
                  onChange={handleStartTimeChange}
                />
                <TimePickerField
                  id="series_end_time"
                  label="Kết thúc"
                  value={endTime}
                  onChange={setEndTime}
                />
              </div>
              {overnight && (
                <p className="text-muted-foreground text-xs">
                  Ca qua đêm — mỗi buổi sẽ kết thúc vào sáng hôm sau.
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <DatePickerField
                  id="series_starts_on"
                  label="Từ ngày"
                  value={startsOn}
                  onChange={setStartsOn}
                />
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
                    id="series_ends_on"
                    label="Đến ngày"
                    value={endsOn}
                    onChange={setEndsOn}
                  />
                )}
              </div>

              {/* A pill rather than a checkbox: this repo has no checkbox
                  primitive, and WeekdayPills right above uses exactly this
                  aria-pressed toggle idiom. */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  aria-pressed={openEnded}
                  onClick={() => setOpenEnded((previous) => !previous)}
                  className={cn(
                    "h-8 rounded-full border px-3 text-xs font-medium transition-colors",
                    "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                    openEnded
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-input bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  )}
                >
                  Không kết thúc
                </button>
                {openEnded && (
                  <span className="text-muted-foreground text-xs">
                    Tạo trước 12 tuần, tự động gia hạn mỗi đêm.
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="series_shift_type">Loại ca</Label>
              <Select value={shiftType} onValueChange={(value) => setShiftType(value as ShiftType)}>
                <SelectTrigger id="series_shift_type" className="w-full">
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
              {/* The only optional field in this form — every other one is
                  enforced by shiftSeriesSchema. Wording matches the label in
                  ShiftRequestDialog/LeaveRequestDialog/SwapRequestDialog. */}
              <Label htmlFor="series_note">Ghi chú (không bắt buộc)</Label>
              <Textarea id="series_note" rows={2} {...register("note")} />
            </div>

            {serverError && <p className="text-destructive text-sm">{serverError}</p>}

            <DialogFooter>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Đang tạo..." : "Tạo ca cố định"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
