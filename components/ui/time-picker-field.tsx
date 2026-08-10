"use client";

import { useEffect, useRef, useState } from "react";
import { format, parse } from "date-fns";
import { ClockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TIME_OPTIONS } from "@/lib/time-options";
import { cn } from "@/lib/utils";

function formatTimeLabel(value: string) {
  return format(parse(value, "HH:mm", new Date()), "h:mm a");
}

// A plain scrollable list of times (like Google Calendar's time field) —
// no ruler, no duration shortcuts, just pick a time. Pairs with
// DatePickerField for the day; see ShiftFormDialog for how the two combine.
export function TimePickerField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeRef = useRef<HTMLButtonElement>(null);
  const touchStartY = useRef(0);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => activeRef.current?.scrollIntoView({ block: "center" }));
    }
  }, [open]);

  // This popover portals outside the parent Dialog's DOM subtree, so Radix's
  // modal scroll lock (react-remove-scroll) treats wheel/touch scrolling
  // here as happening "outside the dialog" and blocks it document-wide —
  // only dragging the scrollbar thumb survives that block. Scroll the list
  // manually instead of relying on native wheel/touch scroll.
  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.currentTarget.scrollTop += e.deltaY;
  }

  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    touchStartY.current = e.touches[0].clientY;
  }

  function handleTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    const currentY = e.touches[0].clientY;
    e.currentTarget.scrollTop += touchStartY.current - currentY;
    touchStartY.current = currentY;
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            className="h-11 w-full justify-start gap-2 font-heading text-base font-normal tabular-nums"
          >
            <ClockIcon className="size-4 shrink-0 text-muted-foreground" />
            {formatTimeLabel(value)}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="max-h-64 w-40 overflow-y-auto p-1"
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
        >
          <div className="flex flex-col">
            {TIME_OPTIONS.map((t) => {
              const active = t === value;
              return (
                <button
                  key={t}
                  ref={active ? activeRef : undefined}
                  type="button"
                  onClick={() => {
                    onChange(t);
                    setOpen(false);
                  }}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-left text-sm tabular-nums transition-colors hover:bg-accent",
                    active && "bg-primary text-primary-foreground hover:bg-primary"
                  )}
                >
                  {formatTimeLabel(t)}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
