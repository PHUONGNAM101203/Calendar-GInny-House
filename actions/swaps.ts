"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
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
    void sendPushToProfile(parsed.data.target_id, {
      title: "Yêu cầu đổi ca mới",
      body: `${profile.full_name} muốn đổi ca với bạn`,
      url: "/swaps",
      tag: "swap",
    });
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
    void sendPushToProfile(existing.requester_id, {
      title: accept ? "Yêu cầu đổi ca được chấp nhận" : "Yêu cầu đổi ca bị từ chối",
      body: accept ? "Đồng nghiệp đã đồng ý đổi ca với bạn" : "Yêu cầu đổi ca của bạn đã bị từ chối",
      url: "/swaps",
      tag: "swap",
    });
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
