"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ClockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TIME_OPTIONS, normalizeTimeInput, timeToMinutes } from "@/lib/time-options";
import { cn } from "@/lib/utils";

// A typed time field with a dropdown of 15-minute marks beside it — type any
// minute (19:20, 19:47) or pick a common one from the list. Times display in
// 24-hour form, matching how every other surface in this app renders a time
// (shift cards, overview tables) and how the value is stored.
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
  const [draft, setDraft] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  const activeRef = useRef<HTMLButtonElement>(null);
  const touchStartY = useRef(0);

  // Resync when the value changes from outside (a dropdown pick, or the
  // parent form resetting) — typing is committed on blur, so this never
  // fights the user mid-entry. Adjusted during render rather than in a
  // useEffect (React's recommended pattern for mirroring a prop into local
  // state — see https://react.dev/learn/you-might-not-need-an-effect) so it
  // doesn't trip the react-hooks/set-state-in-effect lint rule.
  if (value !== prevValue) {
    setPrevValue(value);
    setDraft(value);
  }

  // The value may now be any minute, which usually isn't in the 15-minute
  // TIME_OPTIONS list — scroll to the closest entry rather than nothing.
  const nearestOption = useMemo(() => {
    const target = timeToMinutes(value);
    if (target === null) return TIME_OPTIONS[0];
    return TIME_OPTIONS.reduce((best, option) => {
      const bestDistance = Math.abs((timeToMinutes(best) ?? 0) - target);
      const optionDistance = Math.abs((timeToMinutes(option) ?? 0) - target);
      return optionDistance < bestDistance ? option : best;
    }, TIME_OPTIONS[0]);
  }, [value]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => activeRef.current?.scrollIntoView({ block: "center" }));
    }
  }, [open]);

  // Committed on blur/Enter rather than per keystroke: "1" and "19" are both
  // legitimate prefixes of "19:20", so normalizing mid-typing would fight the
  // user. Unreadable text snaps back to the last good value — never guess.
  function commitDraft() {
    const normalized = normalizeTimeInput(draft);
    if (!normalized) {
      setDraft(value);
      return;
    }
    setDraft(normalized);
    if (normalized !== value) onChange(normalized);
  }

  // This popover portals outside the parent Dialog's DOM subtree, so Radix's
  // modal scroll lock (react-remove-scroll) treats wheel/touch scrolling here
  // as happening "outside the dialog" and blocks it document-wide — only
  // dragging the scrollbar thumb survives that block. Scroll the list
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
      <div className="relative">
        <Input
          id={id}
          value={draft}
          inputMode="numeric"
          placeholder="19:20"
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft();
              e.currentTarget.blur();
            }
          }}
          className="h-11 pr-10 font-heading text-base tabular-nums"
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Chọn ${label.toLowerCase()} từ danh sách`}
              className="absolute top-1/2 right-1 size-9 -translate-y-1/2 text-muted-foreground"
            >
              <ClockIcon className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="max-h-64 w-32 overflow-y-auto p-1"
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
                    ref={t === nearestOption ? activeRef : undefined}
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
                    {t}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
