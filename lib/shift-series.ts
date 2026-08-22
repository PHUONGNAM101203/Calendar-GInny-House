import type { ShiftSeries } from "@/types";

// 0 = Chủ nhật … 6 = Thứ Bảy — the index Postgres's extract(dow) and JS's
// getDay() both use, and the one stored in shift_series.weekdays. The labels
// are the short forms Vietnamese calendars use.
export const WEEKDAY_LABELS: Record<number, string> = {
  0: "CN",
  1: "T2",
  2: "T3",
  3: "T4",
  4: "T5",
  5: "T6",
  6: "T7",
};

// Display order, not storage order: a Vietnamese week starts on Thứ Hai and
// ends on Chủ Nhật, so 0 sorts last here even though it sorts first in the
// array the database keeps.
export const WEEKDAY_DISPLAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

export function sortWeekdaysForDisplay(weekdays: readonly number[]): number[] {
  return WEEKDAY_DISPLAY_ORDER.filter((day) => weekdays.includes(day));
}

export function formatWeekdays(weekdays: readonly number[]): string {
  const sorted = sortWeekdaysForDisplay(weekdays);
  if (sorted.length === 7) return "Cả tuần";
  return sorted.map((day) => WEEKDAY_LABELS[day]).join(", ");
}

// "18:00:00" -> "18:00". Postgres hands back a `time` with seconds; the app
// never shows them, and the picker only ever produces whole minutes.
export function formatSeriesTime(time: string): string {
  return time.slice(0, 5);
}

// "T2, T4, T6 · 18:00–22:00" — the rule in one line, without the branch or the
// person, which the table shows in their own columns. Callers that want the
// full spec sentence append those themselves.
export function describeSeriesRule(
  series: Pick<ShiftSeries, "weekdays" | "interval_weeks" | "start_time" | "end_time">
): string {
  const window = `${formatSeriesTime(series.start_time)}–${formatSeriesTime(series.end_time)}`;
  const cadence = series.interval_weeks > 1 ? ` · mỗi ${series.interval_weeks} tuần` : "";
  return `${formatWeekdays(series.weekdays)} · ${window}${cadence}`;
}

// "01/09/2026". Formatted from the "yyyy-MM-dd" string by hand rather than
// through Date: `new Date("2026-09-01")` is parsed as UTC midnight and renders
// as the previous day in Vietnam's positive offset — the same trap documented
// in app/(app)/calendar/page.tsx.
export function formatSeriesDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

// An empty slot's window, e.g. "T2 07/09/2026 · 09:00–11:00". The zone is
// pinned rather than left to the runtime for the same reason as
// lib/notifications-emit.ts: this renders on the server too, and that process
// has no TZ of its own, so a late-evening slot would land on the wrong day.
const VN_SLOT_DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Ho_Chi_Minh",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const VN_SLOT_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
});

// en-GB gives "Mon, 07/09/2026"; the app writes weekdays as T2…CN, so the
// English name is swapped out rather than pulling in a second locale.
const WEEKDAY_FROM_EN: Record<string, string> = {
  Mon: "T2",
  Tue: "T3",
  Wed: "T4",
  Thu: "T5",
  Fri: "T6",
  Sat: "T7",
  Sun: "CN",
};

export function formatSlotWindow(startAt: string, endAt: string): string {
  const parts = VN_SLOT_DATE.formatToParts(new Date(startAt));
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const label = `${WEEKDAY_FROM_EN[weekday] ?? weekday} ${day}/${month}/${year}`;
  return `${label} · ${VN_SLOT_TIME.format(new Date(startAt))}–${VN_SLOT_TIME.format(new Date(endAt))}`;
}

export function describeSeriesRange(series: Pick<ShiftSeries, "starts_on" | "ends_on">): string {
  const from = formatSeriesDate(series.starts_on);
  // ends_on null is Đợt 2's "không kết thúc" — the column already allows it,
  // so the formatter handles it rather than crashing once that ships.
  return series.ends_on ? `${from} – ${formatSeriesDate(series.ends_on)}` : `Từ ${from}`;
}
