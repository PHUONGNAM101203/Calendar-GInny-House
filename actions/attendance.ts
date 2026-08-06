"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import type { ActionResult, Attendance } from "@/types";

function mapAttendanceError(message: string): string {
  if (message.includes("đã chấm công vào rồi")) return "Bạn đã chấm công vào rồi";
  if (message.includes("chưa chấm công vào")) return "Bạn chưa chấm công vào";
  if (message.includes("không có ca làm việc nào")) return "Bạn không có ca làm việc nào trong khung giờ này";
  return "Không thể ghi nhận chấm công";
}

export async function clockInAction(): Promise<ActionResult<Attendance>> {
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clock_in");

  if (error) return { ok: false, error: mapAttendanceError(error.message) };

  revalidatePath("/attendance");
  revalidatePath("/manager");
  return { ok: true, data: data as Attendance };
}

export async function clockOutAction(): Promise<ActionResult<Attendance>> {
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clock_out");

  if (error) return { ok: false, error: mapAttendanceError(error.message) };

  revalidatePath("/attendance");
  revalidatePath("/manager");
  return { ok: true, data: data as Attendance };
}
