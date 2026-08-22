"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth";
import { emitNotifications } from "@/lib/notifications-emit";
import { ROLE_LABELS } from "@/lib/roles";
import type { ActionResult, Role } from "@/types";

// Every notification in this file is addressed to the staff member whose
// profile changed, never to the manager who changed it — a manager editing
// their own row (all three actions below allow it) would otherwise be told
// about their own click. Each emit site checks profileId !== manager.id.
const STAFF_PROFILE_URL = "/account";

// Branch membership lives in profile_branches, which set_profile_branches
// replaces wholesale — so the previous set has to be read BEFORE the RPC
// runs; afterwards it is gone. Names, not ids, are baked into the body so it
// still reads correctly to a human.
async function readBranchState(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profileId: string
): Promise<{ currentIds: string[]; nameById: Map<string, string> }> {
  const [memberships, branches] = await Promise.all([
    supabase.from("profile_branches").select("branch_id").eq("profile_id", profileId),
    // Queried directly rather than through lib/branches.ts's getBranches(),
    // which filters out the synthetic REMOTE row — this is a name lookup, so
    // it must resolve whatever id is actually on the row.
    supabase.from("branches").select("id, name"),
  ]);

  return {
    currentIds: ((memberships.data as { branch_id: string }[]) ?? []).map((m) => m.branch_id),
    nameById: new Map(
      ((branches.data as { id: string; name: string }[]) ?? []).map((b) => [b.id, b.name])
    ),
  };
}

function listBranchNames(ids: string[], nameById: Map<string, string>): string {
  const names = ids
    .map((id) => nameById.get(id) ?? "cơ sở không xác định")
    .sort((a, b) => a.localeCompare(b, "vi"));
  return names.length ? names.join(", ") : "chưa có cơ sở nào";
}

function sameBranchSet(a: string[], b: string[]): boolean {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((id, i) => id === right[i]);
}

export async function updateStaffBranchesAction(
  profileId: string,
  branchIds: string[]
): Promise<ActionResult> {
  const manager = await requireManager();
  const supabase = await createClient();
  const before = await readBranchState(supabase, profileId);

  const { error } = await supabase.rpc("set_profile_branches", {
    p_profile_id: profileId,
    p_branch_ids: branchIds,
  });

  if (error) return { ok: false, error: "Không thể cập nhật cơ sở" };

  revalidatePath("/manager");
  revalidatePath("/calendar");
  // Where someone is expected to show up for work — silent until now.
  // A no-op save (the picker re-submitting the same set) emits nothing.
  if (profileId !== manager.id && !sameBranchSet(before.currentIds, branchIds)) {
    const from = listBranchNames(before.currentIds, before.nameById);
    const to = listBranchNames(branchIds, before.nameById);
    // See actions/leave.ts's requestLeaveAction for why after() is required.
    after(() =>
      emitNotifications([
        {
          profileId,
          kind: "branches_changed",
          title: "Cơ sở làm việc của bạn đã thay đổi",
          body: `${manager.full_name} đã đổi cơ sở làm việc của bạn từ ${from} sang ${to}.`,
          url: STAFF_PROFILE_URL,
          relatedId: profileId,
        },
      ])
    );
  }
  return { ok: true, data: undefined };
}

