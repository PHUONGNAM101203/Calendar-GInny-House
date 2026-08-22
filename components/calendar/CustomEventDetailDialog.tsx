"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { Trash2Icon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { deleteCustomEventAction } from "@/actions/custom-calendars";
import { resolveColor, type CustomCalendarEvent } from "@/lib/calendar";

export default function CustomEventDetailDialog({
  open,
  onOpenChange,
  event,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: CustomCalendarEvent;
}) {
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    setPending(true);
    const result = await deleteCustomEventAction(event.resource.eventId);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Đã xoá sự kiện");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span
              className="size-3.5 shrink-0 rounded-[4px]"
              style={{ backgroundColor: resolveColor(event.resource.colorVar) }}
            />
            <div>
              <DialogTitle>{event.title}</DialogTitle>
              <DialogDescription>{event.resource.calendarName}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {event.allDay
            ? format(event.start, "EEEE dd/MM/yyyy", { locale: vi })
            : `${format(event.start, "EEEE dd/MM/yyyy", { locale: vi })} · ${format(event.start, "HH:mm")} – ${format(event.end, "HH:mm")}`}
        </p>

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={handleDelete} className="gap-2">
            <Trash2Icon className="size-4" />
            Xoá sự kiện
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
