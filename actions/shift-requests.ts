"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, requireManager } from "@/lib/auth";
import { isShiftRequestApprover } from "@/lib/roles";
import { getRemoteBranchId } from "@/lib/branches";
import { shiftRequestSchema } from "@/lib/validations/shift-request";
import { sendPushToShiftRequestApprovers } from "@/lib/push";
import { emitNotifications } from "@/lib/notifications-emit";
import type { ActionResult } from "@/types";

function mapShiftRequestError(message: string): string {
  if (message.includes("Giờ kết thúc phải sau giờ bắt đầu")) {
    return "Giờ kết thúc phải sau giờ bắt đầu";
  }
  if (message.includes("shifts_no_overlap")) {
    return "Ca này trùng giờ với một ca đã được duyệt của bạn";
  }
  if (message.includes("Đã có quản sinh khác trực ca bắt đầu cùng giờ này")) {
    return "Đã có quản sinh khác trực ca bắt đầu cùng giờ này";
  }
  return "Không thể gửi đăng ký ca làm";
}

// The shift-request RPCs raise their own clean, human-facing Vietnamese
// messages (see 0010/0019/0027) and those should reach the user verbatim —
// but anything else arriving here is a raw Postgres engine error (type
// mismatches, constraint names, "permission denied for table ..."), which
// is meaningless to staff and leaks schema internals. So: allowlist the
// known RPC exceptions, translate the constraint names we expect, and mask
// everything else behind `fallback`.
const SHIFT_RPC_MESSAGES = [
  "Chưa đăng nhập",
  "Đơn đăng ký không còn hiệu lực",
  "Bạn không có quyền duyệt đăng ký ca này",
  "Không thể huỷ đơn này",
  "Nhân viên chưa được gán cơ sở",
  "Giờ kết thúc phải sau giờ bắt đầu",
  "Vui lòng chọn cơ sở",
  "Đã có quản sinh khác trực ca bắt đầu cùng giờ này",
  "Chỉ Kỹ thuật mới có thể khôi phục đơn",
  "Đơn không hợp lệ hoặc đang chờ duyệt",
  "Ca đã có chấm công — không thể khôi phục tự động",
  "Ca đã bị đổi cho người khác — không thể khôi phục tự động",
  "Ca đã liên quan đến yêu cầu đổi ca — không thể khôi phục tự động",
  "Ca đã liên quan đến giải trình công — không thể khôi phục tự động",
  "Đơn duyệt trước khi có tính năng khôi phục — không thể khôi phục tự động",
];

function mapShiftRpcError(message: string, fallback: string): string {
  const known = SHIFT_RPC_MESSAGES.find((m) => message.includes(m));
  if (known) return known;
  if (message.includes("shifts_no_overlap")) {
    return "Ca này trùng giờ với một ca đã được duyệt của nhân viên";
  }
  if (message.includes("shifts_time_valid")) {
    return "Giờ kết thúc phải sau giờ bắt đầu";
  }
  return fallback;
}

function revalidateShiftRequestPaths() {
  revalidatePath("/calendar");
  revalidatePath("/manager");
  // See actions/leave.ts's revalidateLeavePaths for why this is needed —
  // the notification bell is in the shared app/(app)/layout.tsx.
  revalidatePath("/", "layout");
}

export async function requestShiftAction(input: unknown): Promise<ActionResult> {
  const profile = await requireProfile();
  const parsed = shiftRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const supabase = await createClient();
  const branchId =
    parsed.data.branch_id ?? (parsed.data.shift_type === "remote" ? await getRemoteBranchId() : undefined);
  const { error } = await supabase.rpc("request_shift", {
    p_start_at: new Date(parsed.data.start_at).toISOString(),
    p_end_at: new Date(parsed.data.end_at).toISOString(),
    p_branch_id: branchId,
    p_note: parsed.data.note || null,
    p_shift_type: parsed.data.shift_type,
  });

  if (error) return { ok: false, error: mapShiftRequestError(error.message) };

  revalidateShiftRequestPaths();
  // See actions/leave.ts's requestLeaveAction for why this is wrapped in
  // after() rather than fire-and-forget.
  after(() =>
    sendPushToShiftRequestApprovers(profile.role, {
      title: "Đăng ký ca làm mới",
      body: `${profile.full_name} vừa gửi đăng ký ca làm`,
      url: "/manager",
      tag: "shift-request",
    })
  );
  return { ok: true, data: undefined };
}

export async function cancelShiftRequestAction(id: string): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_shift_request", { p_id: id });

  if (error) {
    return { ok: false, error: mapShiftRpcError(error.message, "Không thể huỷ đăng ký ca này") };
  }

  revalidateShiftRequestPaths();
  return { ok: true, data: undefined };
}

export async function respondToShiftRequestAction(
  id: string,
  approve: boolean
): Promise<ActionResult> {
  const profile = await requireProfile();
  if (!isShiftRequestApprover(profile.role)) {
    return { ok: false, error: "Bạn không có quyền duyệt đăng ký ca này" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("respond_to_shift_request", {
    p_id: id,
    p_approve: approve,
  });

  if (error) {
    return { ok: false, error: mapShiftRpcError(error.message, "Không thể xử lý đăng ký ca này") };
  }

  revalidateShiftRequestPaths();
  if (data) {
    const targetId = (data as { profile_id: string }).profile_id;
    // Stored row + push, replacing the push-only call that used to be here —
    // see the same change in actions/leave.ts.
    after(() =>
      emitNotifications([
        {
          profileId: targetId,
          kind: approve ? "shift_request_approved" : "shift_request_rejected",
          title: approve ? "Đăng ký ca làm đã được duyệt" : "Đăng ký ca làm bị từ chối",
          body: approve
            ? "Đăng ký ca làm của bạn đã được duyệt"
            : "Đăng ký ca làm của bạn đã bị từ chối",
          url: "/calendar",
          relatedId: id,
        },
      ])
    );
  }
  return { ok: true, data: undefined };
}

// Manager-side hard delete — distinct from cancelShiftRequestAction above,
// which is the requester's own self-service cancel. Only works while
// pending; RLS policy shift_requests_delete_manager (0050) is the real
// authorization boundary. count: "exact" so a denied delete surfaces as a
// real error instead of a false "Đã xoá" toast.
export async function deleteShiftRequestAction(id: string): Promise<ActionResult> {
  await requireManager();
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("shift_requests")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("status", "pending");

  if (error) return { ok: false, error: "Không thể xoá đăng ký ca làm" };
  if (!count) return { ok: false, error: "Bạn không có quyền xoá đơn này" };

  revalidateShiftRequestPaths();
  return { ok: true, data: undefined };
}

// Technical-only: undoes an accidental Từ chối/Huỷ/Duyệt click. If the
// request was approved, revert_shift_request also deletes the shift it
// created — but only if nothing has touched that shift since (see the RPC
// for the exact guards). requireProfile() is the minimal guard; the real
// role check lives in the RPC.
export async function revertShiftRequestAction(id: string): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revert_shift_request", { p_id: id });

  if (error) {
    return { ok: false, error: mapShiftRpcError(error.message, "Không thể khôi phục đăng ký ca này") };
  }

  revalidateShiftRequestPaths();
  return { ok: true, data: undefined };
}
