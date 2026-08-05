"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { PlusIcon, CalendarOffIcon, SunriseIcon, SunsetIcon, ClockIcon } from "lucide-react";
import { requestLeaveAction } from "@/actions/leave";
import { leaveRequestSchema, type LeaveRequestInput } from "@/lib/validations/leave";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { TimePickerField } from "@/components/ui/time-picker-field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { LeaveRequestType } from "@/types";

const TYPE_OPTIONS: { value: LeaveRequestType; label: string; icon: typeof ClockIcon }[] = [
  { value: "full_day", label: "Cả ngày", icon: CalendarOffIcon },
  { value: "hourly", label: "Theo giờ", icon: ClockIcon },
  { value: "late_arrival", label: "Đến muộn", icon: SunriseIcon },
  { value: "early_leave", label: "Về sớm", icon: SunsetIcon },
];

export default function LeaveRequestDialog() {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState("");
  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LeaveRequestInput>({ resolver: zodResolver(leaveRequestSchema) });

  const requestType = watch("request_type");
  const startDate = watch("start_date");

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setServerError("");
      reset({
        request_type: "full_day",
        start_date: "",
        end_date: "",
        start_time: "",
        end_time: "",
        reason: "",
      });
    }
  }

  function handleTypeChange(next: LeaveRequestType) {
    setValue("request_type", next);
    // Đến muộn / về sớm / theo giờ are single-day only — collapse "Đến ngày"
    // onto "Từ ngày" the moment you leave "Cả ngày" so the request stays valid.
    if (next !== "full_day" && startDate) {
      setValue("end_date", startDate, { shouldValidate: true });
    }
  }

  async function onSubmit(values: LeaveRequestInput) {
    setServerError("");
    const result = await requestLeaveAction(values);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast.success("Đã gửi đơn xin nghỉ phép");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <PlusIcon className="size-4" />
          Xin nghỉ phép
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Xin nghỉ phép</DialogTitle>
          <DialogDescription>Gửi yêu cầu nghỉ phép để quản lý duyệt.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="flex flex-wrap gap-1 rounded-full bg-muted p-1">
            {TYPE_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => handleTypeChange(value)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-sm font-medium transition-colors",
                  requestType === value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          {requestType === "full_day" ? (
            <div className="grid grid-cols-2 gap-3">
              <Controller
                control={control}
                name="start_date"
                render={({ field }) => (
                  <DatePickerField
                    id="start_date"
                    label="Từ ngày"
                    value={field.value}
                    onChange={field.onChange}
                    error={errors.start_date?.message}
                  />
                )}
              />
              <Controller
                control={control}
                name="end_date"
                render={({ field }) => (
                  <DatePickerField
                    id="end_date"
                    label="Đến ngày"
                    value={field.value}
                    onChange={field.onChange}
                    error={errors.end_date?.message}
                  />
                )}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <Controller
                control={control}
                name="start_date"
                render={({ field }) => (
                  <DatePickerField
                    id="single_date"
                    label="Ngày"
                    value={field.value}
                    onChange={(value) => {
                      field.onChange(value);
                      setValue("end_date", value, { shouldValidate: true });
                    }}
                    error={errors.start_date?.message ?? errors.end_date?.message}
                  />
                )}
              />

              {requestType === "late_arrival" && (
                <Controller
                  control={control}
                  name="start_time"
                  render={({ field }) => (
                    <TimePickerField
                      id="arrival_time"
                      label="Có mặt lúc"
                      value={field.value || "09:00"}
                      onChange={field.onChange}
                    />
                  )}
                />
              )}
              {requestType === "early_leave" && (
                <Controller
                  control={control}
                  name="end_time"
                  render={({ field }) => (
                    <TimePickerField
                      id="leave_time"
                      label="Rời đi lúc"
                      value={field.value || "17:00"}
                      onChange={field.onChange}
                    />
                  )}
                />
              )}
              {requestType === "hourly" && (
                <div className="grid grid-cols-2 gap-3">
                  <Controller
                    control={control}
                    name="start_time"
                    render={({ field }) => (
                      <TimePickerField
                        id="hourly_start"
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
                        id="hourly_end"
                        label="Đến giờ"
                        value={field.value || "11:00"}
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
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="reason">Lý do (không bắt buộc)</Label>
            <Textarea id="reason" rows={3} {...register("reason")} />
            {errors.reason && <p className="text-sm text-destructive">{errors.reason.message}</p>}
          </div>

          {serverError && <p className="text-sm text-destructive">{serverError}</p>}

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              Gửi đơn
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
