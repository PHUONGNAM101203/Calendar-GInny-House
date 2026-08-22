"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { PlusIcon, XIcon } from "lucide-react";
import { attendanceCorrectionSchema, checkoutCorrectionSchema } from "@/lib/validations/attendance-correction";
import {
  getAttendanceCorrectionPreviewAction,
  requestAttendanceCorrectionsAction,
  requestCheckoutCorrectionAction,
  type CorrectionPreview,
} from "@/actions/attendance-corrections";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { TimePickerField } from "@/components/ui/time-picker-field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

type CorrectionRow = {
  key: string;
  date: string;
  preview: CorrectionPreview | null;
  previewError: string;
  loadingPreview: boolean;
  checkOutTime: string;
  reason: string;
  reasonError: string;
};

function emptyRow(key: string): CorrectionRow {
  return {
    key,
    date: "",
    preview: null,
    previewError: "",
    loadingPreview: false,
    checkOutTime: "",
    reason: "",
    reasonError: "",
  };
}

function canSubmitRow(row: CorrectionRow) {
  return row.preview?.kind === "missed_check_in" || row.preview?.kind === "late_check_in";
}

function shiftIdForRow(row: CorrectionRow): string | null {
  return row.preview?.kind === "missed_check_in" || row.preview?.kind === "late_check_in"
    ? row.preview.shift.id
    : null;
}

function isCheckoutRow(row: CorrectionRow) {
  return row.preview?.kind === "check_out_available";
}

