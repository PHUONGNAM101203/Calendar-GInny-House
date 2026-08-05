"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canSeeAllCalendars } from "@/lib/roles";
import { EVENT_COLOR_SWATCHES, isCustomHexColor } from "@/lib/calendar";
import type { ActionResult } from "@/types";

const VALID_COLORS: Set<string> = new Set(EVENT_COLOR_SWATCHES.map((c) => c.var));

function isValidColor(color: string): boolean {
  return VALID_COLORS.has(color) || isCustomHexColor(color);
}

export async function followPersonAction(followeeId: string): Promise<ActionResult> {
  const profile = await requireProfile();
  if (!canSeeAllCalendars(profile.role)) {
    return { ok: false, error: "Bạn không có quyền theo dõi lịch người khác" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("calendar_follows")
    .upsert(
      { follower_id: profile.id, followee_id: followeeId, followed: true },
      { onConflict: "follower_id,followee_id" }
    );

  if (error) return { ok: false, error: "Không thể theo dõi lịch người này" };

  revalidatePath("/calendar");
  return { ok: true, data: undefined };
}

// Personal to the viewer — like Google Calendar, the color you pick for
// someone else's calendar is your own preference, not a shared attribute
// of their profile. Picking a color also follows them (see
// followPersonAction) if they weren't already, same as Google: you can't
// set a color for a calendar that isn't in your list yet.
export async function updateFollowColorAction(
  followeeId: string,
  color: string | null
): Promise<ActionResult> {
  const profile = await requireProfile();
  if (!canSeeAllCalendars(profile.role)) {
    return { ok: false, error: "Bạn không có quyền theo dõi lịch người khác" };
  }
  if (color !== null && !isValidColor(color)) {
    return { ok: false, error: "Màu không hợp lệ" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("calendar_follows")
    .upsert(
      { follower_id: profile.id, followee_id: followeeId, color },
      { onConflict: "follower_id,followee_id" }
    );

  if (error) return { ok: false, error: "Không thể cập nhật màu" };

  revalidatePath("/calendar");
  return { ok: true, data: undefined };
}

// Flips "followed" off instead of deleting the row — deleting would also
// wipe this viewer's chosen color for that person (see migration
// 0016_calendar_follows_keep_color.sql). Re-following just flips it back
// on, so the color survives an unfollow/re-follow cycle.
export async function unfollowPersonAction(followeeId: string): Promise<ActionResult> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase
    .from("calendar_follows")
    .upsert(
      { follower_id: profile.id, followee_id: followeeId, followed: false },
      { onConflict: "follower_id,followee_id" }
    );

  if (error) return { ok: false, error: "Không thể bỏ theo dõi" };

  revalidatePath("/calendar");
  return { ok: true, data: undefined };
}
