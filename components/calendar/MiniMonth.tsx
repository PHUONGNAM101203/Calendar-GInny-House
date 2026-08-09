"use client";

import { useState } from "react";
import {
  addMonths,
  subMonths,
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
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(cursor), { locale: vi }),
    end: endOfWeek(endOfMonth(cursor), { locale: vi }),
  });

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium capitalize">
          {format(cursor, "MMMM yyyy", { locale: vi })}
        </span>
        <div className="flex gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setCursor((c) => subMonths(c, 1))}
            aria-label="Tháng trước"
          >
            <ChevronLeftIcon className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setCursor((c) => addMonths(c, 1))}
            aria-label="Tháng sau"
          >
            <ChevronRightIcon className="size-3.5" />
          </Button>
        </div>
      </div>
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
    </div>
  );
}
