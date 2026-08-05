import { parse, isValid, format } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { getVisibleRange, type CalendarView } from "@/lib/calendar";
import { canCreateShiftDirectly, canSeeAllCalendars } from "@/lib/roles";
import { getBranches } from "@/lib/branches";
import ShiftCalendarLoader from "@/components/calendar/ShiftCalendarLoader";
import type {
  AttendanceWithProfile,
  CustomCalendar,
  CustomEvent,
  LeaveRequestDetailed,
  Profile,
  ShiftWithAssignee,
  SwapRequest,
} from "@/types";

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
  const view = (params.view as CalendarView) || "week";
  const { start, end } = getVisibleRange(date, view);

  const supabase = await createClient();
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
  ] = await Promise.all([
    supabase
      .from("shifts")
      .select("*, assignee:profiles!assignee_id(id, full_name, color)")
      .gte("start_at", start.toISOString())
      .lte("start_at", end.toISOString())
      .order("start_at"),
    supabase.from("shift_swap_requests").select("*").eq("status", "pending"),
    supabase.from("profiles").select("id, full_name").order("full_name"),
    canFollowAll
      ? supabase.from("calendar_follows").select("followee_id, color, followed").eq("follower_id", profile.id)
      : Promise.resolve({ data: [] }),
    // RLS (can_view_profile) already limits this to what the viewer can
    // see — own records, or their group/all for the manager-tier roles.
    supabase
      .from("attendance")
      .select("*, profile:profiles!profile_id(id, full_name)")
      .gte("check_in_at", start.toISOString())
      .lte("check_in_at", end.toISOString()),
    supabase
      .from("leave_requests")
      .select("*, profile:profiles!profile_id(id, full_name)")
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
  ]);

  const followRows =
    (follows as { followee_id: string; color: string | null; followed: boolean }[] | null) ?? [];
  // Color is kept even for someone the viewer has since unfollowed — only
  // "followed" rows count toward what's actually shown/ticked.
  const followColors = Object.fromEntries(
    followRows.filter((f) => f.color).map((f) => [f.followee_id, f.color as string])
  );

  return (
    <ShiftCalendarLoader
      shifts={(shifts as ShiftWithAssignee[]) ?? []}
      pendingSwaps={(pendingSwaps as SwapRequest[]) ?? []}
      attendance={(attendance as AttendanceWithProfile[]) ?? []}
      leaveRequests={(leaveRequests as LeaveRequestDetailed[]) ?? []}
      branches={branches}
      customCalendars={(customCalendars as CustomCalendar[]) ?? []}
      customEvents={(customEvents as CustomEvent[]) ?? []}
      currentUserId={profile.id}
      currentUserName={profile.full_name}
      canManageShifts={canCreateShiftDirectly(profile.role)}
      branchMembers={(branchMembers as Pick<Profile, "id" | "full_name">[]) ?? []}
      canFollowAll={canFollowAll}
      followedIds={followRows.filter((f) => f.followed).map((f) => f.followee_id)}
      followColors={followColors}
    />
  );
}
