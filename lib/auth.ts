import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isManagerRole } from "@/lib/roles";
import type { Profile } from "@/types";

const PROFILE_COLUMNS = "id, full_name, phone, role, branch_id, color";

// Self-heals accounts that have a Supabase auth user but no `profiles` row
// yet (e.g. created before the trigger existed, or the trigger raced with
// signup). Without this, an authenticated-but-profile-less user would bounce
// forever between requireProfile() -> /login and the proxy sending an
// authenticated user away from /login back to /calendar.
async function ensureProfile(user: { id: string; email?: string | null }) {
  const { data: created } = await supabaseAdmin
    .from("profiles")
    .upsert(
      { id: user.id, full_name: user.email?.split("@")[0] ?? "" },
      { onConflict: "id", ignoreDuplicates: true }
    )
    .select(PROFILE_COLUMNS)
    .single();

  if (created) return created as Profile;

  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .single();

  return existing as Profile | null;
}

export const getSessionProfile = cache(async () => {
  const supabase = await createClient();
  // proxy.ts already called getUser() for this exact request (a network
  // round-trip to Supabase Auth) before the RSC tree even started
  // rendering — that's the authoritative check for every matched route.
  // Calling getUser() again here would pay that network cost a second
  // time per page load for no extra security, so we read the
  // already-verified session straight from the (proxy-refreshed) cookie.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .single();

  const resolved = profile ?? (await ensureProfile(user));
  if (!resolved) return null;

  return { ...(resolved as Profile), email: user.email ?? "" };
});

export async function requireProfile() {
  const profile = await getSessionProfile();
  if (!profile) redirect("/login");
  return profile;
}

export async function requireManager() {
  const profile = await requireProfile();
  if (!isManagerRole(profile.role)) redirect("/calendar");
  return profile;
}
