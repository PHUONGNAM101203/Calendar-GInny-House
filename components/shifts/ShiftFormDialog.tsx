"use client";

import { useEffect, useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { format, parse, startOfDay } from "date-fns";
import { ClockIcon } from "lucide-react";
import { createShiftAction, deleteShiftAction, updateShiftAction } from "@/actions/shifts";
import { SHIFT_TYPE_LABELS, detectShiftType } from "@/lib/constants";
import { SHIFT_TYPES } from "@/lib/validations/shift";
import { isManagerRole } from "@/lib/roles";
import ShiftSeriesDeleteDialog from "@/components/shifts/ShiftSeriesDeleteDialog";
import type { ShiftType } from "@/types";
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
} from "@/components/ui/dialog";
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
import type { Branch, Profile, ShiftWithAssignee } from "@/types";

const DATE_FORMAT = "yyyy-MM-dd";
const TIME_FORMAT = "HH:mm";

// Just who + which day + two time fields — no duration ruler, no preset
// shortcuts. Overnight shifts (end time earlier than start) are handled by
// rolling the end onto the next calendar day, so a single date field is
// enough, same as Google Calendar's compact event editor.
const formSchema = z.object({
  assignee_id: z.uuid("Vui lòng chọn nhân viên"),
  // Optional here — shiftType (separate state, not a form field) decides
  // whether it's required; that check happens imperatively in onSubmit
  // below, same as the overnight-shift date rollover already does.
  branch_id: z.uuid("Vui lòng chọn cơ sở").optional(),
  note: z.string().max(280, "Ghi chú tối đa 280 ký tự").optional(),
});
type FormValues = z.infer<typeof formSchema>;

