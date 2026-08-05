"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Calendar, type SlotInfo, type View } from "react-big-calendar";
import {
  localizer,
  calendarMessages,
  calendarFormats,
  toCalendarEvents,
  toHolidayEvents,
  toAttendanceEvents,
  toLeaveEvents,
  toCustomEvents,
  getEventTextColorVar,
  getPersonColorVar,
  resolveColor,
  getVisibleRange,
  isShiftEvent,
  isAttendanceEvent,
  isLeaveEvent,
  isCustomEvent,
  type ShiftEvent,
  type AttendanceCalendarEvent,
  type LeaveCalendarEvent,
  type CustomCalendarEvent,
  type CalendarEvent,
} from "@/lib/calendar";
import { VIETNAM_HOLIDAYS } from "@/lib/holidays";
import { useCalendarNav } from "@/hooks/use-calendar-nav";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { CALENDAR_MAX_HOUR, CALENDAR_MIN_HOUR } from "@/lib/constants";
import { cn } from "@/lib/utils";
import CalendarToolbar from "@/components/calendar/CalendarToolbar";
import MobileDayStrip from "@/components/calendar/MobileDayStrip";
import { CalendarSidebar, CalendarMobileMenu } from "@/components/calendar/CalendarSidebar";
import RealtimeClock from "@/components/layout/RealtimeClock";
import ShiftEventCell from "@/components/calendar/ShiftEventCell";
import CalendarDayHeader from "@/components/calendar/CalendarDayHeader";
import ShiftFormDialog from "@/components/shifts/ShiftFormDialog";
import ShiftDetailDialog from "@/components/shifts/ShiftDetailDialog";
import AttendanceDetailDialog from "@/components/calendar/AttendanceDetailDialog";
import LeaveDetailDialog from "@/components/calendar/LeaveDetailDialog";
import CustomEventDetailDialog from "@/components/calendar/CustomEventDetailDialog";
import type {
  AttendanceWithProfile,
  Branch,
  CustomCalendar,
  CustomEvent,
  LeaveRequestDetailed,
  Profile,
  ShiftWithAssignee,
  SwapRequest,
} from "@/types";

const minTime = new Date();
minTime.setHours(CALENDAR_MIN_HOUR, 0, 0, 0);
const maxTime = new Date();
maxTime.setHours(CALENDAR_MAX_HOUR, 0, 0, 0);

