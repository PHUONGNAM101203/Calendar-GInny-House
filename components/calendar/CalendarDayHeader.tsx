import type { HeaderProps } from "react-big-calendar";

// Weekday abbreviation above, big date number below — the two-line header
// treatment the team asked for by reference (hallmark audit, 2026-08),
// replacing RBC's default single-line "27 Thứ 2" string.
const WEEKDAY_LABEL = ["CN", "THỨ 2", "THỨ 3", "THỨ 4", "THỨ 5", "THỨ 6", "THỨ 7"];

// Plain markup only — RBC already wraps this in its own <button> for the
// header-click-to-drill-down behavior (see ShiftCalendar's onDrillDown).
// Rendering a second <button> in here nested inside RBC's caused the
// "<button> cannot be a descendant of <button>" hydration error.
//
// No "today" badge here — the current-time indicator (see globals.css
// .rbc-current-time-indicator) is the only marker for today, like Google
// Calendar's red line + dot, not a colored date number.
export default function CalendarDayHeader({ date }: HeaderProps) {
  return (
    <div className="flex w-full flex-col items-center gap-1 py-1.5">
      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {WEEKDAY_LABEL[date.getDay()]}
      </span>
      <span className="flex size-8 items-center justify-center rounded-full font-heading text-lg font-semibold">
        {date.getDate()}
      </span>
    </div>
  );
}