export default function ShiftFormDialog({
  open,
  onOpenChange,
  branchMembers,
  branches,
  shift,
  initialRange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchMembers: Pick<Profile, "id" | "full_name" | "role" | "secondary_role" | "branch_ids">[];
  branches: Branch[];
  shift?: ShiftWithAssignee | null;
  initialRange?: { start: Date; end: Date } | null;
}) {
  const isEdit = Boolean(shift);
  const [serverError, setServerError] = useState("");
  const [wasOpen, setWasOpen] = useState(false);
  const [date, setDate] = useState(() => startOfDay(new Date()));
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("11:00");
  const [shiftType, setShiftType] = useState<ShiftType>("morning");
  // Only reachable for an occurrence of a ca cố định — a one-off shift keeps
  // the plain confirm, because two of the three scopes would mean nothing.
  const [scopeDeleteOpen, setScopeDeleteOpen] = useState(false);

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

  // The branch picker narrows to whichever assignee is currently selected —
  // full list for management-tier (no profile_branches rows, "all
  // branches" by design), otherwise only the branches that person actually
  // belongs to.
  const selectedAssigneeId = watch("assignee_id");
  const selectedAssignee = branchMembers.find((m) => m.id === selectedAssigneeId);
  const allowedBranches = !selectedAssignee || isManagerRole(selectedAssignee.role)
    ? branches
    : branches.filter((b) => selectedAssignee.branch_ids.includes(b.id));

  const previousAssigneeIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      previousAssigneeIdRef.current !== undefined &&
      previousAssigneeIdRef.current !== selectedAssigneeId
    ) {
      const currentBranchId = getValues("branch_id");
      if (currentBranchId && !allowedBranches.some((b) => b.id === currentBranchId)) {
        setValue("branch_id", "");
      }
    }
    previousAssigneeIdRef.current = selectedAssigneeId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssigneeId]);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setServerError("");
      setScopeDeleteOpen(false);
      if (shift) {
        reset({ assignee_id: shift.assignee_id, branch_id: shift.branch_id, note: shift.note ?? "" });
        setDate(startOfDay(new Date(shift.start_at)));
        setStartTime(format(new Date(shift.start_at), TIME_FORMAT));
        setEndTime(format(new Date(shift.end_at), TIME_FORMAT));
        setShiftType(shift.shift_type);
      } else {
        reset({ assignee_id: undefined, branch_id: undefined, note: "" });
        const base = initialRange?.start ?? new Date();
        const initialStart = initialRange ? format(initialRange.start, TIME_FORMAT) : "09:00";
        setDate(startOfDay(base));
        setStartTime(initialStart);
        setEndTime(initialRange ? format(initialRange.end, TIME_FORMAT) : "11:00");
        setShiftType(detectShiftType(initialStart));
      }
    }
  }

  async function onSubmit(values: FormValues) {
    setServerError("");

    if (shiftType !== "remote" && !values.branch_id) {
      setError("branch_id", { message: "Vui lòng chọn cơ sở" });
      return;
    }

    const startDateTime = parse(startTime, TIME_FORMAT, date);
    const endDateTime = parse(endTime, TIME_FORMAT, date);
    if (endDateTime <= startDateTime) {
      endDateTime.setDate(endDateTime.getDate() + 1);
    }

    const payload = {
      assignee_id: values.assignee_id,
      branch_id: values.branch_id,
      start_at: startDateTime.toISOString(),
      end_at: endDateTime.toISOString(),
      shift_type: shiftType,
      note: values.note || undefined,
    };
    const result = isEdit
      ? await updateShiftAction(shift!.id, payload)
      : await createShiftAction(payload);

    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast.success(isEdit ? "Đã cập nhật ca làm việc" : "Đã tạo ca làm việc");
    onOpenChange(false);
  }

  async function onDelete() {
    if (!shift) return;
    const result = await deleteShiftAction(shift.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Đã xoá ca làm việc");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
              <ClockIcon className="size-4" />
            </span>
            <div>
              <DialogTitle>{isEdit ? "Sửa ca làm việc" : "Tạo ca làm việc"}</DialogTitle>
              <DialogDescription>
                {isEdit ? "Cập nhật thông tin ca đã xếp." : "Xếp ca mới cho nhân viên trong cơ sở."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="assignee_id">Nhân viên</Label>
            <Controller
              control={control}
              name="assignee_id"
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger id="assignee_id" className="w-full">
                    <SelectValue placeholder="Chọn nhân viên" />
                  </SelectTrigger>
                  <SelectContent>
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
              <p className="text-sm text-destructive">{errors.assignee_id.message}</p>
            )}
          </div>

          {shiftType !== "remote" && (
            <div className="space-y-1.5">
              <Label htmlFor="branch_id">Cơ sở</Label>
              <Controller
                control={control}
                name="branch_id"
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger id="branch_id" className="w-full">
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
              {errors.branch_id && <p className="text-sm text-destructive">{errors.branch_id.message}</p>}
            </div>
          )}

          <div className="space-y-3">
            <DatePickerField
              id="shift_date"
              label="Ngày"
              value={format(date, DATE_FORMAT)}
              onChange={(value) => setDate(parse(value, DATE_FORMAT, new Date()))}
            />
            <div className="grid grid-cols-2 gap-3">
              <TimePickerField id="start_time" label="Bắt đầu" value={startTime} onChange={handleStartTimeChange} />
              <TimePickerField id="end_time" label="Kết thúc" value={endTime} onChange={setEndTime} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="shift_type">Loại ca</Label>
            <Select value={shiftType} onValueChange={(v) => setShiftType(v as ShiftType)}>
              <SelectTrigger id="shift_type" className="w-full">
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
            <Label htmlFor="note">Ghi chú (không bắt buộc)</Label>
            <Textarea id="note" rows={2} {...register("note")} />
          </div>

          {serverError && <p className="text-sm text-destructive">{serverError}</p>}

          <DialogFooter className="items-center sm:justify-between">
            {isEdit && shift?.series_id ? (
              <Button type="button" variant="destructive" onClick={() => setScopeDeleteOpen(true)}>
                Xoá ca
              </Button>
            ) : isEdit ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="destructive">
                    Xoá ca
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Xoá ca làm việc?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Hành động này không thể hoàn tác.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Huỷ</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={onDelete}>
                      Xoá
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Đang lưu..." : "Lưu"}
            </Button>
          </DialogFooter>
        </form>

        {shift?.series_id && (
          <ShiftSeriesDeleteDialog
            open={scopeDeleteOpen}
            onOpenChange={setScopeDeleteOpen}
            seriesId={shift.series_id}
            shiftId={shift.id}
            // Closes the edit dialog too — whichever scope ran, the shift this
            // form was editing is either gone or no longer the thing on screen.
            onDeleted={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