export async function updateStaffRoleAction(
  profileId: string,
  role: Role
): Promise<ActionResult> {
  const manager = await requireManager();
  const supabase = await createClient();
  // Read before the update: afterwards the old role is gone, and a message
  // that only names the new one tells the person nothing they can act on.
  const { data: before } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", profileId)
    .maybeSingle<{ role: Role }>();
  // Same "read the row back" requirement as updateStaffBranchAction above —
  // a manager changing someone else's role also goes through the
  // profiles_update_manager RLS policy, and a bare .update() would silently
  // no-op instead of erroring if that policy were ever missing.
  const { data, error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", profileId)
    .select("id, role")
    .maybeSingle();

  if (error) return { ok: false, error: "Không thể cập nhật vai trò" };
  if (!data || data.role !== role) {
    return {
      ok: false,
      error: "Không có quyền cập nhật vai trò — hãy chắc chắn đã chạy đủ các migration mới nhất",
    };
  }

  revalidatePath("/manager");
  revalidatePath("/calendar");
  // A role change moves what this person may do, whose leave they approve and
  // which shifts they can be given — they are entitled to hear it named.
  if (profileId !== manager.id && before && before.role !== role) {
    const previousRole = before.role;
    after(() =>
      emitNotifications([
        {
          profileId,
          kind: "role_changed",
          title: "Vai trò của bạn đã thay đổi",
          body: `${manager.full_name} đã đổi vai trò của bạn từ ${ROLE_LABELS[previousRole]} sang ${ROLE_LABELS[role]}.`,
          url: STAFF_PROFILE_URL,
          relatedId: profileId,
        },
      ])
    );
  }
  return { ok: true, data: undefined };
}

// Display/grouping only — never authorization (see lib/roles.ts's
// getRoleLabel comment). The CHECK constraint in migration 0051 is the
// real validation authority; mapStaffSecondaryRoleError translates its
// violation into the one Vietnamese message a manager could actually hit
// through this UI (the checkbox only ever appears for eligible roles, so
// this is a race-condition backstop, not the primary gate).
function mapStaffSecondaryRoleError(message: string): string {
  if (message.includes("profiles_secondary_role_valid_pair")) {
    return "Chỉ Giáo viên hoặc Quản sinh mới có thể kiêm nhiệm Trợ giảng";
  }
  return "Không thể cập nhật vai trò kiêm nhiệm";
}

// Null when nothing changed — the picker re-submitting the same value emits
// nothing. Added/removed/swapped each read differently, so they get their own
// sentence rather than one "X → Y" template with an empty side.
function describeSecondaryRoleChange(
  previous: Role | null,
  next: Role | null,
  actorName: string
): string | null {
  if (previous === next) return null;
  if (!next) {
    return previous ? `${actorName} đã gỡ vai trò kiêm nhiệm ${ROLE_LABELS[previous]} của bạn.` : null;
  }
  if (!previous) return `${actorName} đã thêm vai trò kiêm nhiệm ${ROLE_LABELS[next]} cho bạn.`;
  return `${actorName} đã đổi vai trò kiêm nhiệm của bạn từ ${ROLE_LABELS[previous]} sang ${ROLE_LABELS[next]}.`;
}

export async function updateStaffSecondaryRoleAction(
  profileId: string,
  secondaryRole: Role | null
): Promise<ActionResult> {
  const manager = await requireManager();
  const supabase = await createClient();
  const { data: before } = await supabase
    .from("profiles")
    .select("secondary_role")
    .eq("id", profileId)
    .maybeSingle<{ secondary_role: Role | null }>();

  const { data, error } = await supabase
    .from("profiles")
    .update({ secondary_role: secondaryRole })
    .eq("id", profileId)
    .select("id, secondary_role")
    .maybeSingle();

  if (error) return { ok: false, error: mapStaffSecondaryRoleError(error.message) };
  if (!data || data.secondary_role !== secondaryRole) {
    return {
      ok: false,
      error: "Không có quyền cập nhật vai trò kiêm nhiệm — hãy chắc chắn đã chạy đủ các migration mới nhất",
    };
  }

  revalidatePath("/manager");
  revalidatePath("/calendar");
  // Kiêm nhiệm decides, among other things, whether attendance reminders
  // apply to them (isReceptionistExempt) — worth naming in both directions.
  const body =
    profileId === manager.id || !before
      ? null
      : describeSecondaryRoleChange(before.secondary_role, secondaryRole, manager.full_name);
  if (body) {
    after(() =>
      emitNotifications([
        {
          profileId,
          kind: "secondary_role_changed",
          title: "Vai trò kiêm nhiệm của bạn đã thay đổi",
          body,
          url: STAFF_PROFILE_URL,
          relatedId: profileId,
        },
      ])
    );
  }
  return { ok: true, data: undefined };
}

// Soft-delete only — reversible, keeps every shift/request/attendance row
// intact for history. Login is blocked in requireProfile() (lib/auth.ts),
// not here. Restricted to technical, unlike updateStaffRoleAction/
// updateStaffBranchesAction above which any manager-tier role can call —
// deactivation is a much larger blast radius than a role/branch edit.
export async function deactivateStaffAction(
  profileId: string,
  deactivate: boolean
): Promise<ActionResult> {
  const manager = await requireManager();
  if (manager.role !== "technical") {
    return { ok: false, error: "Chỉ Kỹ thuật mới có quyền vô hiệu hoá tài khoản" };
  }
  if (profileId === manager.id) {
    return { ok: false, error: "Không thể tự vô hiệu hoá tài khoản của chính mình" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ deactivated_at: deactivate ? new Date().toISOString() : null })
    .eq("id", profileId);

  if (error) return { ok: false, error: "Không thể cập nhật trạng thái tài khoản" };

  revalidatePath("/manager");
  // Deactivation is the one event here the bell cannot actually deliver:
  // requireProfile() (lib/auth.ts) bounces a deactivated profile to
  // /auth/deactivated, so they can never open the header that renders it.
  // The row is still written — emitNotifications mirrors it as a web push in
  // the same call, and push is the only channel that still reaches them; the
  // stored row costs nothing and becomes readable the moment they are
  // reactivated, which is exactly when they want to see why they were locked
  // out. Self-deactivation is already refused above, so actor and subject can
  // never be the same person on either branch.
  // See actions/leave.ts's requestLeaveAction for why after() is required.
  after(() =>
    emitNotifications([
      deactivate
        ? {
            profileId,
            kind: "account_deactivated",
            title: "Tài khoản của bạn đã bị vô hiệu hoá",
            body: `${manager.full_name} đã vô hiệu hoá tài khoản của bạn. Bạn sẽ không thể đăng nhập cho đến khi tài khoản được kích hoạt lại — vui lòng liên hệ quản lý nếu cần hỗ trợ.`,
            // No url: there is nothing in the app they can open right now.
            relatedId: profileId,
          }
        : {
            profileId,
            kind: "account_reactivated",
            title: "Tài khoản của bạn đã được kích hoạt lại",
            body: `${manager.full_name} đã kích hoạt lại tài khoản của bạn. Bạn có thể đăng nhập và sử dụng ứng dụng như bình thường.`,
            url: "/calendar",
            relatedId: profileId,
          },
    ])
  );
  return { ok: true, data: undefined };
}
