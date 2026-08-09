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
  toShiftRequestPendingEvents,
  toAttendanceCorrectionPendingEvents,
  getEventTextColorVar,
  getPersonColorVar,
  resolveColor,
  getVisibleRange,
  isShiftEvent,
  isAttendanceEvent,
  isLeaveEvent,
  isCustomEvent,
  isShiftRequestPendingEvent,
  isAttendanceCorrectionPendingEvent,
  type ShiftEvent,
  type AttendanceCalendarEvent,
  type LeaveCalendarEvent,
  type CustomCalendarEvent,
  type ShiftRequestPendingEvent,
  type CalendarEvent,
  type LeaveRequestWithRole,
  type AttendanceWithProfileRole,
  type CalendarView,
} from "@/lib/calendar";
import { VIETNAM_HOLIDAYS } from "@/lib/holidays";
import {
  getCalendarFollowGroups,
  isManagerRole,
  isLeaveApprover,
  canApproveLeaveFor,
  canApproveShiftRequestFor,
  canCreateShiftFor,
  canApproveSwapRequestFor,
} from "@/lib/roles";
import { scopeToOwnOrApprovable } from "@/lib/pending-approvals";
import { useCalendarNav } from "@/hooks/use-calendar-nav";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { CALENDAR_MAX_HOUR, CALENDAR_MIN_HOUR } from "@/lib/constants";
import { cn } from "@/lib/utils";
import CalendarToolbar from "@/components/calendar/CalendarToolbar";
import MobileDayStrip from "@/components/calendar/MobileDayStrip";
import { CalendarSidebar, CalendarMobileMenu, type PendingApprovalItem } from "@/components/calendar/CalendarSidebar";
import RealtimeClock from "@/components/layout/RealtimeClock";
import ShiftEventCell from "@/components/calendar/ShiftEventCell";
import CalendarDayHeader from "@/components/calendar/CalendarDayHeader";
import ShiftFormDialog from "@/components/shifts/ShiftFormDialog";
import ShiftDetailDialog from "@/components/shifts/ShiftDetailDialog";
import AttendanceDetailDialog from "@/components/calendar/AttendanceDetailDialog";
import LeaveDetailDialog from "@/components/calendar/LeaveDetailDialog";
import CustomEventDetailDialog from "@/components/calendar/CustomEventDetailDialog";
import ShiftRequestDetailDialog from "@/components/calendar/ShiftRequestDetailDialog";
import type {
  AttendanceCorrectionDetailed,
  Branch,
  CustomCalendar,
  CustomEvent,
  Profile,
  Role,
  ShiftRequestDetailed,
  ShiftWithAssignee,
  SwapRequestDetailed,
} from "@/types";
import type { GroupPermissions } from "@/lib/permissions";

const minTime = new Date();
minTime.setHours(CALENDAR_MIN_HOUR, 0, 0, 0);
const maxTime = new Date();
maxTime.setHours(CALENDAR_MAX_HOUR, 0, 0, 0);

