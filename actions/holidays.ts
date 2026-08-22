"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { canManageHolidays } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { holidaySchema, holidayUpdateSchema } from "@/lib/validations/holiday";
import type { ActionResult } from "@/types";

const FORBIDDEN = "Chỉ Tổng Giám Đốc và Kỹ thuật mới chỉnh sửa được ngày lễ";

function mapHolidayError(message: string): string {
  if (message.includes("row-level security policy") || message.includes("permission denied")) {
    return FORBIDDEN;
  }
  if (message.includes("holidays_dates_valid")) {
    return "Ngày kết thúc phải bằng hoặc sau ngày bắt đầu";
  }
  if (message.includes("holidays_name_not_blank")) {
    return "Vui lòng nhập tên ngày lễ";
  }
  if (message.includes("holidays_half_day_time_valid")) {
    return "Nghỉ nửa ngày cần chọn giờ bắt đầu";
  }
  return "Không thể lưu ngày lễ, vui lòng thử lại";
}

// Both /calendar (the banner overlay) and /manager (the editor list) read
// this table, so both have to be refreshed — unlike group-permissions, whose
// editor owns its own optimistic state. Here the list IS the server data.
function revalidateHolidayPaths() {
  revalidatePath("/calendar");
  revalidatePath("/manager");
}

export async function createHolidayAction(input: unknown): Promise<ActionResult> {
  const profile = await requireProfile();
  if (!canManageHolidays(profile.role)) {
    return { ok: false, error: FORBIDDEN };
  }

  const parsed = holidaySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("holidays").insert({
    name: parsed.data.name,
    start_date: parsed.data.start_date,
    end_date: parsed.data.end_date,
    half_day: parsed.data.half_day,
    // Cleared whenever the holiday is full-day, so switching "nửa ngày" back
    // to "nguyên ngày" can't leave a stale time behind — that pairing is also
    // what holidays_half_day_time_valid (0082) enforces.
    start_time: parsed.data.half_day ? (parsed.data.start_time ?? null) : null,
    note: parsed.data.note || null,
    created_by: profile.id,
  });

  if (error) {
    return { ok: false, error: mapHolidayError(error.message) };
  }

  revalidateHolidayPaths();
  return { ok: true, data: undefined };
}

export async function updateHolidayAction(input: unknown): Promise<ActionResult> {
  const profile = await requireProfile();
  if (!canManageHolidays(profile.role)) {
    return { ok: false, error: FORBIDDEN };
  }

  const parsed = holidayUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const { id, values } = parsed.data;
  // created_by is deliberately left alone — it records who first added the
  // holiday, not who last touched it (updated_at covers that, via trigger).
  const { error } = await supabase
    .from("holidays")
    .update({
      name: values.name,
      start_date: values.start_date,
      end_date: values.end_date,
      half_day: values.half_day,
      start_time: values.half_day ? (values.start_time ?? null) : null,
      note: values.note || null,
    })
    .eq("id", id);

  if (error) {
    return { ok: false, error: mapHolidayError(error.message) };
  }

  revalidateHolidayPaths();
  return { ok: true, data: undefined };
}

export async function deleteHolidayAction(id: unknown): Promise<ActionResult> {
  const profile = await requireProfile();
  if (!canManageHolidays(profile.role)) {
    return { ok: false, error: FORBIDDEN };
  }

  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, error: "Ngày lễ không hợp lệ" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("holidays").delete().eq("id", id);

  if (error) {
    return { ok: false, error: mapHolidayError(error.message) };
  }

  revalidateHolidayPaths();
  return { ok: true, data: undefined };
}
