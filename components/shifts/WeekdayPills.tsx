"use client";

import { cn } from "@/lib/utils";
import { WEEKDAY_DISPLAY_ORDER, WEEKDAY_LABELS } from "@/lib/shift-series";

// Pill toggles, not checkboxes — the owner asked for these by name, and a row
// of seven two-character targets reads as one control ("những thứ nào") where
// seven labelled checkboxes read as seven questions. Monday-first, Chủ Nhật
// last, matching how the week is written in Vietnamese.
export default function WeekdayPills({
  value,
  onChange,
  disabled,
}: {
  value: number[];
  onChange: (value: number[]) => void;
  disabled?: boolean;
}) {
  function toggle(day: number) {
    onChange(
      value.includes(day)
        ? value.filter((selected) => selected !== day)
        : [...value, day].sort((a, b) => a - b)
    );
  }

  return (
    <div role="group" aria-label="Ngày trong tuần" className="flex flex-wrap gap-2">
      {WEEKDAY_DISPLAY_ORDER.map((day) => {
        const active = value.includes(day);
        return (
          <button
            key={day}
            type="button"
            // aria-pressed, not aria-checked: these are toggle buttons in a
            // group, not a checkbox set, and screen readers announce the state
            // correctly only if the role and the attribute agree.
            aria-pressed={active}
            disabled={disabled}
            onClick={() => toggle(day)}
            className={cn(
              "h-10 min-w-11 rounded-full border px-3 text-sm font-medium transition-colors",
              "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
              active
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-input bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
              disabled && "pointer-events-none opacity-50"
            )}
          >
            {WEEKDAY_LABELS[day]}
          </button>
        );
      })}
    </div>
  );
}
