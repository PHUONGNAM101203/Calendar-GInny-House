import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isManagerRole } from "@/lib/roles";
import { buildNotifications } from "@/lib/notifications";
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

  const [{ data: swaps }, { data: leaves }, { data: shiftRequests }, { data: attendanceCorrections }] =
    await Promise.all([
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
    ]);

  const notifications = buildNotifications({
    profile,
    swaps: (swaps as SwapRequestDetailed[]) ?? [],
    leaves: (leaves as LeaveRequestDetailed[]) ?? [],
    shiftRequests: (shiftRequests as ShiftRequestDetailed[]) ?? [],
    attendanceCorrections: (attendanceCorrections as AttendanceCorrectionDetailed[]) ?? [],
  });

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader fullName={profile.full_name} role={profile.role} notifications={notifications} />
      {/* Manager-tier roles (ceo/coo/training_director/technical) never have
          a branch_id by design — they run every cơ sở at once (see
          isManagerRole in lib/roles.ts). Only front-line roles missing a
          branch get the nag; a manager missing one isn't a data problem. */}
      {!profile.branch_id && !isManager && (
        <div className="border-b bg-destructive/10 px-4 py-2 text-center text-sm text-destructive sm:px-6">
          Bạn chưa được gán cơ sở làm việc. Vui lòng liên hệ quản lý.
        </div>
      )}
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
