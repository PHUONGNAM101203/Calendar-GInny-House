"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, requireManager } from "@/lib/auth";
import { swapRequestSchema } from "@/lib/validations/swap";
import { sendPushToProfile } from "@/lib/push";
import { emitNotifications, formatShiftWindow } from "@/lib/notifications-emit";
import type { ActionResult } from "@/types";

// Shape of the pre-RPC read in respondToSwapRequestAction. The embeds are
// many-to-one via an explicit FK hint, so PostgREST returns an object (or
// null for an open swap, which has no target_shift_id), not an array — the
// untyped Supabase client cannot infer that on its own.
type SwapShiftWindow = { start_at: string; end_at: string };

// The same read, widened, for the two manager-side actions at the bottom of
// this file: they need the requester's name (to address the target), the
// status (to know whether shifts actually moved) and both windows.
type SwapSubject = {
  requester_id: string;
  target_id: string | null;
  status: string;
  requester: { full_name: string } | null;
  requester_shift: SwapShiftWindow | null;
};

type SwapResponseContext = {
  requester_id: string;
  // null on an open swap — nobody was named when it was raised.
  target: { full_name: string } | null;
  requester_shift: SwapShiftWindow | null;
  target_shift: SwapShiftWindow | null;
};

function mapSwapError(message: string): string {
  const known = [
    "Bạn chỉ có thể yêu cầu đổi ca của chính mình",
    "Không thể đổi ca đã bắt đầu",
    "Ca này đã có yêu cầu đổi đang chờ",
    "Đồng nghiệp không thuộc cơ sở của bạn",
    "Ca được chọn không hợp lệ",
    "Không thể đổi ca với chính mình",
    "Yêu cầu không còn hiệu lực",
    "Yêu cầu không thuộc cơ sở của bạn",
    "Bạn không phải người được yêu cầu",
    "Không thể tự nhận ca của mình",
    "Ca gốc đã thay đổi, yêu cầu không còn hợp lệ",
    "Ca đối ứng đã thay đổi, yêu cầu không còn hợp lệ",
    "Không có quyền huỷ yêu cầu này",
    "Chỉ Kỹ thuật mới có thể khôi phục đơn",
    "Đơn không hợp lệ hoặc đang chờ duyệt",
    "Không xác định được người đã nhận ca — không thể khôi phục tự động",
    "Ca đã bị thay đổi tiếp — không thể khôi phục tự động",
    "Ca này đã có yêu cầu đổi ca khác đang chờ duyệt — không thể khôi phục tự động",
  ];
  return known.find((m) => message.includes(m)) ?? "Không thể thực hiện yêu cầu đổi ca";
}

function revalidateSwapPaths() {
  revalidatePath("/calendar");
  revalidatePath("/swaps");
  revalidatePath("/manager");
  // See actions/leave.ts's revalidateLeavePaths for why this is needed —
  // the notification bell is in the shared app/(app)/layout.tsx.
  revalidatePath("/", "layout");
}

// Read before the manager-side mutations below, never after: a delete leaves
// no row at all, and a revert rewrites the status the copy depends on.
async function readSwapSubject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  requestId: string
): Promise<SwapSubject | null> {
  const { data } = await supabase
    .from("shift_swap_requests")
    .select(
      "requester_id, target_id, status, requester:profiles!requester_id(full_name), requester_shift:shifts!requester_shift_id(start_at, end_at)"
    )
    .eq("id", requestId)
    .maybeSingle<SwapSubject>();
  return data ?? null;
}

// "ca 08:00–12:00 ngày 22/08/2026" — baked into the body so it still names
// the right shift once the request row (and possibly the shift) is gone.
function describeSwapShift(subject: SwapSubject): string {
  return subject.requester_shift
    ? `ca ${formatShiftWindow(subject.requester_shift.start_at, subject.requester_shift.end_at)}`
    : "một ca làm việc";
}

export async function createSwapRequestAction(input: unknown): Promise<ActionResult> {
  const profile = await requireProfile();
  const parsed = swapRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_shift_swap", {
    p_shift_id: parsed.data.shift_id,
    p_target_id: parsed.data.target_id ?? null,
    p_target_shift_id: parsed.data.target_shift_id ?? null,
    p_message: parsed.data.message ?? null,
  });

  if (error) return { ok: false, error: mapSwapError(error.message) };

  revalidateSwapPaths();
  // Open swaps (no target_id) have no single recipient — skip push rather
  // than notifying every colleague at the branch.
  if (parsed.data.target_id) {
    const targetId = parsed.data.target_id;
    // See actions/leave.ts's requestLeaveAction for why this is wrapped in
    // after() rather than fire-and-forget.
    after(() =>
      sendPushToProfile(targetId, {
        title: "Yêu cầu đổi ca mới",
        body: `${profile.full_name} muốn đổi ca với bạn`,
        url: "/swaps",
        tag: "swap",
      })
    );
  }
  return { ok: true, data: undefined };
}

