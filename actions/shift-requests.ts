"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { isCeo } from "@/lib/roles";
import { shiftRequestSchema } from "@/lib/validations/shift-request";
import type { ActionResult } from "@/types";

function mapShiftRequestError(message: string): string {
  if (message.includes("Giờ kết thúc phải sau giờ bắt đầu")) {
    return "Giờ kết thúc phải sau giờ bắt đầu";
  }
  if (message.includes("shifts_no_overlap")) {
    return "Ca này trùng giờ với một ca đã được duyệt của bạn";
  }
  if (message.includes("Ca này đã có đăng ký quản sinh")) {
    return "Ca này đã có đăng ký quản sinh";
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
  "Ca này đã có đăng ký quản sinh",
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

export async function requestShiftAction(input: unknown): Promise<ActionResult> {
  await requireProfile();
  const parsed = shiftRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_shift", {
    p_start_at: new Date(parsed.data.start_at).toISOString(),
    p_end_at: new Date(parsed.data.end_at).toISOString(),
    p_branch_id: parsed.data.branch_id,
    p_note: parsed.data.note || null,
    p_shift_type: parsed.data.shift_type,
  });

  if (error) return { ok: false, error: mapShiftRequestError(error.message) };

  revalidatePath("/calendar");
  revalidatePath("/manager");
  return { ok: true, data: undefined };
}

export async function cancelShiftRequestAction(id: string): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_shift_request", { p_id: id });

  if (error) {
    return { ok: false, error: mapShiftRpcError(error.message, "Không thể huỷ đăng ký ca này") };
  }

  revalidatePath("/calendar");
  revalidatePath("/manager");
  return { ok: true, data: undefined };
}

export async function respondToShiftRequestAction(
  id: string,
  approve: boolean
): Promise<ActionResult> {
  const profile = await requireProfile();
  if (!isCeo(profile.role) && profile.role !== "hr") {
    return { ok: false, error: "Bạn không có quyền duyệt đăng ký ca này" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_to_shift_request", {
    p_id: id,
    p_approve: approve,
  });

  if (error) {
    return { ok: false, error: mapShiftRpcError(error.message, "Không thể xử lý đăng ký ca này") };
  }

  revalidatePath("/calendar");
  revalidatePath("/manager");
  return { ok: true, data: undefined };
}
