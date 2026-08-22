import { isSameDay } from "date-fns";
import { cn } from "@/lib/utils";
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
// Today's number sits in a filled primary disc, the same treatment
// MobileDayStrip already gives the selected day ("bg-primary
// text-primary-foreground" on a size-8 rounded-full span) — desktop was the
// only surface still missing it. Deliberately reuses that exact size-8
// circle, which this header already rendered as an invisible wrapper, so
// filling it in costs zero extra height and leaves the 56px
// .rbc-time-header .rbc-header min-height and the column widths untouched.
// The .rbc-current-time-indicator line stays as the finer-grained "now"
// marker; this is the day-level one.
//
// Safe to read the wall clock during render: the whole calendar is loaded
// via next/dynamic({ ssr: false }) (see ShiftCalendarLoader), so there is no
// server pass to mismatch on hydration.
export default function CalendarDayHeader({ date }: HeaderProps) {
  const isToday = isSameDay(date, new Date());
  return (
    <div className="flex w-full flex-col items-center gap-1 py-1.5">
      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {WEEKDAY_LABEL[date.getDay()]}
      </span>
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-full font-heading text-lg font-semibold",
          isToday && "bg-primary text-primary-foreground"
        )}
      >
        {date.getDate()}
      </span>
    </div>
  );
}