export async function respondToSwapRequestAction(
  requestId: string,
  accept: boolean
): Promise<ActionResult> {
  const responder = await requireProfile();
  const supabase = await createClient();
  // Read the request AND both shift windows before the RPC runs. Deliberately
  // before: respond_to_swap_request moves assignee_id on the shift(s), so the
  // same read afterwards would describe the post-swap world and attribute the
  // wrong shift to the wrong person. One round trip — the embeds ride along
  // with the requester_id this select already needed.
  const { data: existing } = await supabase
    .from("shift_swap_requests")
    .select(
      "requester_id, target:profiles!target_id(full_name), requester_shift:shifts!requester_shift_id(start_at, end_at), target_shift:shifts!target_shift_id(start_at, end_at)"
    )
    .eq("id", requestId)
    .single<SwapResponseContext>();

  const { error } = await supabase.rpc("respond_to_swap_request", {
    p_request_id: requestId,
    p_accept: accept,
  });

  if (error) return { ok: false, error: mapSwapError(error.message) };

  revalidateSwapPaths();
  if (existing) {
    const requesterId = existing.requester_id;
    if (accept) {
      // Acceptance is the only branch that gets a stored notification: the
      // requester's shift has just changed hands and, on a two-way swap, they
      // silently now own a shift they never registered for. Windows are baked
      // into the body (formatShiftWindow) so the text still reads correctly
      // once the shift rows have moved on or been deleted.
      const given = existing.requester_shift;
      const received = existing.target_shift;
      // Who actually ends up holding the shift — NOT necessarily the caller.
      // This mirrors respond_to_swap_request's own `v_taker`: on a targeted
      // request the taker is target_id, and a manager holding `approve_swap`
      // (can_approve_swap_request, 0055) may accept on their behalf, so naming
      // the caller there would name someone who received nothing. Only on an
      // open swap (target_id null) is the taker the caller, and the RPC
      // forbids the requester claiming their own shift, so it is never "you".
      const taker = existing.target?.full_name ?? responder.full_name ?? "đồng nghiệp";
      const body = !given
        ? "Yêu cầu đổi ca của bạn đã được chấp nhận"
        : received
          ? `Ca ${formatShiftWindow(given.start_at, given.end_at)} của bạn đã được chuyển cho ${taker}. Đổi lại, bạn nhận ca ${formatShiftWindow(received.start_at, received.end_at)}.`
          : `Ca ${formatShiftWindow(given.start_at, given.end_at)} của bạn đã được chuyển cho ${taker}.`;

      // emitNotifications mirrors the row as a push itself, so this replaces
      // the old sendPushToProfile on this branch rather than joining it —
      // emitting both would land two OS notifications for one event, under
      // different tags, seconds apart. The push survives, with better copy.
      // See actions/leave.ts's requestLeaveAction for why after() is required.
      after(() =>
        emitNotifications([
          {
            profileId: requesterId,
            kind: "swap_accepted",
            title: "Đổi ca thành công",
            body,
            // /calendar, not /swaps: the request is resolved and what the
            // requester needs to look at now is the shift they hold.
            url: "/calendar",
            relatedId: requestId,
          },
        ])
      );
    } else {
      after(() =>
        sendPushToProfile(requesterId, {
          title: "Yêu cầu đổi ca bị từ chối",
          body: "Yêu cầu đổi ca của bạn đã bị từ chối",
          url: "/swaps",
          tag: "swap",
        })
      );
    }
  }
  return { ok: true, data: undefined };
}

export async function cancelSwapRequestAction(requestId: string): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_swap_request", {
    p_request_id: requestId,
  });

  if (error) return { ok: false, error: mapSwapError(error.message) };

  revalidateSwapPaths();
  return { ok: true, data: undefined };
}

