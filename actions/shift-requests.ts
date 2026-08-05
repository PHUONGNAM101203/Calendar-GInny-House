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
  return "Không thể gửi đăng ký ca làm";
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
    p_note: parsed.data.note || null,
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

  // The RPC's own raise exception messages are already clean, human-facing
  // Vietnamese text (see 0010_shift_requests.sql) — pass them through
  // instead of masking with a generic string, so a real cause (overlap,
  // stale status, wrong assignee) is visible instead of hidden.
  if (error) return { ok: false, error: error.message || "Không thể huỷ đăng ký ca này" };

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

  if (error) return { ok: false, error: error.message || "Không thể xử lý đăng ký ca này" };

  revalidatePath("/calendar");
  revalidatePath("/manager");
  return { ok: true, data: undefined };
}
