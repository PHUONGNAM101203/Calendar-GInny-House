import { dateFnsLocalizer, type Messages, type Formats } from "react-big-calendar";
import {
  format,
  parse,
  getDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfDay,
  endOfDay,
  addDays,
} from "date-fns";
import { vi } from "date-fns/locale";
import { LEAVE_REQUEST_TYPE_LABELS } from "@/lib/constants";
import type {
  AttendanceCorrectionDetailed,
  AttendanceWithProfile,
  CustomCalendar,
  CustomEvent,
  LeaveRequestDetailed,
  Profile,
  Role,
  ShiftRequestDetailed,
  ShiftWithAssignee,
  SwapRequest,
} from "@/types";
import type { Holiday } from "@/lib/holidays";

// Local widening of LeaveRequestDetailed's profile pick — the shared type
// only carries id/full_name (see types/index.ts), but the calendar's
// "Cần xét duyệt" gating needs the requester's role too. Follows the same
// local-widening convention already used in manager/page.tsx and leave/
// page.tsx rather than editing the shared type. Exported so page.tsx,
// ShiftCalendarLoader, and ShiftCalendar all thread the same shape instead
// of re-declaring the intersection three more times.
export type LeaveRequestWithRole = LeaveRequestDetailed & {
  profile: Pick<Profile, "id" | "full_name" | "role">;
};

// Same local-widening convention — AttendanceDetailDialog's edit/delete
// buttons (canManageAttendanceFor) need the target's role, which the base
// AttendanceWithProfile type doesn't carry.
export type AttendanceWithProfileRole = AttendanceWithProfile & {
  profile: Pick<Profile, "id" | "full_name" | "role">;
};

export type CalendarView = "month" | "week" | "day" | "agenda";

export function getVisibleRange(date: Date, view: CalendarView) {
  switch (view) {
    case "day":
      return { start: startOfDay(date), end: endOfDay(date) };
    case "week":
      return {
        start: startOfWeek(date, { locale: vi }),
        end: endOfWeek(date, { locale: vi }),
      };
    case "agenda":
      return { start: startOfDay(date), end: endOfDay(addDays(date, 29)) };
    case "month":
    default:
      return {
        start: startOfWeek(startOfMonth(date), { locale: vi }),
        end: endOfWeek(endOfMonth(date), { locale: vi }),
      };
  }
}

export const localizer = dateFnsLocalizer({
  format,
  startOfWeek,
  getDay,
  locales: { vi },
});

export const calendarMessages: Messages = {
  date: "Ngày",
  time: "Giờ",
  event: "Ca",
  allDay: "Cả ngày",
  week: "Tuần",
  work_week: "Tuần làm việc",
  day: "Ngày",
  month: "Tháng",
  previous: "Trước",
  next: "Sau",
  yesterday: "Hôm qua",
  tomorrow: "Ngày mai",
  today: "Hôm nay",
  agenda: "Lịch biểu",
  noEventsInRange: "Không có ca nào trong khoảng này",
  showMore: (total) => `+${total} ca khác`,
};

// 12h "a" (AM/PM) clock throughout the calendar grid — matches how the team
// already reads their Google Calendar side by side with this app, so the
// two don't disagree on what "8" means.
const TIME_FORMAT = "h:mm a";

export const calendarFormats: Formats = {
  timeGutterFormat: "h a",
  eventTimeRangeFormat: ({ start, end }) =>
    `${format(start, TIME_FORMAT)} – ${format(end, TIME_FORMAT)}`,
  agendaTimeRangeFormat: ({ start, end }) =>
    `${format(start, TIME_FORMAT)} – ${format(end, TIME_FORMAT)}`,
  dayHeaderFormat: (date) => format(date, "EEEE dd/MM", { locale: vi }),
  dayRangeHeaderFormat: ({ start, end }) =>
    `${format(start, "dd/MM")} – ${format(end, "dd/MM/yyyy")}`,
  monthHeaderFormat: (date) => format(date, "MMMM yyyy", { locale: vi }),
};

