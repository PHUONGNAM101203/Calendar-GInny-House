"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { EVENT_COLOR_SWATCHES, isCustomHexColor } from "@/lib/calendar";
import { customEventSchema } from "@/lib/validations/custom-event";
import { parse } from "date-fns";
import type { ActionResult } from "@/types";

const VALID_COLORS: Set<string> = new Set(EVENT_COLOR_SWATCHES.map((c) => c.var));

function isValidColor(color: string): boolean {
  return VALID_COLORS.has(color) || isCustomHexColor(color);
}

export async function createCustomCalendarAction(name: string, color: string): Promise<ActionResult> {
  const profile = await requireProfile();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Vui lòng nhập tên lịch" };
  if (!isValidColor(color)) return { ok: false, error: "Màu không hợp lệ" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("custom_calendars")
    .insert({ owner_id: profile.id, name: trimmed, color });

  if (error) return { ok: false, error: "Không thể tạo lịch mới" };

  revalidatePath("/calendar");
  return { ok: true, data: undefined };
}

export async function deleteCustomCalendarAction(calendarId: string): Promise<ActionResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase
    .from("custom_calendars")
    .delete()
    .eq("id", calendarId)
    .eq("owner_id", profile.id);

  if (error) return { ok: false, error: "Không thể xoá lịch" };

  revalidatePath("/calendar");
  return { ok: true, data: undefined };
}

export async function createCustomEventAction(
  calendarId: string,
  input: unknown
): Promise<ActionResult> {
  await requireProfile();
  const parsed = customEventSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const v = parsed.data;

  const startAt = v.all_day
    ? parse(v.start_date, "yyyy-MM-dd", new Date())
    : parse(`${v.start_date} ${v.start_time}`, "yyyy-MM-dd HH:mm", new Date());
  const endAt = v.all_day
    ? parse(v.end_date, "yyyy-MM-dd", new Date())
    : parse(`${v.end_date} ${v.end_time}`, "yyyy-MM-dd HH:mm", new Date());

  const supabase = await createClient();
  const { error } = await supabase.from("custom_events").insert({
    calendar_id: calendarId,
    title: v.title.trim(),
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
    all_day: v.all_day,
  });

  if (error) return { ok: false, error: "Không thể tạo sự kiện" };

  revalidatePath("/calendar");
  return { ok: true, data: undefined };
}

export async function deleteCustomEventAction(eventId: string): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from("custom_events").delete().eq("id", eventId);

  if (error) return { ok: false, error: "Không thể xoá sự kiện" };

  revalidatePath("/calendar");
  return { ok: true, data: undefined };
}
