"use client";

import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { MapPinIcon, TimerIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { resolveColor, type AttendanceCalendarEvent } from "@/lib/calendar";

function formatMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  if (hours <= 0) return `${mins} phút`;
  return mins > 0 ? `${hours} giờ ${mins} phút` : `${hours} giờ`;
}

export default function AttendanceDetailDialog({
  open,
  onOpenChange,
  event,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: AttendanceCalendarEvent;
}) {
  const { profileName, colorVar, totalMinutes, isOpen, sessions } = event.resource;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: resolveColor(colorVar) }}
            >
              <TimerIcon className="size-4 text-white" />
            </span>
            <div>
              <DialogTitle>{profileName}</DialogTitle>
              <DialogDescription>
                {format(event.start, "EEEE dd/MM/yyyy", { locale: vi })}
              </DialogDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <p className="font-heading text-lg font-semibold tabular-nums">
              Tổng {formatMinutes(totalMinutes)}
            </p>
            {isOpen && (
              <Badge variant="success" className="animate-pulse">
                Đang chấm công
              </Badge>
            )}
          </div>
        </DialogHeader>

        <ul className="space-y-2">
          {sessions.map((s, i) => (
            <li key={i} className="rounded-md border bg-muted/40 p-2.5 text-sm">
              <p className="font-medium tabular-nums">
                {format(new Date(s.checkInAt), "h:mm a")}
                <span className="mx-1.5 text-muted-foreground">–</span>
                {s.checkOutAt ? format(new Date(s.checkOutAt), "h:mm a") : "đang làm"}
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPinIcon className="size-3 shrink-0" />
                {s.branchName}
              </p>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
