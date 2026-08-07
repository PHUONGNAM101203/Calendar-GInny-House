"use server";

import { requireProfile } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult } from "@/types";

export async function subscribeToPushAction(subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<ActionResult> {
  const profile = await requireProfile();

  // A push endpoint is tied to the browser/device, not the account — on a
  // shared device where a different person logs in later, the same
  // endpoint should simply start notifying whoever's session subscribed it
  // most recently. Using the admin client sidesteps RLS's per-owner "using"
  // clause, which would otherwise turn that re-subscribe into a silent
  // no-op instead of reassigning the row.
  const { error } = await supabaseAdmin.from("push_subscriptions").upsert(
    {
      profile_id: profile.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    { onConflict: "endpoint" }
  );

  if (error) return { ok: false, error: "Không thể bật thông báo đẩy" };
  return { ok: true, data: undefined };
}

export async function unsubscribeFromPushAction(endpoint: string): Promise<ActionResult> {
  const profile = await requireProfile();
  const { error } = await supabaseAdmin
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("profile_id", profile.id);

  if (error) return { ok: false, error: "Không thể tắt thông báo đẩy" };
  return { ok: true, data: undefined };
}
