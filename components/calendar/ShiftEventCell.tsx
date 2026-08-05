import { ClockIcon, PartyPopperIcon, TimerIcon, CalendarOffIcon, SunriseIcon, SunsetIcon, StarIcon } from "lucide-react";
import type { EventProps } from "react-big-calendar";
import { resolveColor, type CalendarEvent } from "@/lib/calendar";

const LEAVE_ICON = {
  full_day: CalendarOffIcon,
  late_arrival: SunriseIcon,
  early_leave: SunsetIcon,
  hourly: ClockIcon,
};

export default function ShiftEventCell({ event }: EventProps<CalendarEvent>) {
  if (event.resource.kind === "holiday") {
    return (
      <div className="flex items-center gap-1.5 truncate">
        <PartyPopperIcon className="size-3 shrink-0" />
        <span className="truncate">{event.title}</span>
      </div>
    );
  }

  if (event.resource.kind === "attendance") {
    return (
      <div className="flex items-center gap-1.5 truncate">
        <TimerIcon className="size-3 shrink-0" />
        <span className="truncate">{event.title}</span>
      </div>
    );
  }

  if (event.resource.kind === "leave") {
    const Icon = LEAVE_ICON[event.resource.requestType];
    return (
      <div className="flex items-center gap-1.5 truncate">
        <Icon className="size-3 shrink-0" />
        <span className="truncate">{event.title}</span>
      </div>
    );
  }

  if (event.resource.kind === "custom") {
    return (
      <div className="flex items-center gap-1.5 truncate">
        <StarIcon className="size-3 shrink-0" />
        <span className="truncate">{event.title}</span>
      </div>
    );
  }

  const { isMine, pendingSwap, colorVar } = event.resource;

  return (
    <div className="flex items-center gap-1.5 truncate">
      {pendingSwap !== "none" && <ClockIcon className="size-3 shrink-0" />}
      {!isMine && (
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: resolveColor(colorVar) }}
        />
      )}
      <span className="truncate">{event.title}</span>
      {pendingSwap === "open" && <span className="shrink-0 text-[10px]">· cần người</span>}
    </div>
  );
}