// One color per coworker (like Google Calendar's "one calendar, one color"),
// so a crowded week view still reads as "who's working" at a glance instead
// of a wall of identical grey blocks. "Mine" always stays primary navy so
// your own shifts never blend into a coworker's color by chance. Each
// person gets one of these swatches automatically, but can also pick one for
// themself in Tài khoản → Màu lịch (see components/account/AccountForm.tsx),
// stored in profiles.color.
export const EVENT_COLOR_SWATCHES = [
  { var: "--chart-1", label: "Xanh navy" },
  { var: "--palette-rose", label: "Cà chua" },
  { var: "--chart-5", label: "Cam đất" },
  { var: "--gold", label: "Chuối" },
  { var: "--palette-basil", label: "Húng quế" },
  { var: "--chart-3", label: "Xanh ngọc" },
  { var: "--chart-6", label: "Chim công" },
  { var: "--palette-indigo", label: "Việt quất" },
  { var: "--chart-4", label: "Hồng mận" },
  { var: "--palette-violet", label: "Nho" },
  { var: "--palette-flamingo", label: "Hồng hạc" },
  { var: "--palette-graphite", label: "Than chì" },
  { var: "--success", label: "Xanh lá" },
] as const;

const AUTO_COLOR_VARS = EVENT_COLOR_SWATCHES.map((c) => c.var);

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export function isCustomHexColor(color: string): boolean {
  return HEX_COLOR_RE.test(color);
}

// A colorVar is either one of our CSS custom properties ("--chart-3") or,
// for a viewer's fully custom pick, a literal hex code ("#3fae7a") — this is
// the one place that distinction gets resolved into a usable CSS color value.
export function resolveColor(colorVar: string): string {
  return isCustomHexColor(colorVar) ? colorVar : `var(${colorVar})`;
}

export function getPersonColorVar(id: string, override?: string | null): string {
  if (override) return override;
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AUTO_COLOR_VARS[hash % AUTO_COLOR_VARS.length];
}

// Gold/banana/flamingo are light enough that white text fails contrast —
// every other swatch is mid-tone enough for a shared white/near-white
// foreground. Custom hex picks always assume a dark-enough color (the
// custom-color UI only offers mid/dark swatches from the picker).
export function getEventTextColorVar(colorVar: string): string {
  if (isCustomHexColor(colorVar)) return "white";
  return colorVar === "--gold" || colorVar === "--palette-flamingo"
    ? "var(--gold-foreground)"
    : "var(--primary-foreground)";
}

export type ShiftEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay?: false;
  resource: {
    kind: "shift";
    shift: ShiftWithAssignee;
    isMine: boolean;
    pendingSwap: "none" | "outgoing" | "incoming" | "open";
    pendingSwapId: string | null;
    colorVar: string;
  };
};

export type HolidayEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: true;
  resource: { kind: "holiday" };
};

export type AttendanceSession = {
  // The attendance row's own id — needed for updateAttendanceAction/
  // deleteAttendanceAction, not just display.
  id: string;
  checkInAt: string;
  checkOutAt: string | null;
  branchName: string;
  // Which shift this session was clocked against, if any — used to look up
  // a pending attendance_corrections row referencing the same shift_id, so
  // AttendanceDetailDialog can surface it inline (see toAttendanceEvents).
  shiftId: string | null;
  correction: AttendanceCorrectionDetailed | null;
};

export type AttendanceCalendarEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay?: false;
  resource: {
    kind: "attendance";
    profileId: string;
    profileName: string;
    profileRole: Role;
    colorVar: string;
    totalMinutes: number;
    isOpen: boolean;
    sessions: AttendanceSession[];
    hasPendingCorrection: boolean;
  };
};

export type LeaveCalendarEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  resource: {
    kind: "leave";
    profileId: string;
    colorVar: string;
    requestType: LeaveRequestWithRole["request_type"];
    request: LeaveRequestWithRole;
  };
};

