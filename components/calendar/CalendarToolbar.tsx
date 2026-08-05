"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ToolbarProps } from "react-big-calendar";
import type { ShiftEvent } from "@/lib/calendar";

const VIEW_LABELS: Record<string, string> = {
  month: "Tháng",
  week: "Tuần",
  day: "Ngày",
  agenda: "Lịch biểu",
};

export default function CalendarToolbar({
  label,
  view,
  views,
  onNavigate,
  onView,
}: ToolbarProps<ShiftEvent>) {
  const viewNames = Array.isArray(views) ? views : Object.keys(views ?? {});

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => onNavigate("TODAY")}>
          Hôm nay
        </Button>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            onClick={() => onNavigate("PREV")}
            aria-label="Trước"
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            onClick={() => onNavigate("NEXT")}
            aria-label="Sau"
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <span className="font-heading text-lg font-semibold capitalize">{label}</span>
      </div>

      <div className="flex items-center gap-0.5 rounded-full bg-muted p-0.5">
        {viewNames.map((name) => (
          <Button
            key={name}
            size="sm"
            variant={view === name ? "default" : "ghost"}
            className="rounded-full"
            onClick={() => onView(name as typeof view)}
          >
            {VIEW_LABELS[name] ?? name}
          </Button>
        ))}
      </div>
    </div>
  );
}
