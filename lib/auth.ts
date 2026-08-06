import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { canAccessManagerPage } from "@/lib/roles";
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
  // getUser() re-validates the token against the Auth server instead of
  // trusting the cookie payload — getSession() does not, so per Supabase's
  // own guidance it must not be used to gate access or read user data.
  // React's cache() still limits this to one network round trip per request.
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
  if (!canAccessManagerPage(profile.role)) redirect("/calendar");
  return profile;
}
