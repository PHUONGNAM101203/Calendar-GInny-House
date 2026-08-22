// Shared app-level guards for anything that writes a row into `shifts`.
//
// Extracted from actions/shifts.ts when ca cố định (0078) added a second write
// path: a recurring series creates dozens of shifts at once, and an
// assignee-scoping check that only one of the two paths ran would be a hole
// that widens with every occurrence. Deliberately a plain lib module, NOT a
// "use server" file — every export there becomes a client-callable endpoint,
// and neither of these is safe or meaningful to expose that way (one takes a
// live Supabase client as an argument).
import type { createClient } from "@/lib/supabase/server";
import { isManagerRole, canCreateShiftFor } from "@/lib/roles";
import { getGroupPermissions } from "@/lib/permissions-server";
import { getRemoteBranchId } from "@/lib/branches";
import type { Role } from "@/types";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

// Defense in depth — the pickers already narrow assignee options to the
// caller's group and branch, but a manager could still bypass the client.
// Looks up the assignee's role once and checks both group-scoping
// (canCreateShiftFor) and branch membership off that single lookup. A
// management-tier assignee has no profile_branches rows by design and is
// exempt from the branch check (they cover every branch), matching that
// convention everywhere else in the app. isRemote skips the branch check
// entirely — nobody is really a "member" of the synthetic Remote branch
// (0066_remote_branch.sql), so membership can't apply there.
export async function assertAssigneeAllowed(
  supabase: ServerClient,
  callerRole: Role,
  assigneeId: string,
  branchId: string,
  isRemote: boolean
): Promise<string | null> {
  const { data: assignee } = await supabase
    .from("profiles")
    .select("role, secondary_role")
    .eq("id", assigneeId)
    .single();
  if (!assignee) return "Không tìm thấy nhân viên này";
  const permissions = await getGroupPermissions();
  if (!canCreateShiftFor(callerRole, assignee.role, permissions)) {
    return "Bạn không có quyền xếp ca cho nhân viên này";
  }
  if (isManagerRole(assignee.role) || isRemote) return null;

  const { data: isMember } = await supabase.rpc("is_branch_member", {
    p_profile_id: assigneeId,
    p_branch_id: branchId,
  });
  return isMember ? null : "Nhân viên này không thuộc cơ sở đã chọn";
}

export async function resolveShiftBranchId(
  shiftType: string,
  branchId: string | undefined
): Promise<string> {
  if (branchId) return branchId;
  if (shiftType === "remote") return getRemoteBranchId();
  throw new Error("Vui lòng chọn cơ sở");
}
