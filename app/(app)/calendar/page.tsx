import { headers } from "next/headers";
import { parse, isValid, format } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import {
  getVisibleRange,
  type CalendarView,
  type LeaveRequestWithRole,
  type AttendanceWithProfileRole,
} from "@/lib/calendar";
import { canCreateShiftDirectly, canSeeAllCalendars } from "@/lib/roles";
import { getGroupPermissions } from "@/lib/permissions-server";
import { getBranches } from "@/lib/branches";
import ShiftCalendarLoader from "@/components/calendar/ShiftCalendarLoader";
import type {
  AttendanceCorrectionDetailed,
  CustomCalendar,
  CustomEvent,
  Profile,
  ShiftRequestDetailed,
  ShiftWithAssignee,
  SwapRequestDetailed,
} from "@/types";

// Same joined shape as swaps/page.tsx and manager/page.tsx's SELECT — the
// calendar's swap query used to be a bare `select("*")`, which meant the
// pending-swap indicator on a shift had no requester/target names to show
// in a detail dialog. Upgrading it here lets ShiftDetailDialog and the new
// "Cần xét duyệt" sidebar section render names instead of raw ids.
const SWAP_SELECT = `
  *,
  requester:profiles!requester_id(id, full_name, role),
  target:profiles!target_id(id, full_name, role),
  requester_shift:shifts!requester_shift_id(id, start_at, end_at),
  target_shift:shifts!target_shift_id(id, start_at, end_at)
`;

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string }>;
}) {
  const profile = await requireProfile();
  const params = await searchParams;

  // parse(), not new Date(params.date) — the latter reads "yyyy-MM-dd" as
  // UTC midnight, which the client's useCalendarNav no longer does (see
  // that hook for why). Keeping both sides on the same parsing rule avoids
  // the server fetching a different date range than the client displays.
  const parsedDate = params.date ? parse(params.date, "yyyy-MM-dd", new Date()) : new Date();
  const date = isValid(parsedDate) ? parsedDate : new Date();

  // Phones default to the single-day view. Deciding that HERE rather than in a
  // client effect is what removes the visible week→day jump: the effect could
  // only run after hydration, so the browser had already painted a full week
  // grid before navigating away from it.
  //
  // It also stops the phone paying for data it throws away — the server used
  // to fetch a whole week's shifts, then the client immediately re-fetched a
  // single day. On a 3G connection that was the slowest part of opening the
  // calendar.
  //
  // UA sniffing is imprecise, and deliberately so here: the cost of guessing
  // wrong is one tap on the view switcher, and an explicit ?view= in the URL
  // always wins. Viewport width would be more accurate but is not knowable on
  // the server, which is the whole point.
  const userAgent = (await headers()).get("user-agent") ?? "";
  const isMobileUa = /Android|iPhone|iPod|Windows Phone|webOS|BlackBerry/i.test(userAgent);
  const view = (params.view as CalendarView) || (isMobileUa ? "day" : "week");
  const { start, end } = getVisibleRange(date, view);

  const supabase = await createClient();
  const permissions = await getGroupPermissions();
  const canFollowAll = canSeeAllCalendars(profile.role);

  const [
    { data: shifts },
    { data: pendingSwaps },
    { data: branchMembers },
    { data: follows },
    { data: attendance },
    { data: leaveRequests },
    branches,
    { data: customCalendars },
    { data: customEvents },
    { data: branchColorRows },
    { data: shiftRequests },
    { data: attendanceCorrections },
  ] = await Promise.all([
    supabase
      .from("shifts")
      .select("*, assignee:profiles!assignee_id(id, full_name, color, role)")
      .gte("start_at", start.toISOString())
      .lte("start_at", end.toISOString())
      .order("start_at"),
    // shift_swap_requests RLS (swaps_select_branch) is visibility-scoped,
    // not approval-scoped — same broad set already used for the shift-level
    // pendingSwap indicator, joined so both that indicator's dialog and the
    // sidebar can show requester/target names.
    supabase.from("shift_swap_requests").select(SWAP_SELECT).eq("status", "pending"),
    supabase
      .from("profiles")
      .select("id, full_name, role, secondary_role, profile_branches(branch_id)")
      .order("full_name"),
    canFollowAll
      ? supabase.from("calendar_follows").select("followee_id, color, followed").eq("follower_id", profile.id)
      : Promise.resolve({ data: [] }),
    // RLS (can_view_profile) already limits this to what the viewer can
    // see — own records, or their group/all for the manager-tier roles.
    // profile.role added so AttendanceDetailDialog can gate edit/delete
    // buttons with canManageAttendanceFor (see AttendanceWithProfileRole).
    supabase
      .from("attendance")
      .select("*, profile:profiles!profile_id(id, full_name, role)")
      .gte("check_in_at", start.toISOString())
      .lte("check_in_at", end.toISOString()),
    // profile.role added (beyond the base LeaveRequestDetailed shape) so
    // the "Cần xét duyệt" sidebar can gate each row with canApproveLeaveFor
    // — see LeaveRequestWithRole in lib/calendar.ts.
    supabase
      .from("leave_requests")
      .select("*, profile:profiles!profile_id(id, full_name, role)")
      .in("status", ["pending", "approved"])
      .lte("start_date", format(end, "yyyy-MM-dd"))
      .gte("end_date", format(start, "yyyy-MM-dd")),
    getBranches(),
    supabase.from("custom_calendars").select("*").eq("owner_id", profile.id),
    // RLS (custom_events_owner) already scopes this to the viewer's own
    // calendars — no need to filter by owner here too.
    supabase
      .from("custom_events")
      .select("*")
      .lte("start_at", end.toISOString())
      .gte("end_at", start.toISOString()),
    supabase.from("branch_color_overrides").select("branch_key, color").eq("profile_id", profile.id),
    // shift_requests_select RLS already scopes to profile_id = viewer OR
    // can_approve_shift_request(profile_id) — exactly the "own ∪
    // approvable" shape this page needs, no app-level filtering required.
    supabase
      .from("shift_requests")
      .select("*, profile:profiles!profile_id(id, full_name, role)")
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    // attendance_corrections_select RLS is can_view_profile-scoped
    // (visibility), broader than approval rights — used as-is for the
    // pending-correction badge on attendance events; narrowed further
    // client-side for the sidebar/dialog approve buttons.
    supabase
      .from("attendance_corrections")
      .select("*, profile:profiles!profile_id(id, full_name, role), shift:shifts!shift_id(id, start_at, end_at)")
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ]);

  const followRows =
    (follows as { followee_id: string; color: string | null; followed: boolean }[] | null) ?? [];
  // Color is kept even for someone the viewer has since unfollowed — only
  // "followed" rows count toward what's actually shown/ticked.
  const followColors = Object.fromEntries(
    followRows.filter((f) => f.color).map((f) => [f.followee_id, f.color as string])
  );
  const branchColors = Object.fromEntries(
    ((branchColorRows as { branch_key: string; color: string }[] | null) ?? []).map((r) => [
      r.branch_key,
      r.color,
    ])
  );

  return (
    <ShiftCalendarLoader
      defaultView={view}
      shifts={(shifts as ShiftWithAssignee[]) ?? []}
      pendingSwaps={(pendingSwaps as SwapRequestDetailed[]) ?? []}
      attendance={(attendance as AttendanceWithProfileRole[]) ?? []}
      leaveRequests={(leaveRequests as LeaveRequestWithRole[]) ?? []}
      shiftRequests={(shiftRequests as ShiftRequestDetailed[]) ?? []}
      attendanceCorrections={(attendanceCorrections as AttendanceCorrectionDetailed[]) ?? []}
      branches={branches}
      customCalendars={(customCalendars as CustomCalendar[]) ?? []}
      customEvents={(customEvents as CustomEvent[]) ?? []}
      currentUserId={profile.id}
      currentUserName={profile.full_name}
      currentUserRole={profile.role}
      canManageShifts={canCreateShiftDirectly(profile.role)}
      branchMembers={(
        (branchMembers as
          | (Pick<Profile, "id" | "full_name" | "role" | "secondary_role"> & {
              profile_branches: { branch_id: string }[];
            })[]
          | null) ?? []
      ).map((m) => ({
        id: m.id,
        full_name: m.full_name,
        role: m.role,
        secondary_role: m.secondary_role,
        branch_ids: m.profile_branches.map((pb) => pb.branch_id),
      }))}
      canFollowAll={canFollowAll}
      followedIds={followRows.filter((f) => f.followed).map((f) => f.followee_id)}
      followColors={followColors}
      branchColors={branchColors}
      permissions={permissions}
    />
  );
}
