"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { leaveRequestSchema } from "@/lib/validations/leave";
import { sendPushToLeaveApprovers, sendPushToProfile } from "@/lib/push";
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
  void sendPushToLeaveApprovers(profile.role, {
    title: "Đơn nghỉ phép mới",
    body: `${profile.full_name} vừa gửi đơn xin nghỉ phép`,
    url: "/leave",
    tag: "leave",
  });
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
    void sendPushToProfile((data as { profile_id: string }).profile_id, {
      title: approve ? "Đơn nghỉ phép đã được duyệt" : "Đơn nghỉ phép bị từ chối",
      body: approve ? "Đơn xin nghỉ phép của bạn đã được duyệt" : "Đơn xin nghỉ phép của bạn đã bị từ chối",
      url: "/leave",
      tag: "leave",
    });
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
