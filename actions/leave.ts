"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, requireManager } from "@/lib/auth";
import { leaveRequestSchema } from "@/lib/validations/leave";
import { sendPushToLeaveApprovers } from "@/lib/push";
import { emitNotifications } from "@/lib/notifications-emit";
import type { ActionResult } from "@/types";

function mapLeaveError(message: string): string {
  const known = [
    "Bạn chưa được gán cơ sở làm việc",
    "Ngày kết thúc phải sau ngày bắt đầu",
    "Đến muộn / về sớm / nghỉ theo giờ chỉ áp dụng cho 1 ngày",
    "Vui lòng chọn giờ có mặt",
    "Vui lòng chọn giờ rời đi",
    "Vui lòng chọn giờ bắt đầu và kết thúc",
    "Chỉ quản lý mới được duyệt đơn nghỉ phép",
    "Bạn không có quyền duyệt đơn của nhân viên này",
    "Đơn nghỉ phép không hợp lệ hoặc đã được xử lý",
    "Không thể huỷ đơn này",
    "Chỉ Kỹ thuật mới có thể khôi phục đơn",
    "Đơn không hợp lệ hoặc đang chờ duyệt",
  ];
  return known.find((m) => message.includes(m)) ?? "Không thể xử lý đơn nghỉ phép";
}

function revalidateLeavePaths() {
  revalidatePath("/leave");
  revalidatePath("/manager");
  revalidatePath("/calendar");
  // Notification bell lives in app/(app)/layout.tsx, a shared segment —
  // revalidating a leaf path's "page" cache doesn't refetch it (layouts
  // persist across navigations by design). Without this, the bell's
  // badge/list can go stale after approve/reject until a hard reload.
  revalidatePath("/", "layout");
}

export async function requestLeaveAction(input: unknown): Promise<ActionResult> {
  const profile = await requireProfile();
  const parsed = leaveRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_leave", {
    p_start_date: parsed.data.start_date,
    p_end_date: parsed.data.end_date,
    p_reason: parsed.data.reason ?? null,
    p_request_type: parsed.data.request_type,
    p_start_time: parsed.data.start_time || null,
    p_end_time: parsed.data.end_time || null,
  });

  if (error) return { ok: false, error: mapLeaveError(error.message) };

  revalidateLeavePaths();
  // Vercel serverless functions don't keep running once the response is
  // sent — a bare `void asyncFn()` here can get cut off mid-flight before
  // web-push's HTTP call to the push service completes. after() registers
  // it with the platform's waitUntil so it's guaranteed to finish.
  after(() =>
    sendPushToLeaveApprovers(profile.role, {
      title: "Đơn nghỉ phép mới",
      body: `${profile.full_name} vừa gửi đơn xin nghỉ phép`,
      url: "/leave",
      tag: "leave",
    })
  );
  return { ok: true, data: undefined };
}

export async function respondToLeaveRequestAction(
  requestId: string,
  approve: boolean
): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("respond_to_leave_request", {
    p_id: requestId,
    p_approve: approve,
  });

  if (error) return { ok: false, error: mapLeaveError(error.message) };

  revalidateLeavePaths();
  if (data) {
    const targetId = (data as { profile_id: string }).profile_id;
    // emitNotifications replaces the bare sendPushToProfile that used to sit
    // here: it stores a row AND mirrors it as a push, so this is the same one
    // push as before plus a bell entry that outlives the three-day window the
    // derived half was limited to. See requestLeaveAction for why after().
    after(() =>
      emitNotifications([
        {
          profileId: targetId,
          kind: approve ? "leave_approved" : "leave_rejected",
          title: approve ? "Đơn nghỉ phép đã được duyệt" : "Đơn nghỉ phép bị từ chối",
          body: approve
            ? "Đơn xin nghỉ phép của bạn đã được duyệt"
            : "Đơn xin nghỉ phép của bạn đã bị từ chối",
          url: "/leave",
          relatedId: requestId,
        },
      ])
    );
  }
  return { ok: true, data: undefined };
}

export async function cancelLeaveRequestAction(requestId: string): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_leave_request", { p_id: requestId });

  if (error) return { ok: false, error: mapLeaveError(error.message) };

  revalidateLeavePaths();
  return { ok: true, data: undefined };
}

// Manager-side hard delete — distinct from cancelLeaveRequestAction above,
// which is the requester's own self-service cancel. This removes the row
// entirely and only works while pending; the RLS policy
// leave_requests_delete_manager (0050) is the real authorization boundary,
// this is just the thin wrapper. count: "exact" so a denied delete (RLS
// silently affecting 0 rows) surfaces as a real error instead of a false
// "Đã xoá" toast.
export async function deleteLeaveRequestAction(requestId: string): Promise<ActionResult> {
  await requireManager();
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("leave_requests")
    .delete({ count: "exact" })
    .eq("id", requestId)
    .eq("status", "pending");

  if (error) return { ok: false, error: "Không thể xoá đơn nghỉ phép" };
  if (!count) return { ok: false, error: "Bạn không có quyền xoá đơn này" };

  revalidateLeavePaths();
  return { ok: true, data: undefined };
}

// Technical-only: undoes an accidental Từ chối/Huỷ/Duyệt click, back to
// pending, content unchanged. The real gate is inside revert_leave_request
// itself (role = 'technical') — requireProfile() here is just the minimal
// "must be logged in" guard, same as respondToLeaveRequestAction.
export async function revertLeaveRequestAction(requestId: string): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revert_leave_request", { p_id: requestId });

  if (error) return { ok: false, error: mapLeaveError(error.message) };

  revalidateLeavePaths();
  return { ok: true, data: undefined };
}
