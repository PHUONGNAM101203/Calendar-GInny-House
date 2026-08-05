"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { format } from "date-fns";
import { createCustomEventAction } from "@/actions/custom-calendars";
import { customEventSchema, type CustomEventInput } from "@/lib/validations/custom-event";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { TimePickerField } from "@/components/ui/time-picker-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function CustomEventFormDialog({
  open,
  onOpenChange,
  calendarId,
  calendarName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calendarId: string;
  calendarName: string;
}) {
  const [serverError, setServerError] = useState("");
  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CustomEventInput>({ resolver: zodResolver(customEventSchema) });

  const allDay = watch("all_day");
  const startDate = watch("start_date");

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (next) {
      setServerError("");
      const today = format(new Date(), "yyyy-MM-dd");
      reset({
        title: "",
        all_day: true,
        start_date: today,
        end_date: today,
        start_time: "09:00",
        end_time: "10:00",
      });
    }
  }

  async function onSubmit(values: CustomEventInput) {
    setServerError("");
    const result = await createCustomEventAction(calendarId, values);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast.success("Đã thêm sự kiện");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Thêm sự kiện</DialogTitle>
          <DialogDescription>Thêm vào lịch “{calendarName}”.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Tên sự kiện</Label>
            <Input id="title" {...register("title")} placeholder="Vd: Lịch thi thử" />
            {errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}
          </div>

          <label className="flex w-fit items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input accent-primary"
              checked={allDay}
              onChange={(e) => setValue("all_day", e.target.checked)}
            />
            Cả ngày
          </label>

          <div className="grid grid-cols-2 gap-3">
            <Controller
              control={control}
              name="start_date"
              render={({ field }) => (
                <DatePickerField
                  id="custom_start_date"
                  label="Từ ngày"
                  value={field.value}
                  onChange={(value) => {
                    field.onChange(value);
                    if (!endDateTouched(startDate, watch("end_date"))) {
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
                  id="custom_end_date"
                  label="Đến ngày"
                  value={field.value}
                  onChange={field.onChange}
                  error={errors.end_date?.message}
                />
              )}
            />
          </div>

          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <Controller
                control={control}
                name="start_time"
                render={({ field }) => (
                  <TimePickerField
                    id="custom_start_time"
                    label="Từ giờ"
                    value={field.value || "09:00"}
                    onChange={field.onChange}
                  />
                )}
              />
              <Controller
                control={control}
                name="end_time"
                render={({ field }) => (
                  <TimePickerField
                    id="custom_end_time"
                    label="Đến giờ"
                    value={field.value || "10:00"}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>
          )}
          {(errors.start_time || errors.end_time) && (
            <p className="text-sm text-destructive">
              {errors.start_time?.message ?? errors.end_time?.message}
            </p>
          )}

          {serverError && <p className="text-sm text-destructive">{serverError}</p>}

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              Thêm sự kiện
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Once someone has deliberately picked an end date different from the
// start date, changing the start date shouldn't silently drag the end date
// along with it — only auto-follow while the two are still in lockstep.
function endDateTouched(startDate: string, endDate: string) {
  return Boolean(endDate) && endDate !== startDate;
}
