import {
  ClockIcon,
  PartyPopperIcon,
  TimerIcon,
  CalendarOffIcon,
  SunriseIcon,
  SunsetIcon,
  StarIcon,
  CalendarClockIcon,
  AlertCircleIcon,
} from "lucide-react";
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
    const { note } = event.resource;
    return (
      // The note stays on the SAME row as the name — a holiday banner is one
      // row tall in every view — rendered as a dimmed "· ghi chú" suffix so it
      // reads as secondary next to the holiday's name. Touch devices get no
      // hover, so a tooltip alone made the note invisible for most staff; the
      // full text still rides along in `title` for desktop hover.
      <div
        className="flex items-center gap-1.5 truncate"
        title={note ? `${event.title} — ${note}` : event.title}
      >
        <PartyPopperIcon className="size-3 shrink-0" />
        <span className="truncate">{event.title}</span>
        {note ? <span className="truncate text-[10px] opacity-80">· {note}</span> : null}
      </div>
    );
  }

  if (event.resource.kind === "attendance") {
    return (
      <div className="flex items-center gap-1.5 truncate">
        <TimerIcon className="size-3 shrink-0" />
        <span className="truncate">{event.title}</span>
        {event.resource.hasPendingCorrection && (
          <AlertCircleIcon className="size-3 shrink-0" aria-label="Có đơn giải trình đang chờ duyệt">
            <title>Có đơn giải trình đang chờ duyệt</title>
          </AlertCircleIcon>
        )}
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

  if (event.resource.kind === "shift_request_pending") {
    const branchName = event.resource.request.branch?.name;
    return (
      <div className="flex flex-col truncate">
        <div className="flex items-center gap-1.5 truncate">
          <CalendarClockIcon className="size-3 shrink-0" />
          <span className="truncate">{event.title}</span>
        </div>
        {branchName && <span className="truncate pl-[18px] text-[10px] opacity-80">{branchName}</span>}
      </div>
    );
  }

  if (event.resource.kind === "attendance_correction_pending") {
    return (
      <div className="flex items-center gap-1.5 truncate">
        <CalendarClockIcon className="size-3 shrink-0" />
        <span className="truncate">{event.title}</span>
      </div>
    );
  }

  const { isMine, pendingSwap, colorVar, branchName, shift } = event.resource;

  return (
    <div className="flex flex-col truncate">
      <div className="flex items-center gap-1.5 truncate">
        {pendingSwap !== "none" && <ClockIcon className="size-3 shrink-0" />}
        {!isMine && (
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: resolveColor(colorVar) }}
          />
        )}
        <span className="truncate">
          {event.title} - {branchName}
        </span>
        {pendingSwap === "open" && <span className="shrink-0 text-[10px]">· cần người</span>}
      </div>
      {shift.note && (
        <span className="truncate pl-[18px] text-[10px] opacity-80">Ghi chú: {shift.note}</span>
      )}
    </div>
  );
}