// Manager-side hard delete — distinct from cancelSwapRequestAction above,
// which is the requester's own self-service cancel. Only works while
// pending and only for requests with a specific target_id ("open" requests
// stay peer-claim-only, matching canApproveSwapRequestFor's own
// restriction). RLS policy shift_swap_requests_delete_manager (0050) is the
// real authorization boundary. count: "exact" so a denied delete surfaces
// as a real error instead of a false "Đã xoá" toast.
export async function deleteSwapRequestAction(requestId: string): Promise<ActionResult> {
  const manager = await requireManager();
  const supabase = await createClient();
  const subject = await readSwapSubject(supabase, requestId);

  const { error, count } = await supabase
    .from("shift_swap_requests")
    .delete({ count: "exact" })
    .eq("id", requestId)
    .eq("status", "pending")
    .not("target_id", "is", null);

  if (error) return { ok: false, error: "Không thể xoá yêu cầu đổi ca" };
  if (!count) return { ok: false, error: "Bạn không có quyền xoá đơn này" };

  revalidateSwapPaths();
  // Both sides were waiting on this request and it has just vanished from
  // their lists with no trace. Only ever pending here, so no shift moved —
  // the copy says so rather than leaving them guessing who holds the ca. A
  // manager may delete a request they raised or were the target of, so the
  // actor is filtered out of the recipients.
  if (subject) {
    const where = describeSwapShift(subject);
    const requesterName = subject.requester?.full_name ?? "đồng nghiệp";
    const drafts = [
      {
        profileId: subject.requester_id,
        kind: "swap_deleted" as const,
        title: "Yêu cầu đổi ca đã bị xoá",
        body: `${manager.full_name} đã xoá yêu cầu đổi ${where} của bạn. Ca này vẫn thuộc về bạn.`,
        url: "/swaps",
        relatedId: requestId,
      },
      ...(subject.target_id
        ? [
            {
              profileId: subject.target_id,
              kind: "swap_deleted" as const,
              title: "Yêu cầu đổi ca đã bị xoá",
              body: `${manager.full_name} đã xoá yêu cầu đổi ${where} mà ${requesterName} gửi cho bạn. Bạn không cần phản hồi nữa.`,
              url: "/swaps",
              relatedId: requestId,
            },
          ]
        : []),
    ].filter((draft) => draft.profileId !== manager.id);

    // See actions/leave.ts's requestLeaveAction for why after() is required.
    after(() => emitNotifications(drafts));
  }
  return { ok: true, data: undefined };
}

// Technical-only: undoes an accidental Từ chối/Huỷ/Đồng ý click. If the
// swap was accepted, revert_swap_request also swaps assignee_id back on
// the shift(s) involved — but only if neither shift has been reassigned
// again since. Auto-cancelled sibling swaps from the original accept's
// cascade are deliberately left cancelled (see design spec §Phạm vi).
export async function revertSwapRequestAction(requestId: string): Promise<ActionResult> {
  const responder = await requireProfile();
  const supabase = await createClient();
  // Before the RPC: it sets status back to 'pending', so a later read could
  // no longer tell whether shifts were actually moved back (accepted) or the
  // revert merely undid a từ chối/huỷ click.
  const subject = await readSwapSubject(supabase, requestId);

  const { error } = await supabase.rpc("revert_swap_request", { p_request_id: requestId });

  if (error) return { ok: false, error: mapSwapError(error.message) };

  revalidateSwapPaths();
  if (subject) {
    const where = describeSwapShift(subject);
    const wasAccepted = subject.status === "accepted";
    const requesterName = subject.requester?.full_name ?? "đồng nghiệp";
    const movedBack = wasAccepted
      ? " Các ca liên quan đã được trả về như trước khi đổi."
      : "";
    const drafts = [
      {
        profileId: subject.requester_id,
        kind: "swap_reverted" as const,
        title: "Yêu cầu đổi ca được khôi phục",
        body: `${responder.full_name} đã khôi phục yêu cầu đổi ${where} của bạn về trạng thái chờ duyệt.${movedBack}`,
        url: "/swaps",
        relatedId: requestId,
      },
      // The target is only told when the accept was undone: that is the case
      // where a shift they were holding has just moved off their calendar.
      // On a reverted từ chối nothing of theirs changed except a request
      // reappearing in their list, which /swaps already shows.
      ...(wasAccepted && subject.target_id
        ? [
            {
              profileId: subject.target_id,
              kind: "swap_reverted" as const,
              title: "Yêu cầu đổi ca được khôi phục",
              body: `${responder.full_name} đã khôi phục yêu cầu đổi ${where} của ${requesterName} về trạng thái chờ duyệt. Các ca liên quan đã được trả về như trước khi đổi.`,
              url: "/swaps",
              relatedId: requestId,
            },
          ]
        : []),
    ].filter((draft) => draft.profileId !== responder.id);

    // See actions/leave.ts's requestLeaveAction for why after() is required.
    after(() => emitNotifications(drafts));
  }
  return { ok: true, data: undefined };
}
