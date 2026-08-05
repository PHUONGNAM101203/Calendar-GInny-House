"use client";

import Link from "next/link";
import { Grid3x3Icon, TimerIcon, CalendarOffIcon, RefreshCwIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

const APPS = [
  { href: "/attendance", label: "Chấm công", icon: TimerIcon },
  { href: "/leave", label: "Xin nghỉ phép", icon: CalendarOffIcon },
  { href: "/swaps", label: "Xin đổi ca", icon: RefreshCwIcon },
] as const;

export default function AppLauncher() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Mở ứng dụng khác">
          <Grid3x3Icon className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2 sm:w-64">
        {/* Stacks in one column on narrow screens — a multi-column grid
            reads as spreading sideways instead of dropping straight down,
            which is what looked off on mobile. Wider screens keep the
            3-across icon grid. */}
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
          {APPS.map((app) => (
            <Link
              key={app.href}
              href={app.href}
              className="flex flex-row items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent sm:flex-col sm:gap-1.5 sm:py-3 sm:text-center sm:text-xs"
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <app.icon className="size-4.5" />
              </span>
              {app.label}
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
