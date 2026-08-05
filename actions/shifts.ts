"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth";
import { shiftSchema } from "@/lib/validations/shift";
import type { ActionResult } from "@/types";

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
  return "Không thể lưu ca làm việc";
}

export async function createShiftAction(input: unknown): Promise<ActionResult> {
  await requireManager();
  const parsed = shiftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("shifts").insert({
    assignee_id: parsed.data.assignee_id,
    branch_id: parsed.data.branch_id,
    start_at: parsed.data.start_at,
    end_at: parsed.data.end_at,
    shift_type: parsed.data.shift_type,
    note: parsed.data.note || null,
    created_by: user!.id,
  });

  if (error) return { ok: false, error: mapShiftError(error.message) };

  revalidatePath("/calendar");
  revalidatePath("/manager");
  return { ok: true, data: undefined };
}

export async function updateShiftAction(
  id: string,
  input: unknown
): Promise<ActionResult> {
  await requireManager();
  const parsed = shiftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("shifts")
    .update({
      assignee_id: parsed.data.assignee_id,
      branch_id: parsed.data.branch_id,
      start_at: parsed.data.start_at,
      end_at: parsed.data.end_at,
      shift_type: parsed.data.shift_type,
      note: parsed.data.note || null,
    })
    .eq("id", id);

  if (error) return { ok: false, error: mapShiftError(error.message) };

  revalidatePath("/calendar");
  revalidatePath("/manager");
  return { ok: true, data: undefined };
}

export async function deleteShiftAction(id: string): Promise<ActionResult> {
  await requireManager();
  const supabase = await createClient();
  const { error } = await supabase.from("shifts").delete().eq("id", id);

  if (error) return { ok: false, error: "Không thể xoá ca làm việc" };

  revalidatePath("/calendar");
  revalidatePath("/manager");
  return { ok: true, data: undefined };
}
