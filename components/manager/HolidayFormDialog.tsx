"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { format } from "date-fns";
import { CalendarDaysIcon, ClockIcon } from "lucide-react";
import { createHolidayAction, updateHolidayAction } from "@/actions/holidays";
import { holidaySchema, type HolidayInput } from "@/lib/validations/holiday";
import type { Holiday } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { TimePickerField } from "@/components/ui/time-picker-field";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const DURATION_OPTIONS = [
  { value: false, label: "Nguyên ngày", icon: CalendarDaysIcon },
  { value: true, label: "Nửa ngày", icon: ClockIcon },
] as const;

// Early afternoon — the usual shape of a Vietnamese half-day off, and the
// owner's own example ("nửa ngày 1/9"). Only ever a starting suggestion; the
// picker takes any minute.
const DEFAULT_HALF_DAY_START = "12:00";

// One dialog for both create and edit — the fields are identical and the only
// difference is which action runs. `holiday` present means edit.
export default function HolidayFormDialog({
  open,
  onOpenChange,
  holiday,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  holiday?: Holiday;
}) {
  const isEdit = Boolean(holiday);
  const [serverError, setServerError] = useState("");
  // Tracked here rather than read back with watch(): once the end date has
  // been chosen deliberately, moving the start date must not silently drag it
  // along. An existing holiday counts as already-chosen from the outset.
  // (Local state also keeps watch() out of this component, which the React
  // Compiler cannot memoize — see the react-hooks/incompatible-library
  // warnings the other form dialogs carry.)
  const [endTouched, setEndTouched] = useState(isEdit);
  // Mirrored in local state for the same reason as endTouched: watch() is what
  // the React Compiler can't memoize, and this value only ever changes from
  // the segmented control right here.
  const [halfDay, setHalfDay] = useState(Boolean(holiday?.half_day));
  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<HolidayInput>({
    resolver: zodResolver(holidaySchema),
    defaultValues: initialValues(holiday),
  });

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (next) {
      setServerError("");
      setEndTouched(isEdit);
      setHalfDay(Boolean(holiday?.half_day));
      reset(initialValues(holiday));
    }
  }

  function handleDurationChange(next: boolean) {
    setHalfDay(next);
    setValue("half_day", next, { shouldValidate: true });
    // Give a half-day a usable hour immediately instead of an empty field the
    // form would then refuse; clear it again when switching back so the write
    // matches holidays_half_day_time_valid (0082).
    setValue("start_time", next ? DEFAULT_HALF_DAY_START : "", { shouldValidate: next });
  }

  async function onSubmit(values: HolidayInput) {
    setServerError("");
    const result = holiday
      ? await updateHolidayAction({ id: holiday.id, values })
      : await createHolidayAction(values);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast.success(isEdit ? "Đã cập nhật ngày lễ" : "Đã thêm ngày lễ");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Sửa ngày lễ" : "Thêm ngày lễ"}</DialogTitle>
          <DialogDescription>
            Ngày lễ chỉ hiển thị trên lịch — không tự động tạo đơn nghỉ hay bỏ qua ca làm việc.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="holiday_name">Tên ngày lễ</Label>
            <Input id="holiday_name" {...register("name")} placeholder="Vd: Nghỉ Quốc khánh" />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Controller
              control={control}
              name="start_date"
              render={({ field }) => (
                <DatePickerField
                  id="holiday_start_date"
                  label="Từ ngày"
                  value={field.value}
                  onChange={(value) => {
                    field.onChange(value);
                    // A one-day holiday is the common case, so the end follows
                    // the start until someone sets it themselves.
                    if (!endTouched) {
                      setValue("end_date", value, { shouldValidate: true });
                    }
                  }}
                  error={errors.start_date?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="end_date"
              render={({ field }) => (
                <DatePickerField
                  id="holiday_end_date"
                  label="Đến hết ngày"
                  value={field.value}
                  onChange={(value) => {
                    setEndTouched(true);
                    field.onChange(value);
                  }}
                  error={errors.end_date?.message}
                />
              )}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Thời lượng nghỉ</Label>
            <div className="flex flex-wrap gap-1 rounded-full bg-muted p-1">
              {DURATION_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => handleDurationChange(value)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-sm font-medium transition-colors",
                    halfDay === value
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {label}
                </button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              {halfDay
                ? "Lịch tô màu từ giờ bắt đầu đến hết ngày. Nếu nghỉ nhiều ngày, chỉ ngày đầu tiên tính nửa ngày, những ngày sau nghỉ nguyên ngày."
                : "Lịch tô màu nhạt suốt cả ngày."}
            </p>
          </div>

          {halfDay && (
            <div className="space-y-1.5">
              <Controller
                control={control}
                name="start_time"
                render={({ field }) => (
                  <TimePickerField
                    id="holiday_start_time"
                    label="Bắt đầu nghỉ lúc"
                    value={field.value || DEFAULT_HALF_DAY_START}
                    onChange={field.onChange}
                  />
                )}
              />
              {errors.start_time && (
                <p className="text-sm text-destructive">{errors.start_time.message}</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="holiday_note">Ghi chú (không bắt buộc)</Label>
            <Textarea
              id="holiday_note"
              rows={2}
              {...register("note")}
              placeholder="Vd: nghỉ bù thứ Hai"
            />
            {errors.note && <p className="text-sm text-destructive">{errors.note.message}</p>}
          </div>

          {serverError && <p className="text-sm text-destructive">{serverError}</p>}

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isEdit ? "Lưu thay đổi" : "Thêm ngày lễ"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function initialValues(holiday?: Holiday): HolidayInput {
  const today = format(new Date(), "yyyy-MM-dd");
  return {
    name: holiday?.name ?? "",
    start_date: holiday?.start_date ?? today,
    end_date: holiday?.end_date ?? today,
    half_day: holiday?.half_day ?? false,
    // Postgres hands back "13:00:00"; TimePickerField and the schema both work
    // in "HH:mm".
    start_time: holiday?.start_time?.slice(0, 5) ?? "",
    note: holiday?.note ?? "",
  };
}
