"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { format } from "date-fns";
import { attendanceCorrectionSchema, type AttendanceCorrectionInput } from "@/lib/validations/attendance-correction";
import {
  getAttendanceCorrectionPreviewAction,
  requestAttendanceCorrectionAction,
  type CorrectionPreview,
} from "@/actions/attendance-corrections";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

export default function AttendanceCorrectionForm() {
  const [date, setDate] = useState("");
  const [preview, setPreview] = useState<CorrectionPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<AttendanceCorrectionInput>({ resolver: zodResolver(attendanceCorrectionSchema) });

  async function handleDateChange(value: string) {
    setDate(value);
    setPreview(null);
    setPreviewError("");
    setValue("shift_id", "");
    if (!value) return;

    setLoadingPreview(true);
    const result = await getAttendanceCorrectionPreviewAction({ date: value });
    setLoadingPreview(false);
    if (!result.ok) {
      setPreviewError(result.error);
      return;
    }
    setPreview(result.data);
    if (result.data.kind === "missed_check_in" || result.data.kind === "late_check_in") {
      setValue("shift_id", result.data.shift.id, { shouldValidate: true });
    }
  }

  async function onSubmit(values: AttendanceCorrectionInput) {
    const result = await requestAttendanceCorrectionAction(values);
    if (!result.ok) {
      setPreviewError(result.error);
      return;
    }
    toast.info("Đã gửi đơn giải trình công");
    setDate("");
    setPreview(null);
    reset({ shift_id: "", reason: "" });
  }

  const canSubmit = preview?.kind === "missed_check_in" || preview?.kind === "late_check_in";

  return (
    <Card>
      <CardContent className="space-y-4">
        <DatePickerField id="correction_date" label="Ngày cần giải trình" value={date} onChange={handleDateChange} />

        {loadingPreview && <p className="text-sm text-muted-foreground">Đang kiểm tra...</p>}

        {!loadingPreview && preview?.kind === "no_shift" && (
          <p className="text-sm text-muted-foreground">Bạn không có ca làm việc vào ngày này.</p>
        )}
        {!loadingPreview && preview?.kind === "no_discrepancy" && (
          <p className="text-sm text-muted-foreground">Bạn đã chấm công đúng giờ ngày này, không cần giải trình.</p>
        )}
        {!loadingPreview && preview?.kind === "missed_check_in" && (
          <p className="text-sm text-destructive">
            Bạn chưa chấm công ngày này. Ca {format(new Date(preview.shift.start_at), "HH:mm")}–
            {format(new Date(preview.shift.end_at), "HH:mm")} — hệ thống sẽ sửa giờ vào ca thành{" "}
            {format(new Date(preview.shift.start_at), "HH:mm")}.
          </p>
        )}
        {!loadingPreview && preview?.kind === "late_check_in" && (
          <p className="text-sm text-destructive">
            Bạn chấm công lúc {format(new Date(preview.actualCheckInAt), "HH:mm")}, trễ so với giờ ca{" "}
            {format(new Date(preview.shift.start_at), "HH:mm")}–{format(new Date(preview.shift.end_at), "HH:mm")} —
            hệ thống sẽ sửa lại thành {format(new Date(preview.shift.start_at), "HH:mm")}.
          </p>
        )}
        {previewError && <p className="text-sm text-destructive">{previewError}</p>}

        {canSubmit && (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
            <input type="hidden" {...register("shift_id")} />
            <div className="space-y-1.5">
              <Label htmlFor="reason">Lý do giải trình</Label>
              <Textarea id="reason" rows={3} {...register("reason")} />
              {errors.reason && <p className="text-sm text-destructive">{errors.reason.message}</p>}
            </div>
            <Button type="submit" disabled={isSubmitting}>
              Gửi giải trình
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