export default function ShiftCalendar({
  shifts,
  pendingSwaps,
  attendance,
  leaveRequests,
  branches,
  customCalendars,
  customEvents,
  currentUserId,
  currentUserName,
  canManageShifts,
  branchMembers,
  canFollowAll,
  followedIds,
  followColors,
  branchColors,
}: {
  shifts: ShiftWithAssignee[];
  pendingSwaps: SwapRequest[];
  attendance: AttendanceWithProfile[];
  leaveRequests: LeaveRequestDetailed[];
  branches: Branch[];
  customCalendars: CustomCalendar[];
  customEvents: CustomEvent[];
  currentUserId: string;
  currentUserName: string;
  canManageShifts: boolean;
  branchMembers: Pick<Profile, "id" | "full_name">[];
  canFollowAll: boolean;
  followedIds: string[];
  followColors: Record<string, string>;
  branchColors: Record<string, string>;
}) {
  const { date, view, navigate, isPending } = useCalendarNav();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();

  // Squeezing the default 7-column week grid onto a phone screen is what
  // the user flagged as illegible — default to the single-day view there
  // instead, same pattern Google Calendar's mobile app uses. Only kicks in
  // when the URL doesn't already carry an explicit ?view= (so it never
  // fights a navigation the user just made, e.g. switching back to week).
  useEffect(() => {
    if (isMobile && !searchParams.has("view")) {
      navigate(date, "day");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  const [showHolidays, setShowHolidays] = useState(true);
  const [hiddenCustomCalendarIds, setHiddenCustomCalendarIds] = useState<Set<string>>(new Set());
  // "Remote" is a separate key alongside real branch ids — a remote shift
  // is filtered purely by the Remote toggle, not also by its own branch_id
  // (every shift still carries a real branch_id per the shift-type design,
  // but the sidebar treats CS1/CS2/CS3/Remote as 4 sibling categories).
  const [hiddenBranchKeys, setHiddenBranchKeys] = useState<Set<string>>(new Set());
  const [eventToggles, setEventToggles] = useState({
    showAttendance: true,
    showLeave: true,
    showLateArrival: true,
    showSwapIndicator: true,
  });

  // The color a viewer sees for someone else's calendar is personal (see
  // ColorMenu in CalendarSidebar) — this resolves id -> the right var for
  // *this* viewer, falling back to that person's own profile color, then
  // the deterministic hash default.
  const colorFor = useMemo(() => {
    const profileColors = new Map<string, string | null>();
    for (const s of shifts) profileColors.set(s.assignee_id, s.assignee.color);
    return (profileId: string) =>
      getPersonColorVar(profileId, followColors[profileId] ?? profileColors.get(profileId) ?? null);
  }, [shifts, followColors]);

  const branchNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of branches) map.set(b.id, b.name);
    return map;
  }, [branches]);

  // Unticking someone in "Toàn hệ thống" (unfollow) has to actually hide
  // their shifts/chấm công/nghỉ phép from the grid, not just stop tracking
  // a follow-color for them — this is the filter that was missing before.
  // Only applies when this viewer even has the "see everyone, follow to
  // pin" model (canFollowAll); everyone else's events are already scoped
  // to their own branch by RLS, so there's nothing to filter client-side.
  const visiblePersonIds = useMemo(
    () => (canFollowAll ? new Set([currentUserId, ...followedIds]) : null),
    [canFollowAll, currentUserId, followedIds]
  );
  const visibleShifts = useMemo(
    () =>
      shifts
        .filter((s) => !visiblePersonIds || visiblePersonIds.has(s.assignee_id))
        .filter((s) => !hiddenBranchKeys.has(s.shift_type === "remote" ? "remote" : s.branch_id)),
    [shifts, visiblePersonIds, hiddenBranchKeys]
  );
  const visibleAttendance = useMemo(
    () => (visiblePersonIds ? attendance.filter((a) => visiblePersonIds.has(a.profile_id)) : attendance),
    [attendance, visiblePersonIds]
  );
  const visibleLeaveRequests = useMemo(
    () => (visiblePersonIds ? leaveRequests.filter((r) => visiblePersonIds.has(r.profile_id)) : leaveRequests),
    [leaveRequests, visiblePersonIds]
  );

  const shiftEvents = useMemo(
    () => toCalendarEvents(visibleShifts, currentUserId, pendingSwaps, colorFor),
    [visibleShifts, currentUserId, pendingSwaps, colorFor]
  );
  const holidayEvents = useMemo(() => {
    if (!showHolidays) return [];
    const { start, end } = getVisibleRange(date, view);
    return toHolidayEvents(VIETNAM_HOLIDAYS, start, end);
  }, [date, view, showHolidays]);
  const attendanceEvents = useMemo(
    () => (eventToggles.showAttendance ? toAttendanceEvents(visibleAttendance, branchNames, colorFor) : []),
    [visibleAttendance, branchNames, colorFor, eventToggles.showAttendance]
  );
  const leaveEvents = useMemo(
    () => (eventToggles.showLeave ? toLeaveEvents(visibleLeaveRequests, false, colorFor) : []),
    [visibleLeaveRequests, colorFor, eventToggles.showLeave]
  );
  const lateArrivalEvents = useMemo(
    () => (eventToggles.showLateArrival ? toLeaveEvents(visibleLeaveRequests, true, colorFor) : []),
    [visibleLeaveRequests, colorFor, eventToggles.showLateArrival]
  );
  const visibleCustomCalendars = useMemo(
    () => customCalendars.filter((c) => !hiddenCustomCalendarIds.has(c.id)),
    [customCalendars, hiddenCustomCalendarIds]
  );
  const customCalendarEvents = useMemo(
    () => toCustomEvents(customEvents, visibleCustomCalendars),
    [customEvents, visibleCustomCalendars]
  );
  const events = useMemo(
    () => [
      ...holidayEvents,
      ...attendanceEvents,
      ...leaveEvents,
      ...lateArrivalEvents,
      ...customCalendarEvents,
      ...shiftEvents,
    ],
    [holidayEvents, attendanceEvents, leaveEvents, lateArrivalEvents, customCalendarEvents, shiftEvents]
  );

  const [formState, setFormState] = useState<{
    open: boolean;
    shift: ShiftWithAssignee | null;
    range: { start: Date; end: Date } | null;
  }>({ open: false, shift: null, range: null });

  const [detailEvent, setDetailEvent] = useState<ShiftEvent | null>(null);
  const [attendanceDetail, setAttendanceDetail] = useState<AttendanceCalendarEvent | null>(null);
  const [leaveDetail, setLeaveDetail] = useState<LeaveCalendarEvent | null>(null);
  const [customDetail, setCustomDetail] = useState<CustomCalendarEvent | null>(null);

  // Double-clicking any day cell (month/week/day view alike) drills into
  // that day's own day view — independent of role, so it works the same
  // whether or not the viewer can create shifts. A single click keeps its
  // existing meaning (open the create-shift dialog for managers, nothing
  // for everyone else).
  function handleSelectSlot(slotInfo: SlotInfo) {
    if (slotInfo.action === "doubleClick") {
      navigate(slotInfo.start, "day");
      return;
    }
    if (!canManageShifts) return;
    setFormState({ open: true, shift: null, range: { start: slotInfo.start, end: slotInfo.end } });
  }

  function handleSelectEvent(event: CalendarEvent) {
    if (isAttendanceEvent(event)) {
      setAttendanceDetail(event);
      return;
    }
    if (isLeaveEvent(event)) {
      setLeaveDetail(event);
      return;
    }
    if (isCustomEvent(event)) {
      setCustomDetail(event);
      return;
    }
    if (!isShiftEvent(event)) return;
    if (canManageShifts) {
      setFormState({ open: true, shift: event.resource.shift, range: null });
    } else {
      setDetailEvent(event);
    }
  }

  const otherShifts = useMemo(
    () =>
      shifts.filter(
        (s) => s.assignee_id !== currentUserId && new Date(s.start_at) > new Date()
      ),
    [shifts, currentUserId]
  );

  const coworkers = useMemo(() => {
    const byId = new Map<string, string>();
    for (const s of shifts) {
      if (s.assignee_id !== currentUserId) byId.set(s.assignee_id, s.assignee.full_name);
    }
    const followedSet = new Set(followedIds);
    return Array.from(byId, ([id, name]) => ({
      id,
      name,
      color: followColors[id] ?? null,
      followed: followedSet.has(id),
    }))
      .sort((a, b) => a.name.localeCompare(b.name, "vi"))
      .sort((a, b) => Number(b.followed) - Number(a.followed));
  }, [shifts, currentUserId, followedIds, followColors]);

  function handleQuickCreate() {
    const start = new Date();
    start.setHours(CALENDAR_MIN_HOUR + 3, 0, 0, 0);
    const end = new Date(start);
    end.setHours(start.getHours() + 2);
    setFormState({ open: true, shift: null, range: { start, end } });
  }

  const sidebarProps = {
    canManageShifts,
    date,
    onPickDate: (d: Date) => navigate(d),
    onOpenDay: (d: Date) => navigate(d, "day"),
    onCreate: handleQuickCreate,
    people: coworkers,
    canFollowAll,
    currentUserName,
    showHolidays,
    onToggleHolidays: setShowHolidays,
    eventToggles,
    onEventTogglesChange: setEventToggles,
    customCalendars,
    hiddenCustomCalendarIds,
    onToggleCustomCalendar: (calendarId: string, visible: boolean) =>
      setHiddenCustomCalendarIds((prev) => {
        const next = new Set(prev);
        if (visible) next.delete(calendarId);
        else next.add(calendarId);
        return next;
      }),
    branches,
    hiddenBranchKeys,
    onToggleBranch: (key: string, visible: boolean) =>
      setHiddenBranchKeys((prev) => {
        const next = new Set(prev);
        if (visible) next.delete(key);
        else next.add(key);
        return next;
      }),
    branchColors,
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      <CalendarSidebar {...sidebarProps} />

      <div className="flex flex-1 flex-col overflow-hidden p-4 sm:p-6">
        <div className="mb-2 flex items-center justify-between gap-2 lg:hidden">
          <CalendarMobileMenu {...sidebarProps} />
          <RealtimeClock className="flex" />
        </div>

        <Calendar
          localizer={localizer}
          events={events}
          date={date}
          view={view as View}
          onNavigate={(newDate) => navigate(newDate)}
          onView={(newView) => navigate(date, newView as typeof view)}
          onDrillDown={(d) => navigate(d, "day")}
          views={["month", "week", "day", "agenda"]}
          step={30}
          timeslots={2}
          min={minTime}
          max={maxTime}
          culture="vi"
          messages={calendarMessages}
          formats={calendarFormats}
          selectable
          onSelectSlot={handleSelectSlot}
          onSelectEvent={handleSelectEvent}
          eventPropGetter={(event) => {
            if (event.resource.kind === "holiday") {
              return { className: "shift-event shift-event--holiday" };
            }
            if (event.resource.kind === "attendance") {
              return {
                className: "shift-event shift-event--attendance",
                style: { "--event-color": resolveColor(event.resource.colorVar) } as React.CSSProperties,
              };
            }
            if (event.resource.kind === "leave") {
              return {
                className: "shift-event shift-event--leave",
                style: { "--event-color": resolveColor(event.resource.colorVar) } as React.CSSProperties,
              };
            }
            if (event.resource.kind === "custom") {
              return {
                className: "shift-event shift-event--custom",
                style: { "--event-color": resolveColor(event.resource.colorVar) } as React.CSSProperties,
              };
            }

            const { isMine, pendingSwap, colorVar } = event.resource;
            const showPending = pendingSwap !== "none" && eventToggles.showSwapIndicator;
            return {
              className: [
                "shift-event",
                isMine ? "shift-event--mine" : "shift-event--other",
                showPending ? "shift-event--pending" : "",
              ]
                .filter(Boolean)
                .join(" "),
              style: isMine
                ? undefined
                : ({
                    "--event-color": resolveColor(colorVar),
                    "--event-text": getEventTextColorVar(colorVar),
                  } as React.CSSProperties),
            };
          }}
          components={{
            event: ShiftEventCell,
            toolbar: isMobile ? MobileDayStrip : CalendarToolbar,
            week: { header: CalendarDayHeader },
            day: { header: CalendarDayHeader },
          }}
          // Picking a new date/view starts a transition (see
          // useCalendarNav); dimming the grid instead of freezing it is
          // what makes "nhảy nhanh" (jumping to a date) read as instant —
          // the mini-month's selected day already updates optimistically,
          // this just signals the main grid is catching up.
          className={cn("flex-1 transition-opacity", isPending && "opacity-60")}
        />

        {canManageShifts && (
          <ShiftFormDialog
            open={formState.open}
            onOpenChange={(open) => setFormState((s) => ({ ...s, open }))}
            branchMembers={branchMembers}
            shift={formState.shift}
            initialRange={formState.range}
          />
        )}

        {!canManageShifts && detailEvent && (
          <ShiftDetailDialog
            open={Boolean(detailEvent)}
            onOpenChange={(open) => !open && setDetailEvent(null)}
            event={detailEvent}
            otherShifts={otherShifts}
          />
        )}

        {attendanceDetail && (
          <AttendanceDetailDialog
            open={Boolean(attendanceDetail)}
            onOpenChange={(open) => !open && setAttendanceDetail(null)}
            event={attendanceDetail}
          />
        )}

        {leaveDetail && (
          <LeaveDetailDialog
            open={Boolean(leaveDetail)}
            onOpenChange={(open) => !open && setLeaveDetail(null)}
            event={leaveDetail}
          />
        )}

        {customDetail && (
          <CustomEventDetailDialog
            open={Boolean(customDetail)}
            onOpenChange={(open) => !open && setCustomDetail(null)}
            event={customDetail}
          />
        )}
      </div>
    </div>
  );
}
