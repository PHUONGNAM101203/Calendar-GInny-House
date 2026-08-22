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

export function describeSeriesRange(series: Pick<ShiftSeries, "starts_on" | "ends_on">): string {
  const from = formatSeriesDate(series.starts_on);
  // ends_on null is Đợt 2's "không kết thúc" — the column already allows it,
  // so the formatter handles it rather than crashing once that ships.
  return series.ends_on ? `${from} – ${formatSeriesDate(series.ends_on)}` : `Từ ${from}`;
}
