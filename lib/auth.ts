import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { canAccessManagerPage } from "@/lib/roles";
import type { Profile, Role } from "@/types";

const PROFILE_COLUMNS =
  "id, full_name, phone, role, secondary_role, covers_reception, color, notifications_seen_at, deactivated_at, is_monitoring_account, profile_branches(branch_id)";

type ProfileRow = {
  id: string;
  full_name: string;
  phone: string | null;
  role: Role;
  secondary_role: Role | null;
  covers_reception: boolean;
  color: string | null;
  notifications_seen_at: string | null;
  deactivated_at: string | null;
  is_monitoring_account: boolean;
  profile_branches: { branch_id: string }[] | null;
};

function toProfile(row: ProfileRow): Omit<Profile, "email"> {
  return {
    id: row.id,
    full_name: row.full_name,
    phone: row.phone,
    role: row.role,
    secondary_role: row.secondary_role,
    covers_reception: row.covers_reception,
    color: row.color,
    notifications_seen_at: row.notifications_seen_at,
    deactivated_at: row.deactivated_at,
    is_monitoring_account: row.is_monitoring_account,
    branch_ids: (row.profile_branches ?? []).map((pb) => pb.branch_id),
  };
}

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

  if (created) return toProfile(created as ProfileRow);

  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .single();

  return existing ? toProfile(existing as ProfileRow) : null;
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

  const resolved = profile ? toProfile(profile as ProfileRow) : await ensureProfile(user);
  if (!resolved) return null;

  return { ...resolved, email: user.email ?? "" };
});

export async function requireProfile() {
  const profile = await getSessionProfile();
  if (!profile) redirect("/login");
  // Deactivation is reversible and enforced here rather than in RLS — this
  // is the one gate every authenticated request passes through, including
  // the request that reads the profile row itself. Redirects to a Route
  // Handler rather than signing out directly — this function runs during
  // Server Component render, where Next.js can't write response cookies,
  // so a signOut() call here would silently fail to clear the session (see
  // app/auth/deactivated/route.ts for the full explanation).
  if (profile.deactivated_at) redirect("/auth/deactivated");
  return profile;
}

export async function requireManager() {
  const profile = await requireProfile();
  if (!canAccessManagerPage(profile.role)) redirect("/calendar");
  return profile;
}
