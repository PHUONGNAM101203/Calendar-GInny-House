"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth";
import { shiftSchema } from "@/lib/validations/shift";
import { isManagerRole, canCreateShiftFor } from "@/lib/roles";
import { getGroupPermissions } from "@/lib/permissions-server";
import { getRemoteBranchId } from "@/lib/branches";
import { emitNotifications, formatShiftWindow, type NotificationDraft } from "@/lib/notifications-emit";
import type { ActionResult, Role } from "@/types";

// Defense in depth — ShiftFormDialog's picker already narrows assignee
// options to the caller's group and branch, but a manager could still
// bypass the client. Looks up the assignee's role once and checks both
// group-scoping (canCreateShiftFor) and branch membership off that single
// lookup. A management-tier assignee has no profile_branches rows by design
// and is exempt from the branch check (they cover every branch), matching
// that convention everywhere else in the app. isRemote skips the branch
// check entirely — nobody is really a "member" of the synthetic Remote
// branch (0066_remote_branch.sql), so membership can't apply there.
async function assertAssigneeAllowed(
  supabase: Awaited<ReturnType<typeof createClient>>,
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

// "chuyển từ Cơ sở 1 sang Cơ sở 2", for a notification body — or null if
// neither name resolves, so the caller can fall back rather than print a uuid
// at a staff member. Queried directly rather than via getBranches(), which
// filters out the synthetic Remote branch (0066) — a shift genuinely can move
// to or from Remote, and that move is exactly what needs describing.
async function describeBranchMove(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fromId: string,
  toId: string
): Promise<string | null> {
  const { data } = await supabase.from("branches").select("id, name").in("id", [fromId, toId]);
  const nameOf = (branchId: string) => data?.find((branch) => branch.id === branchId)?.name;
  const from = nameOf(fromId);
  const to = nameOf(toId);
  if (!to) return null;
  return from ? `chuyển từ ${from} sang ${to}` : `chuyển sang ${to}`;
}

async function resolveBranchId(shiftType: string, branchId: string | undefined): Promise<string> {
  if (branchId) return branchId;
  if (shiftType === "remote") return getRemoteBranchId();
  throw new Error("Vui lòng chọn cơ sở");
}

function mapShiftError(message: string): string {
  if (message.includes("shifts_no_overlap")) {
    return "Nhân viên này đã có ca trùng giờ";
  }
  if (message.includes("shifts_time_valid")) {
    return "Giờ kết thúc phải sau giờ bắt đầu";
  }
  if (message.includes("Nhân viên chưa được gán cơ sở")) {
    return "Nhân viên chưa được gán cơ sở";
  }
  if (message.includes("Đã có quản sinh khác trực ca bắt đầu cùng giờ này")) {
    return "Đã có quản sinh khác trực ca bắt đầu cùng giờ này";
  }
  // Safety net if assertAssigneeAllowed's app-level check gets bypassed by a
  // race (assignee's role changed between form-open and submit) — the RLS
  // policy (can_manage_shift_for, 0043) is the real boundary either way.
  if (message.includes("row-level security policy") || message.includes("permission denied")) {
    return "Bạn không có quyền xếp ca cho nhân viên này";
  }
  return "Không thể lưu ca làm việc";
}

export async function createShiftAction(input: unknown): Promise<ActionResult> {
  const manager = await requireManager();
  const parsed = shiftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const branchId = await resolveBranchId(parsed.data.shift_type, parsed.data.branch_id);

  const assigneeError = await assertAssigneeAllowed(
    supabase,
    manager.role,
    parsed.data.assignee_id,
    branchId,
    parsed.data.shift_type === "remote"
  );
  if (assigneeError) return { ok: false, error: assigneeError };

  // .select().maybeSingle() only to recover the new row's id for the
  // notification's related_id. maybeSingle, not single: if the returning
  // select is ever refused the insert itself still succeeded, and a missing
  // related_id must not turn a saved shift into an error.
  const { data: created, error } = await supabase
    .from("shifts")
    .insert({
      assignee_id: parsed.data.assignee_id,
      branch_id: branchId,
      start_at: parsed.data.start_at,
      end_at: parsed.data.end_at,
      shift_type: parsed.data.shift_type,
      // manager.id, not a second auth.getUser(). requireManager() above already
      // resolved this identity; re-fetching it cost a full network round-trip to
      // the auth server on every shift creation for a value already in hand. It
      // also removes a `user!` non-null assertion that was only safe by accident.
      created_by: manager.id,
    })
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: mapShiftError(error.message) };

  revalidatePath("/calendar");
  revalidatePath("/manager");
  after(() =>
    emitNotifications([
      {
        profileId: parsed.data.assignee_id,
        kind: "shift_assigned",
        title: "Ca làm việc mới",
        body: `Bạn được xếp ca ${formatShiftWindow(parsed.data.start_at, parsed.data.end_at)}`,
        url: "/calendar",
        relatedId: created?.id ?? null,
      },
    ])
  );
  return { ok: true, data: undefined };
}

