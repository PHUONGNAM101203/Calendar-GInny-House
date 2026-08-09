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
export async function getGroupPermissions(): Promise<GroupPermissions> {
  const { data } = await supabaseAdmin.from("group_permissions").select("manager_role, target_role, permission");
  return new Set(
    (data ?? []).map((r) => permKey(r.manager_role as Role, r.target_role as Role, r.permission as GroupPermissionType))
  );
}
