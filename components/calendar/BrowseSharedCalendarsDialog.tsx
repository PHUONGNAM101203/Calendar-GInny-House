"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { CheckIcon, PlusIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { resolveColor } from "@/lib/calendar";
import {
  subscribeCustomCalendarAction,
  unsubscribeCustomCalendarAction,
} from "@/actions/custom-calendars";
import type { SharedCustomCalendar } from "@/types";

// "Lịch khác" → "+" → "Duyệt lịch có sẵn trong công ty". Lists every custom
// calendar a colleague has opted into sharing (list_shared_custom_calendars,
// 0081) so the viewer can subscribe and paint it onto their own grid.
export default function BrowseSharedCalendarsDialog({
  open,
  onOpenChange,
  calendars,
  currentUserId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calendars: SharedCustomCalendar[];
  currentUserId: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Lịch có sẵn trong công ty</DialogTitle>
          <DialogDescription>
            Đăng ký để hiển thị lịch của đồng nghiệp trên lịch của bạn. Bạn chỉ xem được, không
            chỉnh sửa được sự kiện của họ.
          </DialogDescription>
        </DialogHeader>

        {calendars.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Chưa có ai chia sẻ lịch nào.
          </p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {calendars.map((calendar) => (
              <SharedCalendarRow
                key={calendar.id}
                calendar={calendar}
                isOwn={calendar.owner_id === currentUserId}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SharedCalendarRow({
  calendar,
  isOwn,
}: {
  calendar: SharedCustomCalendar;
  isOwn: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    startTransition(async () => {
      const result = calendar.is_subscribed
        ? await unsubscribeCustomCalendarAction(calendar.id)
        : await subscribeCustomCalendarAction(calendar.id);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(calendar.is_subscribed ? "Đã bỏ đăng ký lịch" : "Đã thêm lịch vào Lịch khác");
    });
  }

  return (
    <li className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/50">
      <span
        className="size-3.5 shrink-0 rounded-[4px]"
        style={{ backgroundColor: resolveColor(calendar.color) }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{calendar.name}</p>
        <p className="truncate text-xs text-muted-foreground">{calendar.owner_name}</p>
      </div>

      {isOwn ? (
        <span className="shrink-0 text-xs text-muted-foreground">Lịch của bạn</span>
      ) : (
        <Button
          size="sm"
          variant={calendar.is_subscribed ? "outline" : "default"}
          className="h-7 shrink-0 gap-1.5 text-xs"
          disabled={isPending}
          onClick={handleToggle}
        >
          {calendar.is_subscribed ? (
            <>
              <CheckIcon className="size-3.5" />
              Đã đăng ký
            </>
          ) : (
            <>
              <PlusIcon className="size-3.5" />
              Đăng ký
            </>
          )}
        </Button>
      )}
    </li>
  );
}