export async function updateShiftAction(
  id: string,
  input: unknown
): Promise<ActionResult> {
  const manager = await requireManager();
  const parsed = shiftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const branchId = await resolveBranchId(parsed.data.shift_type, parsed.data.branch_id);

  const assigneeError = await assertAssigneeAllowed(
    supabase,
    manager.role,
    parsed.data.assignee_id,
    branchId,
    parsed.data.shift_type === "remote"
  );
  if (assigneeError) return { ok: false, error: assigneeError };

  // Read the row before overwriting it: the previous assignee and the
  // previous time window only exist until the update lands, and both are
  // needed to tell the person who is silently losing this shift which shift
  // they lost.
  const { data: previous } = await supabase
    .from("shifts")
    .select("assignee_id, start_at, end_at, branch_id, shift_type")
    .eq("id", id)
    .maybeSingle();

  const { error, count } = await supabase
    .from("shifts")
    .update(
      {
        assignee_id: parsed.data.assignee_id,
        branch_id: branchId,
        start_at: parsed.data.start_at,
        end_at: parsed.data.end_at,
        shift_type: parsed.data.shift_type,
        note: parsed.data.note || null,
      },
      // An RLS-denied update reports no error and touches no rows. Without
      // this the action returned ok and the dialog toasted "Đã cập nhật ca
      // làm việc" for a shift that never moved — the same bug fixed in
      // deleteShiftAction below, so it is fixed the same way here.
      { count: "exact" }
    )
    .eq("id", id);

  if (error) return { ok: false, error: mapShiftError(error.message) };
  // Strictly `=== 0`, not falsy. postgrest-js parses count from the
  // content-range header in PostgrestBuilder, shared by every verb — verified
  // against the live database that a zero-match PATCH really does return the
  // number 0 (not null), even on a 204. Should that ever stop holding, null
  // means "unknown", and an unknown must not be read as a refusal: that would
  // fail every legitimate edit.
  if (count === 0) return { ok: false, error: "Bạn không có quyền sửa ca làm việc này" };

  revalidatePath("/calendar");
  revalidatePath("/manager");

  if (previous) {
    const newWindow = formatShiftWindow(parsed.data.start_at, parsed.data.end_at);
    const reassigned = previous.assignee_id !== parsed.data.assignee_id;
    // A note-only edit is not worth a notification; a change of time, branch
    // or shift type is what the person actually needs to know about.
    const materiallyChanged =
      previous.start_at !== parsed.data.start_at ||
      previous.end_at !== parsed.data.end_at ||
      previous.branch_id !== branchId ||
      previous.shift_type !== parsed.data.shift_type;

    const drafts: NotificationDraft[] = [];
    if (reassigned) {
      drafts.push({
        profileId: parsed.data.assignee_id,
        kind: "shift_assigned",
        title: "Ca làm việc mới",
        body: `Bạn được xếp ca ${newWindow}`,
        url: "/calendar",
        relatedId: id,
      });
      drafts.push({
        profileId: previous.assignee_id,
        kind: "shift_unassigned",
        title: "Ca làm việc được chuyển",
        body: `Ca ${formatShiftWindow(previous.start_at, previous.end_at)} không còn là ca của bạn`,
        url: "/calendar",
        relatedId: id,
      });
    } else if (materiallyChanged) {
      const timeChanged =
        previous.start_at !== parsed.data.start_at || previous.end_at !== parsed.data.end_at;
      const branchChanged = previous.branch_id !== branchId;
      const oldWindow = formatShiftWindow(previous.start_at, previous.end_at);
      const move = branchChanged ? await describeBranchMove(supabase, previous.branch_id, branchId) : null;

      // The body has to name what actually changed. Always quoting only the
      // new window meant a branch-only move read "Ca của bạn được đổi thành
      // <the exact window they already had>" — the staff member concludes
      // nothing changed and turns up at the wrong cơ sở. Quoting the old
      // window also disambiguates which shift moved for anyone working two
      // that day.
      const body =
        timeChanged && move
          ? `Ca ${oldWindow} của bạn được đổi thành ${newWindow}, ${move}`
          : timeChanged
            ? `Ca ${oldWindow} của bạn được đổi thành ${newWindow}`
            : move
              ? `Ca ${newWindow} của bạn được ${move}`
              : `Ca ${newWindow} của bạn vừa được cập nhật`;

      drafts.push({
        profileId: parsed.data.assignee_id,
        kind: "shift_updated",
        title: branchChanged && !timeChanged ? "Ca làm việc đổi cơ sở" : "Ca làm việc được cập nhật",
        body,
        url: "/calendar",
        relatedId: id,
      });
    }
    if (drafts.length) after(() => emitNotifications(drafts));
  }

  return { ok: true, data: undefined };
}

export async function deleteShiftAction(id: string): Promise<ActionResult> {
  await requireManager();
  const supabase = await createClient();

  // Read before deleting — after the delete there is nothing left to say
  // which shift was removed, and the stored notification has to name it.
  const { data: removed } = await supabase
    .from("shifts")
    .select("assignee_id, start_at, end_at")
    .eq("id", id)
    .maybeSingle();

  // count: "exact" so an RLS-denied delete surfaces as a real error instead
  // of a false "Đã xoá" toast — same pattern as deleteShiftRequestAction in
  // actions/shift-requests.ts. Without it a manager outside their scope was
  // told the shift was gone while it was still on the calendar.
  const { error, count } = await supabase.from("shifts").delete({ count: "exact" }).eq("id", id);

  if (error) return { ok: false, error: "Không thể xoá ca làm việc" };
  if (!count) return { ok: false, error: "Bạn không có quyền xoá ca làm việc này" };

  revalidatePath("/calendar");
  revalidatePath("/manager");
  if (removed) {
    after(() =>
      emitNotifications([
        {
          profileId: removed.assignee_id,
          kind: "shift_deleted",
          title: "Ca làm việc bị xoá",
          body: `Ca ${formatShiftWindow(removed.start_at, removed.end_at)} của bạn đã bị xoá`,
          url: "/calendar",
          relatedId: id,
        },
      ])
    );
  }
  return { ok: true, data: undefined };
}