export type CustomCalendarEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  resource: { kind: "custom"; calendarId: string; calendarName: string; colorVar: string; eventId: string };
};

// Self-service "Đăng ký ca làm" rows still awaiting a CEO/HR decision — no
// row in `shifts` exists yet, so unlike a real shift this has no swap flag,
// no assignee join, just the raw request. Rendered dashed/amber, "Chờ
// duyệt" prefixed, distinct from both a confirmed shift and a leave block.
export type ShiftRequestPendingEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay?: false;
  resource: {
    kind: "shift_request_pending";
    request: ShiftRequestDetailed;
    colorVar: string;
  };
};

export type CalendarEvent =
  | ShiftEvent
  | HolidayEvent
  | AttendanceCalendarEvent
  | LeaveCalendarEvent
  | CustomCalendarEvent
  | ShiftRequestPendingEvent;

export function isShiftEvent(event: CalendarEvent): event is ShiftEvent {
  return event.resource.kind === "shift";
}

export function isAttendanceEvent(event: CalendarEvent): event is AttendanceCalendarEvent {
  return event.resource.kind === "attendance";
}

export function isLeaveEvent(event: CalendarEvent): event is LeaveCalendarEvent {
  return event.resource.kind === "leave";
}

export function isCustomEvent(event: CalendarEvent): event is CustomCalendarEvent {
  return event.resource.kind === "custom";
}

export function isShiftRequestPendingEvent(event: CalendarEvent): event is ShiftRequestPendingEvent {
  return event.resource.kind === "shift_request_pending";
}

// Holidays render as all-day banners (like Google Calendar's holiday row),
// not real schedulable shifts — filtered to the visible range client-side
// since the list is static, not a database query.
export function toHolidayEvents(holidays: Holiday[], start: Date, end: Date): HolidayEvent[] {
  return holidays
    .filter((h) => {
      const d = new Date(`${h.date}T00:00:00`);
      return d >= start && d <= end;
    })
    .map((h) => {
      const d = new Date(`${h.date}T00:00:00`);
      return {
        id: `holiday-${h.date}`,
        title: h.name,
        start: d,
        end: d,
        allDay: true as const,
        resource: { kind: "holiday" as const },
      };
    });
}

// A viewer's own custom calendars ("Lịch khác" → "+" → "Tạo lịch mới") —
// personal events they added themself, each tagged with which calendar it
// belongs to so the sidebar can toggle a whole calendar's events on/off at
// once.
export function toCustomEvents(
  events: CustomEvent[],
  calendars: CustomCalendar[]
): CustomCalendarEvent[] {
  const byId = new Map(calendars.map((c) => [c.id, c]));
  return events
    .filter((e) => byId.has(e.calendar_id))
    .map((e) => {
      const calendar = byId.get(e.calendar_id)!;
      return {
        id: `custom-${e.id}`,
        title: e.title,
        start: new Date(e.start_at),
        end: new Date(e.end_at),
        allDay: e.all_day,
        resource: {
          kind: "custom" as const,
          calendarId: calendar.id,
          calendarName: calendar.name,
          colorVar: calendar.color,
          eventId: e.id,
        },
      };
    });
}

