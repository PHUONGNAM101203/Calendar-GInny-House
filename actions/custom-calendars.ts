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

// "Duyệt lịch có sẵn trong công ty" — the owner opts a calendar in or out of
// the company-wide browse list. The `.eq("owner_id", ...)` is belt-and-braces
// over custom_calendars_update (0081), which is already owner-only.
export async function setCustomCalendarSharedAction(
  calendarId: string,
  shared: boolean
): Promise<ActionResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase
    .from("custom_calendars")
    .update({ is_shared: shared })
    .eq("id", calendarId)
    .eq("owner_id", profile.id);

  if (error) return { ok: false, error: shared ? "Không thể chia sẻ lịch" : "Không thể ngừng chia sẻ lịch" };

  revalidatePath("/calendar");
  return { ok: true, data: undefined };
}

export async function subscribeCustomCalendarAction(calendarId: string): Promise<ActionResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  // custom_calendar_subscriptions_insert additionally requires the target to
  // actually be shared and to belong to someone else, so an unshared or own
  // calendar fails here rather than silently subscribing.
  const { error } = await supabase
    .from("custom_calendar_subscriptions")
    .insert({ subscriber_id: profile.id, calendar_id: calendarId });

  if (error) return { ok: false, error: "Không thể đăng ký lịch này" };

  revalidatePath("/calendar");
  return { ok: true, data: undefined };
}

export async function unsubscribeCustomCalendarAction(calendarId: string): Promise<ActionResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase
    .from("custom_calendar_subscriptions")
    .delete()
    .eq("subscriber_id", profile.id)
    .eq("calendar_id", calendarId);

  if (error) return { ok: false, error: "Không thể bỏ đăng ký lịch này" };

  revalidatePath("/calendar");
  return { ok: true, data: undefined };
}

// Ownership check for the two event mutations below. Until 0081 these relied
// entirely on custom_events_owner; that policy has since been split so
// SELECT is owner-OR-shared while writes stay owner-only. The RLS write path
// is still the real boundary, but a read-widened calendar is exactly the
// situation where an action with no owner check of its own becomes a hole if
// a future migration relaxes the write policy too — so state the requirement
// here rather than inherit it.
async function assertOwnsCalendar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  calendarId: string,
  profileId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("custom_calendars")
    .select("owner_id")
    .eq("id", calendarId)
    .maybeSingle();

  if (!data) return "Không tìm thấy lịch";
  if ((data as { owner_id: string }).owner_id !== profileId) {
    return "Bạn chỉ có thể thay đổi sự kiện trên lịch của mình";
  }
  return null;
}

export async function createCustomEventAction(
  calendarId: string,
  input: unknown
): Promise<ActionResult> {
  const profile = await requireProfile();
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
  const ownerError = await assertOwnsCalendar(supabase, calendarId, profile.id);
  if (ownerError) return { ok: false, error: ownerError };

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
  const profile = await requireProfile();
  const supabase = await createClient();

  // The event row itself is now readable by anyone once its calendar is
  // shared, so resolve it to a calendar and check that calendar's owner
  // before deleting.
  const { data: event } = await supabase
    .from("custom_events")
    .select("calendar_id")
    .eq("id", eventId)
    .maybeSingle();

  if (!event) return { ok: false, error: "Không tìm thấy sự kiện" };

  const ownerError = await assertOwnsCalendar(
    supabase,
    (event as { calendar_id: string }).calendar_id,
    profile.id
  );
  if (ownerError) return { ok: false, error: ownerError };

  const { error } = await supabase.from("custom_events").delete().eq("id", eventId);

  if (error) return { ok: false, error: "Không thể xoá sự kiện" };

  revalidatePath("/calendar");
  return { ok: true, data: undefined };
}
