import { format, intervalToDuration } from "date-fns";
import { vi } from "date-fns/locale";
import type { Attendance } from "@/types";

function formatDuration(from: Date, to: Date) {
  const d = intervalToDuration({ start: from, end: to });
  const h = d.hours ?? 0;
  const m = d.minutes ?? 0;
  return `${h}g ${String(m).padStart(2, "0")}p`;
}

export default function AttendanceHistory({ records }: { records: Attendance[] }) {
  if (records.length === 0) {
    return <p className="text-sm text-muted-foreground">Chưa có lịch sử chấm công nào.</p>;
  }

  return (
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
          {records.map((r) => {
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
  );
}