// "Lịch chấm công" — grouped by person + calendar day. A session still in
// progress (no check_out_at) always renders live, on its own, so the block
// keeps growing in real time. Once every session for that person that day
// is closed, they collapse into a single "Tổng X giờ Y phút" summary block
// (spanning first check-in → last check-out) — clicking it opens
// AttendanceDetailDialog with the full in/out/location breakdown per
// session. Purely additive to the shift grid, toggled by the sidebar's
// "Chấm công" checkbox.
export function toAttendanceEvents(
  records: AttendanceWithProfileRole[],
  branchNames: Map<string, string>,
  colorFor: (profileId: string) => string,
  // Keyed by shift_id — at most one pending correction per shift (DB has a
  // partial unique index enforcing this), so a 1:1 lookup is enough.
  pendingCorrectionsByShiftId: Map<string, AttendanceCorrectionDetailed> = new Map()
): AttendanceCalendarEvent[] {
  const now = new Date();
  const groups = new Map<string, AttendanceWithProfileRole[]>();
  for (const r of records) {
    const day = format(new Date(r.check_in_at), "yyyy-MM-dd");
    const key = `${r.profile_id}|${day}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const events: AttendanceCalendarEvent[] = [];
  for (const [key, list] of groups) {
    const name = list[0].profile.full_name;
    const colorVar = colorFor(list[0].profile_id);
    const open = list.filter((r) => !r.check_out_at);
    const closed = list.filter((r) => r.check_out_at);

    for (const r of open) {
      const start = new Date(r.check_in_at);
      const minutes = (now.getTime() - start.getTime()) / 60000;
      const correction = r.shift_id ? (pendingCorrectionsByShiftId.get(r.shift_id) ?? null) : null;
      events.push({
        id: `attendance-open-${r.id}`,
        title: `${name} · Đang chấm công`,
        start,
        end: now > start ? now : new Date(start.getTime() + 15 * 60_000),
        resource: {
          kind: "attendance" as const,
          profileId: r.profile_id,
          profileName: name,
          profileRole: r.profile.role,
          colorVar,
          totalMinutes: Math.max(0, Math.round(minutes)),
          isOpen: true,
          sessions: [
            {
              id: r.id,
              checkInAt: r.check_in_at,
              checkOutAt: null,
              branchName: branchNames.get(r.branch_id) ?? "—",
              shiftId: r.shift_id,
              correction,
            },
          ],
          hasPendingCorrection: Boolean(correction),
        },
      });
    }

    if (closed.length > 0) {
      const sessions: AttendanceSession[] = closed
        .map((r) => ({
          id: r.id,
          checkInAt: r.check_in_at,
          checkOutAt: r.check_out_at,
          branchName: branchNames.get(r.branch_id) ?? "—",
          shiftId: r.shift_id,
          correction: r.shift_id ? (pendingCorrectionsByShiftId.get(r.shift_id) ?? null) : null,
        }))
        .sort((a, b) => a.checkInAt.localeCompare(b.checkInAt));
      const totalMinutes = closed.reduce(
        (sum, r) => sum + (new Date(r.check_out_at!).getTime() - new Date(r.check_in_at).getTime()) / 60000,
        0
      );
      const start = new Date(sessions[0].checkInAt);
      const end = new Date(sessions[sessions.length - 1].checkOutAt!);
      const hours = Math.floor(totalMinutes / 60);
      const mins = Math.round(totalMinutes % 60);
      const label = hours > 0 ? `${hours} giờ${mins > 0 ? ` ${mins} phút` : ""}` : `${mins} phút`;

      events.push({
        id: `attendance-summary-${key}`,
        title: `${name} · Tổng ${label}`,
        start,
        end: end > start ? end : new Date(start.getTime() + 15 * 60_000),
        resource: {
          kind: "attendance" as const,
          profileId: list[0].profile_id,
          profileName: name,
          profileRole: list[0].profile.role,
          colorVar,
          totalMinutes: Math.round(totalMinutes),
          isOpen: false,
          sessions,
          hasPendingCorrection: sessions.some((s) => s.correction !== null),
        },
      });
    }
  }

  return events;
}

// "Lịch xin nghỉ phép" / "Lịch xin đến muộn" — same source table
// (leave_requests), split by request_type into two separate sidebar
// toggles per the brief. full_day/early_leave/hourly go under "Nghỉ phép";
// late_arrival gets its own "Đến muộn" toggle. Cancelled/rejected requests
// never render — only what's pending or approved is worth seeing on a
// shared calendar.
export function toLeaveEvents(
  records: LeaveRequestWithRole[],
  onlyLateArrival: boolean,
  colorFor: (profileId: string) => string
): LeaveCalendarEvent[] {
  return records
    .filter((r) => r.status === "pending" || r.status === "approved")
    .filter((r) => (onlyLateArrival ? r.request_type === "late_arrival" : r.request_type !== "late_arrival"))
    .map((r) => {
      const dayStart = new Date(`${r.start_date}T00:00:00`);
      const dayEnd = new Date(`${r.end_date}T00:00:00`);
      let start = dayStart;
      let end = endOfDay(dayEnd);
      let allDay = true;

      if (r.request_type === "late_arrival" && r.start_time) {
        start = dayStart;
        end = parse(r.start_time.slice(0, 5), "HH:mm", dayStart);
        allDay = false;
      } else if (r.request_type === "early_leave" && r.end_time) {
        start = parse(r.end_time.slice(0, 5), "HH:mm", dayStart);
        end = endOfDay(dayStart);
        allDay = false;
      } else if (r.request_type === "hourly" && r.start_time && r.end_time) {
        start = parse(r.start_time.slice(0, 5), "HH:mm", dayStart);
        end = parse(r.end_time.slice(0, 5), "HH:mm", dayStart);
        allDay = false;
      }

      return {
        id: `leave-${r.id}`,
        title: `${r.profile.full_name} · ${LEAVE_REQUEST_TYPE_LABELS[r.request_type]}`,
        start,
        end: end > start ? end : endOfDay(start),
        allDay,
        resource: {
          kind: "leave" as const,
          profileId: r.profile_id,
          colorVar: colorFor(r.profile_id),
          requestType: r.request_type,
          request: r,
        },
      };
    });
}

export function toCalendarEvents(
  shifts: ShiftWithAssignee[],
  currentUserId: string,
  pendingSwaps: SwapRequest[],
  colorFor: (profileId: string) => string
): ShiftEvent[] {
  return shifts.map((shift) => {
    const isMine = shift.assignee_id === currentUserId;

    const outgoing = pendingSwaps.find(
      (s) => s.requester_shift_id === shift.id && s.status === "pending"
    );
    const incoming = pendingSwaps.find(
      (s) => s.target_shift_id === shift.id && s.status === "pending"
    );

    let pendingSwap: ShiftEvent["resource"]["pendingSwap"] = "none";
    let pendingSwapId: string | null = null;
    if (outgoing) {
      pendingSwap = outgoing.target_id ? "outgoing" : "open";
      pendingSwapId = outgoing.id;
    } else if (incoming) {
      pendingSwap = "incoming";
      pendingSwapId = incoming.id;
    }

    return {
      id: shift.id,
      title: shift.assignee.full_name,
      start: new Date(shift.start_at),
      end: new Date(shift.end_at),
      resource: {
        kind: "shift" as const,
        shift,
        isMine,
        pendingSwap,
        pendingSwapId,
        colorVar: colorFor(shift.assignee_id),
      },
    };
  });
}

// Self-service "Đăng ký ca làm" rows still awaiting CEO/HR approval — these
// have no row in `shifts` yet, so they can't reuse toCalendarEvents; each
// pending request becomes its own dashed/amber block on the requester's
// proposed start/end. Filters to pending defensively even though the
// caller already fetches with .eq("status", "pending").
export function toShiftRequestPendingEvents(
  requests: ShiftRequestDetailed[],
  colorFor: (profileId: string) => string
): ShiftRequestPendingEvent[] {
  return requests
    .filter((r) => r.status === "pending")
    .map((r) => ({
      id: `shift-request-${r.id}`,
      title: `Chờ duyệt · ${r.profile.full_name}`,
      start: new Date(r.start_at),
      end: new Date(r.end_at),
      resource: {
        kind: "shift_request_pending" as const,
        request: r,
        colorVar: colorFor(r.profile_id),
      },
    }));
}
