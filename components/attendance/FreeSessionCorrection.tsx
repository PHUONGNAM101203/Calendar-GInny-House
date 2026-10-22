"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TimerIcon } from "lucide-react";
import {
  listFreeSessionsAction,
  requestSessionCorrectionAction,
  type FreeSession,
} from "@/actions/attendance-corrections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TimePickerField } from "@/components/ui/time-picker-field";

// Giờ treo tường Việt Nam. Ghim múi giờ thay vì tin trình duyệt, cùng lý do với
// formatVn trong AttendanceCorrectionForm.
function formatVn(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

// Giải trình giờ ra cho phiên chấm công TỰ DO của trợ giảng — phiên không gắn ca
// nên luồng giải trình theo ca không thấy nó (xem 0093).
//
// Tự tải theo ngày và KHÔNG vẽ gì khi ngày đó không có phiên tự do, nên người
// không phải trợ giảng không thấy thay đổi nào. Đứng cạnh chứ không thay phần
// ca: một người vừa quản sinh vừa trợ giảng có thể có cả hai trong cùng một ngày.
export default function FreeSessionCorrection({ date }: { date: string }) {
  // Lưu kèm ngày đã tải để suy ra "đang tải" mà không cần setState đồng bộ
  // trong effect: loading <=> ngày đã tải khác ngày đang chọn.
  const [loaded, setLoaded] = useState<{ date: string; items: FreeSession[] } | null>(null);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    (async () => {
      const result = await listFreeSessionsAction({ date });
      if (cancelled) return;
      setLoaded({ date, items: result.ok ? result.data : [] });
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  if (!date || !loaded || loaded.date !== date || loaded.items.length === 0) return null;

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <TimerIcon className="size-4 text-muted-foreground" />
        Chấm công tự do (không theo ca)
      </p>
      {loaded.items.map((session) => (
        <SessionCard key={session.id} session={session} />
      ))}
    </div>
  );
}

function SessionCard({ session }: { session: FreeSession }) {
  // Mặc định giờ ra đang ghi nhận: trường hợp hay gặp là nhích vài phút hoặc sửa
  // một giờ ra quên bấm; phiên còn mở thì để trống, vì không có giá trị nào đúng
  // để điền sẵn.
  const [time, setTime] = useState(session.checkOutAt ? formatVn(session.checkOutAt) : "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(session.hasPending);

  async function submit() {
    setError("");
    setSubmitting(true);
    const result = await requestSessionCorrectionAction({
      attendance_id: session.id,
      check_out_time: time,
      reason,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.info("Đã gửi đơn giải trình giờ ra");
    setSent(true);
  }

  return (
    <div className="space-y-2 rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="font-medium tabular-nums">
            {formatVn(session.checkInAt)} –{" "}
            {session.checkOutAt ? formatVn(session.checkOutAt) : "đang mở"}
          </span>
          <span className="text-muted-foreground"> · {session.branchName}</span>
        </p>
        {sent && <Badge variant="gold">Chờ duyệt giải trình</Badge>}
      </div>

      {!sent && (
        <>
          <div className="max-w-44">
            <TimePickerField
              id={`free_session_time_${session.id}`}
              label="Giờ ra thực tế"
              value={time}
              onChange={(value) => {
                setTime(value);
                setError("");
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`free_session_reason_${session.id}`}>Lý do giải trình</Label>
            <Textarea
              id={`free_session_reason_${session.id}`}
              rows={2}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError("");
              }}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="button"
            size="sm"
            disabled={submitting || !time || !reason.trim()}
            onClick={submit}
          >
            {submitting ? "Đang gửi..." : "Gửi giải trình giờ ra"}
          </Button>
        </>
      )}
    </div>
  );
}
