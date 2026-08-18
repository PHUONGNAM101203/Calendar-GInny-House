"use client";

import { useState } from "react";
import { format, intervalToDuration } from "date-fns";
import { vi } from "date-fns/locale";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Attendance } from "@/types";

// Same "show a few, then Xem thêm" treatment as CollapsibleGrid
// (components/manager/CollapsibleGrid.tsx), reimplemented here rather than
// reused: that component wraps each visible child in its own <div>, which
// isn't valid markup inside a <tbody> — a <table> needs the rows sliced
// directly instead.
const INITIAL_ROWS = 2;

function formatDuration(from: Date, to: Date) {
  const d = intervalToDuration({ start: from, end: to });
  const h = d.hours ?? 0;
  const m = d.minutes ?? 0;
  return `${h}g ${String(m).padStart(2, "0")}p`;
}

export default function AttendanceHistory({ records }: { records: Attendance[] }) {
  const [expanded, setExpanded] = useState(false);

  if (records.length === 0) {
    return <p className="text-sm text-muted-foreground">Chưa có lịch sử chấm công nào.</p>;
  }

  const hidden = records.length - INITIAL_ROWS;
  const visible = expanded ? records : records.slice(0, INITIAL_ROWS);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Ngày</th>
              <th className="px-4 py-2 font-medium">Vào</th>
              <th className="px-4 py-2 font-medium">Ra</th>
              <th className="px-4 py-2 font-medium">Tổng giờ</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const checkIn = new Date(r.check_in_at);
              const checkOut = r.check_out_at ? new Date(r.check_out_at) : null;
              return (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-2">{format(checkIn, "EEEE dd/MM", { locale: vi })}</td>
                  <td className="px-4 py-2">{format(checkIn, "HH:mm")}</td>
                  <td className="px-4 py-2">
                    {checkOut ? format(checkOut, "HH:mm") : <span className="text-primary">Đang trong ca</span>}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {checkOut ? formatDuration(checkIn, checkOut) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {expanded ? "Thu gọn" : `Xem thêm ${hidden} dòng`}
          <ChevronDownIcon
            className={cn(
              "size-4 transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)] motion-reduce:transition-none",
              expanded && "rotate-180"
            )}
          />
        </button>
      )}
    </div>
  );
}