// The stored instants are UTC; every time the user sees or types is Vietnam
// wall-clock, so the zone is pinned rather than trusting the browser's.
function formatVn(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

// Supports both a single giải trình (the default one-row state) and several
// at once — "Thêm ca cần giải trình" appends another independent row, each
// with its own date → shift-preview → reason flow, submitted together in
// one requestAttendanceCorrectionsAction call.
export default function AttendanceCorrectionForm() {
  // "row-0" (not crypto.randomUUID()) — this initial state is computed
  // during both the server render and the client hydration render of this
  // client component, so a random value here would differ between the two
  // passes and produce a real hydration mismatch on every id/htmlFor pair
  // this row's DatePickerField renders. Rows added later via addRow() are
  // client-only (an onClick handler can't run during SSR), so they're safe
  // to key with a real random id.
  const [rows, setRows] = useState<CorrectionRow[]>(() => [emptyRow("row-0")]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateRow(key: string, patch: Partial<CorrectionRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function handleDateChange(key: string, value: string) {
    updateRow(key, { date: value, preview: null, previewError: "", loadingPreview: Boolean(value) });
    if (!value) return;

    const result = await getAttendanceCorrectionPreviewAction({ date: value });
    if (!result.ok) {
      updateRow(key, { previewError: result.error, loadingPreview: false });
      return;
    }
    const preview = result.data;
    // Seed the field so the common case — nudging a recorded check-out by a
    // few minutes — starts from the real value instead of blank.
    updateRow(key, {
      preview,
      loadingPreview: false,
      checkOutTime:
        preview.kind === "check_out_available"
          ? formatVn(preview.actualCheckOutAt ?? preview.shift.end_at)
          : "",
    });
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow(crypto.randomUUID())]);
  }

  function removeRow(key: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  async function handleSubmit() {
    const submittable = rows.filter(canSubmitRow);
    if (submittable.length === 0) return;

    const entries: { key: string; shift_id: string; reason: string }[] = [];
    let hasError = false;
    for (const row of submittable) {
      const parsed = attendanceCorrectionSchema.safeParse({
        shift_id: shiftIdForRow(row),
        reason: row.reason,
      });
      if (!parsed.success) {
        updateRow(row.key, { reasonError: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" });
        hasError = true;
        continue;
      }
      updateRow(row.key, { reasonError: "" });
      entries.push({ key: row.key, shift_id: parsed.data.shift_id, reason: parsed.data.reason });
    }
    if (hasError || entries.length === 0) return;

    setIsSubmitting(true);
    const result = await requestAttendanceCorrectionsAction(
      entries.map(({ shift_id, reason }) => ({ shift_id, reason }))
    );
    setIsSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    const failedByKey = new Map(
      entries
        .map((entry) => ({ entry, failure: result.data.failed.find((f) => f.shift_id === entry.shift_id) }))
        .filter((x): x is typeof x & { failure: NonNullable<typeof x.failure> } => Boolean(x.failure))
        .map(({ entry, failure }) => [entry.key, failure.error])
    );

    setRows((prev) => {
      const kept = prev.filter((r) => !canSubmitRow(r) || failedByKey.has(r.key));
      const withErrors = kept.map((r) => (failedByKey.has(r.key) ? { ...r, reasonError: failedByKey.get(r.key)! } : r));
      return withErrors.length === 0 ? [emptyRow(crypto.randomUUID())] : withErrors;
    });

    if (result.data.succeededCount > 0) {
      toast.info(
        result.data.succeededCount === 1
          ? "Đã gửi đơn giải trình công"
          : `Đã gửi ${result.data.succeededCount} đơn giải trình công`
      );
    }
    if (result.data.failed.length > 0 && result.data.succeededCount > 0) {
      toast.warning(`${result.data.failed.length} ca gửi thất bại, vui lòng kiểm tra lại`);
    }
  }

  async function handleSubmitCheckout(row: CorrectionRow) {
    if (row.preview?.kind !== "check_out_available") return;

    const parsed = checkoutCorrectionSchema.safeParse({
      shift_id: row.preview.shift.id,
      check_out_time: row.checkOutTime,
      reason: row.reason,
    });
    if (!parsed.success) {
      updateRow(row.key, { reasonError: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" });
      return;
    }

    setIsSubmitting(true);
    const result = await requestCheckoutCorrectionAction(parsed.data);
    setIsSubmitting(false);

    if (!result.ok) {
      updateRow(row.key, { reasonError: result.error });
      return;
    }

    toast.info("Đã gửi đơn giải trình giờ ra ca");
    setRows((prev) => {
      const rest = prev.filter((r) => r.key !== row.key);
      return rest.length === 0 ? [emptyRow(crypto.randomUUID())] : rest;
    });
  }

  const hasSubmittable = rows.some(canSubmitRow);

  return (
    // shrink-0: same bug as ClockWidget.tsx's Card — a flex item whose own
    // overflow isn't "visible" (Card ships overflow-hidden) gets an
    // automatic minimum size of 0 in a flex column, so once "Đơn của tôi"
    // below grows past the viewport, this Card would silently shrink and
    // clip its own date picker instead of the page's overflow-y-auto
    // engaging. Confirmed live: a staff member with many giải trình
    // requests saw the date field render corrupted/cut off.
    <Card className="shrink-0">
      <CardContent className="space-y-5">
        {rows.map((row, index) => (
          <div key={row.key} className={index > 0 ? "space-y-3 border-t pt-5" : "space-y-3"}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <DatePickerField
                  id={`correction_date_${row.key}`}
                  label="Ngày cần giải trình"
                  value={row.date}
                  onChange={(value) => handleDateChange(row.key, value)}
                />
              </div>
              {rows.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-6"
                  onClick={() => removeRow(row.key)}
                  aria-label="Xoá dòng giải trình này"
                >
                  <XIcon className="size-4" />
                </Button>
              )}
            </div>

            {row.loadingPreview && <p className="text-sm text-muted-foreground">Đang kiểm tra...</p>}

            {!row.loadingPreview && row.preview?.kind === "no_shift" && (
              <p className="text-sm text-muted-foreground">Bạn không có ca làm việc vào ngày này.</p>
            )}
            {!row.loadingPreview && row.preview?.kind === "no_discrepancy" && (
              <p className="text-sm text-muted-foreground">
                Bạn đã chấm công đúng giờ ngày này, không cần giải trình.
              </p>
            )}
            {!row.loadingPreview && row.preview?.kind === "missed_check_in" && (
              <p className="text-sm text-destructive">
                Bạn chưa chấm công ngày này. Ca {format(new Date(row.preview.shift.start_at), "HH:mm")}–
                {format(new Date(row.preview.shift.end_at), "HH:mm")} — hệ thống sẽ sửa giờ vào ca thành{" "}
                {format(new Date(row.preview.shift.start_at), "HH:mm")}.
              </p>
            )}
            {!row.loadingPreview && row.preview?.kind === "late_check_in" && (
              <p className="text-sm text-destructive">
                Bạn chấm công lúc {format(new Date(row.preview.actualCheckInAt), "HH:mm")}, trễ so với giờ ca{" "}
                {format(new Date(row.preview.shift.start_at), "HH:mm")}–
                {format(new Date(row.preview.shift.end_at), "HH:mm")} — hệ thống sẽ sửa lại thành{" "}
                {format(new Date(row.preview.shift.start_at), "HH:mm")}.
              </p>
            )}
            {!row.loadingPreview && row.preview?.kind === "check_out_available" && (
              <p className="text-sm text-muted-foreground">
                Bạn vào ca lúc {formatVn(row.preview.actualCheckInAt)}.{" "}
                {row.preview.actualCheckOutAt
                  ? `Giờ ra đang ghi nhận là ${formatVn(row.preview.actualCheckOutAt)}.`
                  : "Ca này chưa có giờ ra."}
              </p>
            )}

            {isCheckoutRow(row) && (
              <div className="max-w-44">
                <TimePickerField
                  id={`checkout_time_${row.key}`}
                  label="Giờ ra ca đề nghị"
                  value={row.checkOutTime}
                  onChange={(value) => updateRow(row.key, { checkOutTime: value, reasonError: "" })}
                />
              </div>
            )}

            {row.previewError && <p className="text-sm text-destructive">{row.previewError}</p>}

            {(canSubmitRow(row) || isCheckoutRow(row)) && (
              <div className="space-y-1.5">
                <Label htmlFor={`reason_${row.key}`}>Lý do giải trình</Label>
                <Textarea
                  id={`reason_${row.key}`}
                  rows={3}
                  value={row.reason}
                  onChange={(e) => updateRow(row.key, { reason: e.target.value, reasonError: "" })}
                />
                {row.reasonError && <p className="text-sm text-destructive">{row.reasonError}</p>}
                {isCheckoutRow(row) && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={isSubmitting || !row.checkOutTime || !row.reason.trim()}
                    onClick={() => handleSubmitCheckout(row)}
                  >
                    {isSubmitting ? "Đang gửi..." : "Gửi giải trình giờ ra"}
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={addRow} className="gap-1.5">
            <PlusIcon className="size-4" />
            Thêm ca cần giải trình
          </Button>
          <Button type="button" disabled={!hasSubmittable || isSubmitting} onClick={handleSubmit}>
            {isSubmitting ? "Đang gửi..." : "Gửi giải trình"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
