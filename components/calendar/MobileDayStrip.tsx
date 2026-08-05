"use client";

import { addDays, addWeeks, subWeeks, startOfWeek, isSameDay, format } from "date-fns";
import { vi } from "date-fns/locale";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ToolbarProps } from "react-big-calendar";
import type { ShiftEvent } from "@/lib/calendar";

const WEEKDAY_LABELS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const VIEW_LABELS: Record<string, string> = {
  month: "Tháng",
  week: "Tuần",
  day: "Ngày",
  agenda: "Lịch biểu",
};

// Replaces CalendarToolbar on phone-width screens (see ShiftCalendar.tsx's
// isMobile branch): a tappable 7-day strip for the current week instead of
// a bare "‹ label ›" nav — picking a day always jumps straight to that date
// via the "DATE" navigate action, independent of whatever view is active,
// so it behaves the same whether the grid below is showing day/week/month.
// The view-switcher pills are kept (smaller) underneath so mobile doesn't
// lose the ability to jump to Tháng/Lịch biểu entirely.
export default function MobileDayStrip({ date, view, views, onNavigate, onView }: ToolbarProps<ShiftEvent>) {
  const viewNames = Array.isArray(views) ? views : Object.keys(views ?? {});
  const weekStart = startOfWeek(date, { locale: vi });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div className="mb-3">
      <div className="mb-2 flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          onClick={() => onNavigate("DATE", subWeeks(date, 1))}
          aria-label="Tuần trước"
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        <span className="font-heading text-base font-semibold capitalize">
          {format(date, "MMMM yyyy", { locale: vi })}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          onClick={() => onNavigate("DATE", addWeeks(date, 1))}
          aria-label="Tuần sau"
        >
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>

      <div className="mb-3 grid grid-cols-7 gap-1 text-center">
        {days.map((day) => {
          const selected = isSameDay(day, date);
          const isToday = isSameDay(day, new Date());
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onNavigate("DATE", day)}
              aria-pressed={selected}
              className="flex flex-col items-center gap-1"
            >
              <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                {WEEKDAY_LABELS[day.getDay()]}
              </span>
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-full text-sm font-medium transition-colors",
                  !selected && isToday && "font-semibold text-primary",
                  selected && "bg-primary font-semibold text-primary-foreground"
                )}
              >
                {format(day, "d")}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-0.5 rounded-full bg-muted p-0.5">
        {viewNames.map((name) => (
          <Button
            key={name}
            size="sm"
            variant={view === name ? "default" : "ghost"}
            className="flex-1 rounded-full text-xs"
            onClick={() => onView(name as typeof view)}
          >
            {VIEW_LABELS[name] ?? name}
          </Button>
        ))}
      </div>
    </div>
  );
}
