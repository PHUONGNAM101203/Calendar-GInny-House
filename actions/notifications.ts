"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { markNotificationReadSchema } from "@/lib/validations/notification";
import type { ActionResult } from "@/types";

// Stamps "I've now seen everything up to this moment" on the caller's own
// profile, so the unread badge agrees across every device they use rather
// than living in one browser's localStorage.
//
// Deliberately no revalidatePath: the bell already updates its own count
// optimistically, and this is fired on every bell open — revalidating from
// here would re-run the whole page's data fetch just to clear a badge the
// user is already looking at.
//
// The write is scoped to auth.uid() by profiles_update_self (0001_init.sql),
// so a caller can only ever stamp their own row.
export async function markNotificationsSeenAction(): Promise<ActionResult> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("profiles")
    .update({ notifications_seen_at: new Date().toISOString() })
    .eq("id", profile.id);

  if (error) {
    return { ok: false, error: "Không thể lưu trạng thái đã xem thông báo" };
  }
  return { ok: true, data: undefined };
}

// Dismiss one stored notification.
//
// Only the stored half can be dismissed individually — a derived notification
// has no row to stamp, and is instead retired by its own source (the request
// resolves, or its three-day window passes). markNotificationsSeenAction above
// remains the whole of the read model for those five kinds.
//
// The `.eq("profile_id")` is belt-and-braces, exactly as in the layout's
// select: notifications_update_own (0077_notifications.sql) already restricts
// UPDATE to `profile_id = auth.uid()` in both `using` and `with check`, so a
// caller passing someone else's uuid matches zero rows and changes nothing —
// verified against the migration, not assumed. RLS is the boundary; this line
// just makes the intent legible at the call site.
export async function markNotificationReadAction(input: unknown): Promise<ActionResult> {
  const profile = await requireProfile();
  const parsed = markNotificationReadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Thông báo không hợp lệ" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .eq("profile_id", profile.id);

  if (error) {
    return { ok: false, error: "Không thể đánh dấu thông báo đã đọc" };
  }

  // Unlike markNotificationsSeenAction, this one must revalidate: the layout
  // filters read rows out of its query, so without this the dismissed item
  // reappears from the router cache on the next navigation and the bell
  // contradicts what the user just did.
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

// "Đánh dấu tất cả đã đọc" — one statement, no input, no per-row round trip.
// Bounded by `read_at is null` so a person who has already cleared the bell
// pays nothing for pressing it again.
export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("profile_id", profile.id)
    .is("read_at", null);

  if (error) {
    return { ok: false, error: "Không thể đánh dấu tất cả thông báo đã đọc" };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