export default function ShiftCalendar({
  shifts,
  pendingSwaps,
  attendance,
  leaveRequests,
  shiftRequests,
  attendanceCorrections,
  branches,
  customCalendars,
  customEvents,
  currentUserId,
  currentUserName,
  currentUserRole,
  canManageShifts,
  branchMembers,
  canFollowAll,
  followedIds,
  followColors,
  branchColors,
  defaultView,
  permissions,
}: {
  shifts: ShiftWithAssignee[];
  pendingSwaps: SwapRequestDetailed[];
  attendance: AttendanceWithProfileRole[];
  leaveRequests: LeaveRequestWithRole[];
  shiftRequests: ShiftRequestDetailed[];
  attendanceCorrections: AttendanceCorrectionDetailed[];
  branches: Branch[];
  customCalendars: CustomCalendar[];
  customEvents: CustomEvent[];
  currentUserId: string;
  currentUserName: string;
  currentUserRole: Role;
  canManageShifts: boolean;
  branchMembers: Pick<Profile, "id" | "full_name" | "role" | "branch_ids">[];
  canFollowAll: boolean;
  followedIds: string[];
  followColors: Record<string, string>;
  branchColors: Record<string, string>;
  /** Server-decided initial view — day on phones, week elsewhere. */
  defaultView: CalendarView;
  permissions: GroupPermissions;
}) {
  // Squeezing the default 7-column week grid onto a phone is illegible, so
  // phones open on the single-day view — the same thing Google Calendar's
  // mobile app does. The decision is made on the server from the user-agent
  // (see app/(app)/calendar/page.tsx) and arrives as defaultView.
  //
  // It used to be a client effect that navigated to "day" after hydration.
  // That worked, but the browser had already painted the whole week grid by
  // then, so every phone visit showed a week for a frame and then jumped —
  // the jank reported on 2026-08-08. An effect cannot fix this: it runs after
  // paint by definition. Only the server can get the first frame right.
  const { date, view, navigate, isPending } = useCalendarNav(defaultView);
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();

  // Fallback for the case the server cannot see: a desktop browser resized
  // below the mobile breakpoint. The user-agent says desktop, so defaultView
  // came back as "week", but the viewport is now phone-sized.
  //
  // `view !== "day"` is what keeps this from re-introducing the jank it
  // replaced — on a real phone the server already returned day, so this bails
  // out before navigating. It only fires on an actual mismatch. An explicit
  // ?view= in the URL still wins, so it never overrides a choice just made.
  useEffect(() => {
    if (isMobile && view !== "day" && !searchParams.has("view")) {
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
    showPendingApprovals: true,
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
    () => toCalendarEvents(visibleShifts, currentUserId, currentUserRole, permissions, pendingSwaps, colorFor),
    [visibleShifts, currentUserId, currentUserRole, permissions, pendingSwaps, colorFor]
  );
  const holidayEvents = useMemo(() => {
    if (!showHolidays) return [];
    const { start, end } = getVisibleRange(date, view);
    return toHolidayEvents(VIETNAM_HOLIDAYS, start, end);
  }, [date, view, showHolidays]);
  // Keyed by shift_id — used to badge the matching attendance session with
  // a "pending correction" indicator (see toAttendanceEvents). Built from
  // the raw RLS-scoped list (visibility, not approval rights) since the
  // badge is informational, not an approve/reject gate.
  const pendingCorrectionsByShiftId = useMemo(() => {
    const map = new Map<string, AttendanceCorrectionDetailed>();
    for (const c of attendanceCorrections) map.set(c.shift_id, c);
    return map;
  }, [attendanceCorrections]);
  const attendanceEvents = useMemo(
    () =>
      eventToggles.showAttendance
        ? toAttendanceEvents(visibleAttendance, branchNames, colorFor, pendingCorrectionsByShiftId)
        : [],
    [visibleAttendance, branchNames, colorFor, eventToggles.showAttendance, pendingCorrectionsByShiftId]
  );
  // "Nghỉ phép"/"Đến muộn" toggles now only cover approved leave — pending
  // leave moved under the "Cần xét duyệt" toggle below, so a pending
  // request's calendar visibility isn't tied to two different checkboxes.
  const approvedLeaveRequests = useMemo(
    () => visibleLeaveRequests.filter((r) => r.status === "approved"),
    [visibleLeaveRequests]
  );
  const pendingLeaveRequestsForCalendar = useMemo(
    () => visibleLeaveRequests.filter((r) => r.status === "pending"),
    [visibleLeaveRequests]
  );
  const leaveEvents = useMemo(
    () => (eventToggles.showLeave ? toLeaveEvents(approvedLeaveRequests, false, colorFor) : []),
    [approvedLeaveRequests, colorFor, eventToggles.showLeave]
  );
  const lateArrivalEvents = useMemo(
    () => (eventToggles.showLateArrival ? toLeaveEvents(approvedLeaveRequests, true, colorFor) : []),
    [approvedLeaveRequests, colorFor, eventToggles.showLateArrival]
  );
  const pendingLeaveEvents = useMemo(
    () =>
      eventToggles.showPendingApprovals
        ? [
            ...toLeaveEvents(pendingLeaveRequestsForCalendar, false, colorFor),
            ...toLeaveEvents(pendingLeaveRequestsForCalendar, true, colorFor),
          ]
        : [],
    [pendingLeaveRequestsForCalendar, colorFor, eventToggles.showPendingApprovals]
  );
  const visibleCustomCalendars = useMemo(
    () => customCalendars.filter((c) => !hiddenCustomCalendarIds.has(c.id)),
    [customCalendars, hiddenCustomCalendarIds]
  );
  const customCalendarEvents = useMemo(
    () => toCustomEvents(customEvents, visibleCustomCalendars),
    [customEvents, visibleCustomCalendars]
  );
  // Self-service shift requests still awaiting a CEO/HR decision, and
  // giải trình công requests with no attendance row yet — both grouped
  // under the same "Cần xét duyệt" toggle as pending leave above, so every
  // pending-item type hides/shows together as one category.
  const shiftRequestPendingEvents = useMemo(
    () => (eventToggles.showPendingApprovals ? toShiftRequestPendingEvents(shiftRequests, colorFor) : []),
    [shiftRequests, colorFor, eventToggles.showPendingApprovals]
  );
  const attendanceCorrectionPendingEvents = useMemo(
    () =>
      eventToggles.showPendingApprovals
        ? toAttendanceCorrectionPendingEvents(attendanceCorrections, colorFor)
        : [],
    [attendanceCorrections, colorFor, eventToggles.showPendingApprovals]
  );
  const events = useMemo(
    () => [
      ...holidayEvents,
      ...attendanceEvents,
      ...leaveEvents,
      ...lateArrivalEvents,
      ...pendingLeaveEvents,
      ...customCalendarEvents,
      ...shiftEvents,
      ...shiftRequestPendingEvents,
      ...attendanceCorrectionPendingEvents,
    ],
    [
      holidayEvents,
      attendanceEvents,
      leaveEvents,
      lateArrivalEvents,
      pendingLeaveEvents,
      customCalendarEvents,
      shiftEvents,
      shiftRequestPendingEvents,
      attendanceCorrectionPendingEvents,
    ]
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
  const [shiftRequestDetail, setShiftRequestDetail] = useState<ShiftRequestPendingEvent | null>(null);

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
    if (isShiftRequestPendingEvent(event)) {
      setShiftRequestDetail(event);
      return;
    }
    if (isAttendanceCorrectionPendingEvent(event)) {
      openAttendanceCorrectionDetail(event.resource.correction);
      return;
    }
    if (!isShiftEvent(event)) return;
    // A pending swap makes the shift itself actionable (accept/reject/
    // cancel) regardless of edit rights — respond_to_swap_request only
    // ever lets the target person (or, for an open swap, any
    // non-requester) accept; it has no manager-override branch, so a
    // manager who happens to be that target/claimant needs the same
    // response dialog everyone else gets, not the shift-edit form.
    if (
      canManageShifts &&
      event.resource.pendingSwap === "none" &&
      canCreateShiftFor(currentUserRole, event.resource.shift.assignee.role, permissions)
    ) {
      setFormState({ open: true, shift: event.resource.shift, range: null });
    } else {
      setDetailEvent(event);
    }
  }

  // Sidebar "Cần xét duyệt" items open the matching detail dialog directly,
  // reusing the same event-builders as the calendar grid so the dialog
  // renders identically whichever entry point was clicked — independent of
  // whatever toggle/visible-range state currently hides it from the grid
  // itself (e.g. "Nghỉ phép" toggled off, or the item outside this week).
  function openLeaveDetail(request: LeaveRequestWithRole) {
    const [event] = toLeaveEvents([request], request.request_type === "late_arrival", colorFor);
    if (event) setLeaveDetail(event);
  }

  function openShiftRequestDetail(request: ShiftRequestDetailed) {
    const [event] = toShiftRequestPendingEvents([request], colorFor);
    if (event) setShiftRequestDetail(event);
  }

  // No dedicated builder exists for a lone swap (toCalendarEvents needs the
  // whole visible-range `shifts` list, which this swap's shift might not be
  // in) — constructed directly from the swap's own joined shift pick
  // instead. shift_type/branch_id/note aren't rendered by ShiftDetailDialog
  // so their placeholder values here are never surfaced to the user.
  function openSwapDetail(request: SwapRequestDetailed) {
    const isMine = request.requester_id === currentUserId;
    // A manager who is neither requester nor target can still approve a
    // TARGETED swap on the requester's/target's behalf (see
    // canApproveSwapRequestFor) — that state is "approvable", distinct from
    // "open" (an unclaimed swap anyone can take), so ShiftDetailDialog shows
    // the right copy/button for each.
    const canApproveAsManager =
      !isMine &&
      request.target_id !== null &&
      request.target !== null &&
      request.target_id !== currentUserId &&
      canApproveSwapRequestFor(currentUserRole, request.requester.role, request.target.role, permissions);
    const pendingSwap: ShiftEvent["resource"]["pendingSwap"] = isMine
      ? request.target_id
        ? "outgoing"
        : "open"
      : request.target_id === currentUserId
        ? "incoming"
        : canApproveAsManager
          ? "approvable"
          : "open";
    const shift: ShiftWithAssignee = {
      id: request.requester_shift.id,
      branch_id: request.branch_id,
      assignee_id: request.requester_id,
      start_at: request.requester_shift.start_at,
      end_at: request.requester_shift.end_at,
      note: null,
      created_by: null,
      shift_type: "morning",
      assignee: {
        id: request.requester_id,
        full_name: request.requester.full_name,
        color: null,
        role: request.requester.role,
      },
    };
    setDetailEvent({
      id: shift.id,
      title: shift.assignee.full_name,
      start: new Date(shift.start_at),
      end: new Date(shift.end_at),
      resource: {
        kind: "shift",
        shift,
        isMine,
        pendingSwap,
        pendingSwapId: request.id,
        colorVar: colorFor(request.requester_id),
      },
    });
  }

  // Same reasoning as openSwapDetail — AttendanceDetailDialog expects a
  // grouped session-list event, but a sidebar click may reference a shift
  // outside the currently visible attendance range, so a minimal
  // single-session event carrying just this correction is built directly
  // rather than searched for in the (possibly empty) rendered list.
  function openAttendanceCorrectionDetail(correction: AttendanceCorrectionDetailed) {
    setAttendanceDetail({
      id: `attendance-correction-${correction.id}`,
      title: `${correction.profile.full_name} · Giải trình công`,
      start: new Date(correction.shift.start_at),
      end: new Date(correction.shift.end_at),
      resource: {
        kind: "attendance",
        profileId: correction.profile_id,
        profileName: correction.profile.full_name,
        profileRole: correction.profile.role,
        colorVar: colorFor(correction.profile_id),
        totalMinutes: 0,
        isOpen: false,
        sessions: [
          {
            // May be empty when the correction is for a missed check-in
            // with no attendance row yet — AttendanceDetailDialog only
            // offers edit/delete for a session with a real id.
            id: correction.attendance_id ?? "",
            checkInAt: correction.actual_check_in_at ?? correction.shift.start_at,
            checkOutAt: null,
            branchName: "—",
            shiftId: correction.shift_id,
            correction,
          },
        ],
        hasPendingCorrection: true,
      },
    });
  }

  const otherShifts = useMemo(
    () =>
      shifts.filter(
        (s) => s.assignee_id !== currentUserId && new Date(s.start_at) > new Date()
      ),
    [shifts, currentUserId]
  );

  // branchMembers is already the full list of people this viewer is
  // allowed to see per RLS (can_view_profile — ceo/technical get
  // everyone, coo/training_director/hr get their own group, everyone else
  // gets their own branch). Building this from `shifts` instead (people
  // with a shift in the currently visible week) used to hide anyone
  // without a shift this week from the follow list, even when RLS
  // permitted following them — fixed to source from branchMembers.
  const coworkers = useMemo(() => {
    const followedSet = new Set(followedIds);
    return branchMembers
      .filter((m) => m.id !== currentUserId)
      .map((m) => ({
        id: m.id,
        name: m.full_name,
        color: followColors[m.id] ?? null,
        followed: followedSet.has(m.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "vi"))
      .sort((a, b) => Number(b.followed) - Number(a.followed));
  }, [branchMembers, currentUserId, followedIds, followColors]);

  // Same source (branchMembers) as `coworkers`, bucketed into role-based
  // groups instead of one flat list — see getCalendarFollowGroups() for
  // which roles land in which group per viewer role. null for viewers
  // without the group feature (canFollowAll === false), who keep the flat
  // `coworkers` legend below unchanged. Filtering here (not on the raw
  // branchMembers prop) matters: branchMembers is also threaded straight
  // into ShiftFormDialog for the shift-assignee picker, which must keep
  // seeing everyone RLS allows, not just this viewer's calendar groups.
  const followGroups = useMemo(() => {
    const defs = getCalendarFollowGroups(currentUserRole, permissions);
    if (!defs) return null;
    const followedSet = new Set(followedIds);
    return defs.map((def) => ({
      key: def.key,
      label: def.label,
      people: branchMembers
        .filter((m) => m.id !== currentUserId && def.roles.has(m.role))
        .map((m) => ({
          id: m.id,
          name: m.full_name,
          color: followColors[m.id] ?? null,
          followed: followedSet.has(m.id),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "vi")),
    }));
  }, [branchMembers, currentUserId, currentUserRole, followedIds, followColors, permissions]);

  // ShiftRequestDialog only ever renders for the current viewer requesting
  // their OWN shift, so this is scoped to their branches, not the
  // assignee-varies logic ShiftFormDialog needs. Management-tier requesters
  // still see every branch, matching their "all branches" status everywhere
  // else. training_director/coo/hr are now in DIRECT_SHIFT_ROLES too, but
  // canCreateShiftFor never covers a viewer's OWN role (their group is their
  // staff, not themselves) — so they still land here for their own shift.
  const requestableBranches = useMemo(() => {
    if (isManagerRole(currentUserRole)) return branches;
    const self = branchMembers.find((m) => m.id === currentUserId);
    return branches.filter((b) => self?.branch_ids.includes(b.id));
  }, [branches, branchMembers, currentUserId, currentUserRole]);

  // ShiftFormDialog's assignee picker must only offer people this viewer is
  // actually allowed to create/edit a shift for — branchMembers itself stays
  // unfiltered (it also feeds the follow/legend sidebar, which needs the
  // full RLS-visible set, not the narrower create-shift scope).
  const creatableBranchMembers = useMemo(
    () => branchMembers.filter((m) => canCreateShiftFor(currentUserRole, m.role, permissions)),
    [branchMembers, currentUserRole, permissions]
  );

  function handleQuickCreate() {
    const start = new Date();
    start.setHours(CALENDAR_MIN_HOUR + 3, 0, 0, 0);
    const end = new Date(start);
    end.setHours(start.getHours() + 2);
    setFormState({ open: true, shift: null, range: { start, end } });
  }

  // "Cần xét duyệt" sidebar section — narrows each fetched pending list down
  // to "I submitted this" ∪ "I can approve this," per row. shift_requests
  // doesn't need this pass (its RLS select is already exactly that shape,
  // see calendar/page.tsx); the other three tables' RLS is broader
  // (visibility, not approval rights), so this is where that gets applied.
  // canFollowAll roles (ceo/technical) already see everyone's calendar —
  // extend that same blanket visibility to "Cần xét duyệt" for roles that
  // aren't actual approvers (technical today), so they can at least see
  // what's pending. The dialogs opened from these rows independently gate
  // their own Duyệt/Từ chối buttons via isLeaveApprover/canApproveLeaveFor,
  // so a non-approver seeing the row here still can't act on it.
  const pendingLeaveForApproval = useMemo(
    () =>
      scopeToOwnOrApprovable(
        leaveRequests.filter((r) => r.status === "pending"),
        currentUserId,
        (r) => r.profile_id,
        (r) =>
          (isLeaveApprover(currentUserRole) && canApproveLeaveFor(currentUserRole, r.profile.role, permissions)) ||
          canFollowAll
      ),
    [leaveRequests, currentUserId, currentUserRole, canFollowAll, permissions]
  );
  const pendingSwapsForApproval = useMemo(
    () =>
      scopeToOwnOrApprovable(
        pendingSwaps,
        currentUserId,
        (r) => r.requester_id,
        (r) =>
          r.target_id === currentUserId ||
          (r.target_id === null && r.requester_id !== currentUserId) ||
          (r.target_id !== null &&
            r.target !== null &&
            canApproveSwapRequestFor(currentUserRole, r.requester.role, r.target.role, permissions)) ||
          canFollowAll
      ),
    [pendingSwaps, currentUserId, currentUserRole, canFollowAll, permissions]
  );
  const attendanceCorrectionsForApproval = useMemo(
    () =>
      scopeToOwnOrApprovable(
        attendanceCorrections,
        currentUserId,
        (r) => r.profile_id,
        (r) =>
          (isLeaveApprover(currentUserRole) && canApproveLeaveFor(currentUserRole, r.profile.role, permissions)) ||
          canFollowAll
      ),
    [attendanceCorrections, currentUserId, currentUserRole, canFollowAll, permissions]
  );
  const pendingApprovals: PendingApprovalItem[] = useMemo(() => {
    const items: PendingApprovalItem[] = [
      ...pendingLeaveForApproval.map((r) => ({
        id: `leave-${r.id}`,
        kind: "leave" as const,
        label: `${r.profile.full_name} · Xin nghỉ phép`,
        at: r.created_at,
        onOpen: () => openLeaveDetail(r),
      })),
      ...shiftRequests.map((r) => ({
        id: `shift-request-${r.id}`,
        kind: "shift_request" as const,
        label: `${r.profile.full_name} · Đăng ký ca làm`,
        at: r.created_at,
        onOpen: () => openShiftRequestDetail(r),
      })),
      ...pendingSwapsForApproval.map((r) => ({
        id: `swap-${r.id}`,
        kind: "swap" as const,
        label: `${r.requester.full_name} · Đổi ca`,
        at: r.created_at,
        onOpen: () => openSwapDetail(r),
      })),
      ...attendanceCorrectionsForApproval.map((r) => ({
        id: `attendance-correction-${r.id}`,
        kind: "attendance_correction" as const,
        label: `${r.profile.full_name} · Giải trình công`,
        at: r.created_at,
        onOpen: () => openAttendanceCorrectionDetail(r),
      })),
    ];
    return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLeaveForApproval, shiftRequests, pendingSwapsForApproval, attendanceCorrectionsForApproval]);

  const sidebarProps = {
    canManageShifts,
    date,
    onPickDate: (d: Date) => navigate(d),
    onOpenDay: (d: Date) => navigate(d, "day"),
    onCreate: handleQuickCreate,
    people: coworkers,
    groups: followGroups,
    canFollowAll,
    currentUserName,
    showHolidays,
    onToggleHolidays: setShowHolidays,
    eventToggles,
    onEventTogglesChange: setEventToggles,
    pendingApprovals,
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
    requestableBranches,
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

      {/* overflow-hidden (react-big-calendar's own expected containment) —
          .rbc-time-content already ships its own overflow-y:auto internal
          scroll region that keeps the toolbar and .rbc-time-header fixed
          automatically; that only works if this ancestor chain actually
          bounds the calendar's height instead of letting it grow to fit
          all 6am-11pm content. See the min-h-0 on <Calendar> below — flex
          items default to min-height:auto, which was the real reason that
          internal scroll never engaged and everything scrolled together
          as one unstyled blob instead. Month view needs no separate
          handling: RBC's own "+N more" popover already covers cells with
          too many events, it was never actually clipping. */}
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
                className: [
                  "shift-event",
                  "shift-event--leave",
                  event.resource.request.status === "pending" ? "shift-event--awaiting" : "",
                ]
                  .filter(Boolean)
                  .join(" "),
                style: { "--event-color": resolveColor(event.resource.colorVar) } as React.CSSProperties,
              };
            }
            if (event.resource.kind === "custom") {
              return {
                className: "shift-event shift-event--custom",
                style: { "--event-color": resolveColor(event.resource.colorVar) } as React.CSSProperties,
              };
            }
            if (event.resource.kind === "shift_request_pending") {
              return {
                className: "shift-event shift-event--shift-request-pending",
                style: { "--event-color": resolveColor(event.resource.colorVar) } as React.CSSProperties,
              };
            }
            if (event.resource.kind === "attendance_correction_pending") {
              return {
                className: "shift-event shift-event--shift-request-pending",
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
          className={cn("min-h-0 flex-1 transition-opacity", isPending && "opacity-60")}
        />

        {canManageShifts && (
          <ShiftFormDialog
            open={formState.open}
            onOpenChange={(open) => setFormState((s) => ({ ...s, open }))}
            branchMembers={creatableBranchMembers}
            branches={branches}
            shift={formState.shift}
            initialRange={formState.range}
          />
        )}

        {detailEvent && (
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
            currentUserRole={currentUserRole}
            permissions={permissions}
          />
        )}

        {leaveDetail && (
          <LeaveDetailDialog
            open={Boolean(leaveDetail)}
            onOpenChange={(open) => !open && setLeaveDetail(null)}
            event={leaveDetail}
            canRespond={
              leaveDetail.resource.request.status === "pending" &&
              isLeaveApprover(currentUserRole) &&
              canApproveLeaveFor(currentUserRole, leaveDetail.resource.request.profile.role, permissions)
            }
          />
        )}

        {shiftRequestDetail && (
          <ShiftRequestDetailDialog
            open={Boolean(shiftRequestDetail)}
            onOpenChange={(open) => !open && setShiftRequestDetail(null)}
            event={shiftRequestDetail}
            canRespond={canApproveShiftRequestFor(
              currentUserRole,
              shiftRequestDetail.resource.request.profile.role,
              permissions
            )}
            canCancel={shiftRequestDetail.resource.request.profile_id === currentUserId}
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
