import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isManagerRole } from "@/lib/roles";
import { buildNotifications } from "@/lib/notifications";
import { getGroupPermissions } from "@/lib/permissions-server";
import AppHeader from "@/components/layout/AppHeader";
import type {
  AttendanceCorrectionDetailed,
  LeaveRequestDetailed,
  ShiftRequestDetailed,
  SwapRequestDetailed,
} from "@/types";

export default async function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  const isManager = isManagerRole(profile.role);
  const supabase = await createClient();

  const [
    { data: swaps },
    { data: leaves },
    { data: shiftRequests },
    { data: attendanceCorrections },
    // Joined to the batch rather than awaited after it: buildNotifications
    // needs it, but the query itself depends on none of these, so awaiting it
    // separately cost every page view an extra serialized round-trip.
    permissions,
  ] = await Promise.all([
    supabase
      .from("shift_swap_requests")
      .select(
        "*, requester:profiles!requester_id(id, full_name), target:profiles!target_id(id, full_name), requester_shift:shifts!requester_shift_id(id, start_at, end_at), target_shift:shifts!target_shift_id(id, start_at, end_at)"
      )
      .order("created_at", { ascending: false })
      .limit(15),
    supabase
      .from("leave_requests")
      .select("*, profile:profiles!profile_id(id, full_name)")
      .order("created_at", { ascending: false })
      .limit(15),
    supabase
      .from("shift_requests")
      .select("*, profile:profiles!profile_id(id, full_name)")
      .order("created_at", { ascending: false })
      .limit(15),
    supabase
      .from("attendance_corrections")
      .select("*, profile:profiles!profile_id(id, full_name)")
      .order("created_at", { ascending: false })
      .limit(15),
    getGroupPermissions(),
  ]);

  const notifications = buildNotifications({
    profile,
    swaps: (swaps as SwapRequestDetailed[]) ?? [],
    leaves: (leaves as LeaveRequestDetailed[]) ?? [],
    shiftRequests: (shiftRequests as ShiftRequestDetailed[]) ?? [],
    attendanceCorrections: (attendanceCorrections as AttendanceCorrectionDetailed[]) ?? [],
    permissions,
  });

  return (
    // min-h-0 below is load-bearing, not tidying. A flex item defaults to
    // min-height:auto, meaning it refuses to shrink below its content — so
    // without it this shell grows to fit a tall calendar, body overflows, and
    // the whole page scrolls. That is what made the calendar's day/date header
    // scroll away: nothing was wrong with the header, the internal scroll
    // region simply never engaged, because .rbc-calendar's height:100% had no
    // definite parent height to resolve against.
    // <main> escapes the same trap via overflow-hidden, which already zeroes
    // the automatic minimum size; this div has overflow:visible and needs it
    // spelled out.
    <div className="flex min-h-0 flex-1 flex-col">
      <AppHeader
        fullName={profile.full_name}
        role={profile.role}
        notifications={notifications}
        notificationsSeenAt={profile.notifications_seen_at}
      />
      {/* Manager-tier roles (ceo/coo/training_director/technical) never have
          any profile_branches rows by design — they run every cơ sở at once
          (see isManagerRole in lib/roles.ts). Only front-line roles with
          zero branch memberships get the nag; a manager having none isn't a
          data problem. */}
      {profile.branch_ids.length === 0 && !isManager && (
        <div className="border-b bg-destructive/10 px-4 py-2 text-center text-sm text-destructive sm:px-6">
          Bạn chưa được gán cơ sở làm việc. Vui lòng liên hệ quản lý.
        </div>
      )}
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
