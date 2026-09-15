"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, requireManager } from "@/lib/auth";
import { isShiftRequestApprover } from "@/lib/roles";
import { getRemoteBranchId } from "@/lib/branches";
import { shiftRequestSchema, shiftChangeSchema } from "@/lib/validations/shift-request";
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
  // Đơn đổi giờ ca (0086) — cả lúc gửi, lúc duyệt và lúc khôi phục.
  "Bạn chỉ có thể đổi giờ ca của chính mình",
  "Không thể đổi giờ ca đã bắt đầu",
  "Khung giờ mới phải ở tương lai",
  "Bạn không thuộc cơ sở này",
  "Ca đã có chấm công — không thể đổi giờ",
  "Ca này đã có yêu cầu đổi giờ đang chờ",
  "Ca này đang có yêu cầu đổi ca chờ duyệt",
  "Ca gốc không còn tồn tại — đơn không còn hiệu lực",
  "Ca gốc đã đổi sang người khác — đơn không còn hiệu lực",
  "Ca gốc đã bắt đầu — không thể đổi giờ",
  "Ca gốc đã bị xoá — không thể khôi phục tự động",
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
    // "" -> null: rỗng nghĩa là "theo vai trò gốc". Đăng ký ca lễ tân thì RPC
    // bỏ qua luật một-suất-quản-sinh, đó chính là thứ đang chặn oan một quản
    // sinh kiêm lễ tân muốn nhận ca trực quầy.
    p_covering_role: parsed.data.covering_role || null,
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

// Đổi giờ ca của chính mình — dạng thứ hai của "đổi ca", bên cạnh đổi cho
// người khác (actions/swaps.ts). Cố tình đi qua chính bảng shift_requests
// thay vì một đường ống riêng: một đơn xin đổi giờ đúng là "một khung ca đề
// xuất đang chờ duyệt", nên nó thừa hưởng nguyên người duyệt, RLS, danh sách
// chờ duyệt, thông báo, huỷ và khôi phục. Xem 0086.
export async function requestShiftChangeAction(input: unknown): Promise<ActionResult> {
  const profile = await requireProfile();
  const parsed = shiftChangeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_shift_change", {
    p_shift_id: parsed.data.shift_id,
    p_start_at: new Date(parsed.data.start_at).toISOString(),
    p_end_at: new Date(parsed.data.end_at).toISOString(),
    p_branch_id: parsed.data.branch_id,
    p_note: parsed.data.note || null,
  });

  if (error) {
    return { ok: false, error: mapShiftRpcError(error.message, "Không thể gửi yêu cầu đổi giờ ca") };
  }

  revalidateShiftRequestPaths();
  // See actions/leave.ts's requestLeaveAction for why this is wrapped in
  // after() rather than fire-and-forget.
  after(() =>
    sendPushToShiftRequestApprovers(profile.role, {
      title: "Yêu cầu đổi giờ ca",
      body: `${profile.full_name} xin đổi giờ một ca đã đăng ký`,
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
    const row = data as { profile_id: string; replaces_shift_id: string | null };
    const targetId = row.profile_id;
    // Cùng một kind, khác câu chữ: đơn đổi giờ và đơn đăng ký ca mới đi chung
    // bảng, nên nếu không phân biệt ở đây thì người xin đổi giờ sẽ nhận một
    // thông báo nói về "đăng ký ca làm" mà họ chưa từng gửi.
    const what = row.replaces_shift_id ? "đổi giờ ca" : "đăng ký ca làm";
    // Stored row + push, replacing the push-only call that used to be here —
    // see the same change in actions/leave.ts.
    after(() =>
      emitNotifications([
        {
          profileId: targetId,
          kind: approve ? "shift_request_approved" : "shift_request_rejected",
          title: approve
            ? `Yêu cầu ${what} đã được duyệt`
            : `Yêu cầu ${what} bị từ chối`,
          body: approve
            ? `Yêu cầu ${what} của bạn đã được duyệt`
            : `Yêu cầu ${what} của bạn đã bị từ chối`,
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
