"use server";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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
