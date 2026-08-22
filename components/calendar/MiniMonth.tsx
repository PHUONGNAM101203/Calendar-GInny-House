"use client";

import { useState } from "react";
import {
  addMonths,
  subMonths,
  addYears,
  subYears,
  setMonth,
  setYear,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  format,
} from "date-fns";
import { vi } from "date-fns/locale";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Monday-first, matching startOfWeek/endOfWeek below — the vi locale's
// weekStartsOn is 1 (Monday), so the day grid itself is Monday-first. These
// labels used to be Sunday-first (CN, T2...T7), which put every date one
// column left of its real weekday (e.g. a Monday rendered under "CN").
const WEEKDAY_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

const MONTH_LABELS = Array.from({ length: 12 }, (_, index) => `Tháng ${index + 1}`);

// One screenful of years, and the step the arrows take in year mode. 12 keeps
// the same 3x4 shape as the month grid, so switching panes doesn't resize the
// popover under the pointer.
const YEARS_PER_PAGE = 12;
// Where the current year sits on that page. Offsetting by 6 rather than 0 puts
// it mid-grid, so the years either side of it are reachable without paging.
const YEAR_PAGE_OFFSET = 6;

type Mode = "day" | "month" | "year";

// The same month-grid used in the calendar sidebar — extracted so any date
// field elsewhere in the app (leave requests, etc.) can pop up the exact
// same calendar look instead of the browser's native date picker.
// onOpenDay is optional — only the main calendar sidebar wires it, to
// double-click straight into that day's day view; date-field usages (leave
// dialogs, etc.) just pick a date and have nothing to drill into.
export default function MiniMonth({
  date,
  onPick,
  onOpenDay,
}: {
  date: Date;
  onPick: (date: Date) => void;
  onOpenDay?: (date: Date) => void;
}) {
  const [cursor, setCursor] = useState(() => startOfMonth(date));
  // Which pane is showing. The month and year panes exist so a far-off date is
  // two clicks away instead of a dozen taps on the chevron — picking a start
  // date a year out used to mean 12 presses of "Tháng sau".
  const [mode, setMode] = useState<Mode>("day");

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(cursor), { locale: vi }),
    end: endOfWeek(endOfMonth(cursor), { locale: vi }),
  });

  const yearPageStart = cursor.getFullYear() - YEAR_PAGE_OFFSET;
  const years = Array.from({ length: YEARS_PER_PAGE }, (_, index) => yearPageStart + index);

  // The chevrons mean "previous/next" for whatever is on screen: a month in the
  // day pane, a year in the month pane, a whole page of years in the year pane.
  // Sharing one pair of buttons keeps the header from reflowing between panes.
  const step = (direction: -1 | 1) => {
    setCursor((current) => {
      if (mode === "day") return direction === 1 ? addMonths(current, 1) : subMonths(current, 1);
      if (mode === "month") return direction === 1 ? addYears(current, 1) : subYears(current, 1);
      return direction === 1
        ? addYears(current, YEARS_PER_PAGE)
        : subYears(current, YEARS_PER_PAGE);
    });
  };

  const stepLabel = mode === "day" ? "tháng" : mode === "month" ? "năm" : `${YEARS_PER_PAGE} năm`;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          {mode === "day" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-1.5 text-sm font-medium capitalize"
              onClick={() => setMode("month")}
              aria-label="Chọn tháng"
            >
              {format(cursor, "MMMM", { locale: vi })}
            </Button>
          )}
          {mode !== "year" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-1.5 text-sm font-medium tabular-nums"
              onClick={() => setMode("year")}
              aria-label="Chọn năm"
            >
              {format(cursor, "yyyy")}
            </Button>
          )}
          {mode === "year" && (
            <span className="px-1.5 text-sm font-medium tabular-nums">
              {yearPageStart} – {yearPageStart + YEARS_PER_PAGE - 1}
            </span>
          )}
        </div>
        <div className="flex gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => step(-1)}
            aria-label={`${stepLabel} trước`}
          >
            <ChevronLeftIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => step(1)}
            aria-label={`${stepLabel} sau`}
          >
            <ChevronRightIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      {mode === "day" && (
        <div className="grid grid-cols-7 gap-y-1 text-center text-[11px]">
          {WEEKDAY_LABELS.map((d) => (
            <span key={d} className="text-muted-foreground">
              {d}
            </span>
          ))}
          {days.map((day) => {
            const inMonth = isSameMonth(day, cursor);
            const selected = isSameDay(day, date);
            const isToday = isSameDay(day, new Date());
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => onPick(day)}
                onDoubleClick={() => onOpenDay?.(day)}
                className={cn(
                  "mx-auto flex size-7 items-center justify-center rounded-full text-xs transition-colors",
                  !inMonth && "text-muted-foreground/40",
                  inMonth && !selected && "text-foreground hover:bg-accent",
                  !selected && isToday && "font-semibold text-primary",
                  selected && "bg-primary font-semibold text-primary-foreground"
                )}
              >
                {format(day, "d")}
              </button>
            );
          })}
        </div>
      )}

      {mode === "month" && (
        <div className="grid grid-cols-3 gap-1.5">
          {MONTH_LABELS.map((monthLabel, index) => {
            // Selected against the value being edited, not the cursor — the
            // cursor is only where the user is browsing.
            const selected =
              date.getFullYear() === cursor.getFullYear() && date.getMonth() === index;
            return (
              <button
                key={monthLabel}
                type="button"
                // Straight back to the day pane, never onPick: choosing a month
                // is navigation, not an answer. Committing here would hand the
                // form a date the user never actually looked at.
                onClick={() => {
                  setCursor((current) => setMonth(current, index));
                  setMode("day");
                }}
                className={cn(
                  "flex h-8 items-center justify-center rounded-lg text-xs transition-colors",
                  selected
                    ? "bg-primary font-semibold text-primary-foreground"
                    : "text-foreground hover:bg-accent"
                )}
              >
                {monthLabel}
              </button>
            );
          })}
        </div>
      )}

      {mode === "year" && (
        <div className="grid grid-cols-3 gap-1.5">
          {years.map((year) => {
            const selected = date.getFullYear() === year;
            return (
              <button
                key={year}
                type="button"
                onClick={() => {
                  setCursor((current) => setYear(current, year));
                  setMode("day");
                }}
                className={cn(
                  "flex h-8 items-center justify-center rounded-lg text-xs tabular-nums transition-colors",
                  selected
                    ? "bg-primary font-semibold text-primary-foreground"
                    : "text-foreground hover:bg-accent"
                )}
              >
                {year}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
