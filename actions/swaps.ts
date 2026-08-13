"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, requireManager } from "@/lib/auth";
import { swapRequestSchema } from "@/lib/validations/swap";
import { sendPushToProfile } from "@/lib/push";
import type { ActionResult } from "@/types";

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
  await requireProfile();
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("shift_swap_requests")
    .select("requester_id")
    .eq("id", requestId)
    .single();

  const { error } = await supabase.rpc("respond_to_swap_request", {
    p_request_id: requestId,
    p_accept: accept,
  });

  if (error) return { ok: false, error: mapSwapError(error.message) };

  revalidateSwapPaths();
  if (existing) {
    const requesterId = existing.requester_id;
    after(() =>
      sendPushToProfile(requesterId, {
        title: accept ? "Yêu cầu đổi ca được chấp nhận" : "Yêu cầu đổi ca bị từ chối",
        body: accept ? "Đồng nghiệp đã đồng ý đổi ca với bạn" : "Yêu cầu đổi ca của bạn đã bị từ chối",
        url: "/swaps",
        tag: "swap",
      })
    );
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
  await requireManager();
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("shift_swap_requests")
    .delete({ count: "exact" })
    .eq("id", requestId)
    .eq("status", "pending")
    .not("target_id", "is", null);

  if (error) return { ok: false, error: "Không thể xoá yêu cầu đổi ca" };
  if (!count) return { ok: false, error: "Bạn không có quyền xoá đơn này" };

  revalidateSwapPaths();
  return { ok: true, data: undefined };
}

// Technical-only: undoes an accidental Từ chối/Huỷ/Đồng ý click. If the
// swap was accepted, revert_swap_request also swaps assignee_id back on
// the shift(s) involved — but only if neither shift has been reassigned
// again since. Auto-cancelled sibling swaps from the original accept's
// cascade are deliberately left cancelled (see design spec §Phạm vi).
export async function revertSwapRequestAction(requestId: string): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revert_swap_request", { p_request_id: requestId });

  if (error) return { ok: false, error: mapSwapError(error.message) };

  revalidateSwapPaths();
  return { ok: true, data: undefined };
}
