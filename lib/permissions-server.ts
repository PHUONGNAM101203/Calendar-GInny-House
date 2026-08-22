import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { permKey, type GroupPermissions, type GroupPermissionType } from "@/lib/permissions";
import type { Role } from "@/types";

// Uses supabaseAdmin (service role, bypasses RLS) because group_permissions
// is readable only by `technical` (see 0047's RLS policy), but every
// authenticated request — regardless of the viewer's own role — needs to
// resolve whether IT has a given permission. Same pattern lib/push.ts
// already uses for cross-account lookups. Import ONLY from Server
// Components, Server Actions, or other server-only libs — never from
// lib/roles.ts or any "use client" file (see lib/permissions.ts's header
// comment for why that broke production once already).
//
// Wrapped in React's cache() — same per-request memoisation lib/auth.ts's
// getSessionProfile uses. The app shell layout and the page inside it both
// need permissions and both render in the same request, so /manager,
// /calendar and /leave were each running this query twice per page view.
// Safe to memoise: it takes no arguments and reads via the service-role
// client, so the result never depends on the caller's cookies or role.
export const getGroupPermissions = cache(async (): Promise<GroupPermissions> => {
  const { data } = await supabaseAdmin.from("group_permissions").select("manager_role, target_role, permission");
  return new Set(
    (data ?? []).map((r) => permKey(r.manager_role as Role, r.target_role as Role, r.permission as GroupPermissionType))
  );
});
