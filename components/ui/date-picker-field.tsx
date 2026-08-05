"use client";

import { useState } from "react";
import { format, parse, isValid } from "date-fns";
import { vi } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import MiniMonth from "@/components/calendar/MiniMonth";
import { cn } from "@/lib/utils";

const VALUE_FORMAT = "yyyy-MM-dd";

// A date field that pops up the same month-grid as the main calendar
// sidebar (see components/calendar/MiniMonth.tsx), instead of the
// browser's native date picker — so "chọn ngày" looks the same everywhere
// in the app, not just styled text around an OS widget.
export function DatePickerField({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const parsedDate = value ? parse(value, VALUE_FORMAT, new Date()) : null;
  const selectedDate = parsedDate && isValid(parsedDate) ? parsedDate : null;

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
            className={cn(
              "h-11 w-full justify-start gap-2 font-heading text-base font-normal tabular-nums",
              !selectedDate && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {selectedDate ? format(selectedDate, "EEEE dd/MM/yyyy", { locale: vi }) : "Chọn ngày"}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72">
          <MiniMonth
            date={selectedDate ?? new Date()}
            onPick={(day) => {
              onChange(format(day, VALUE_FORMAT));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
