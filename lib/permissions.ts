import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Role } from "@/types";

export type GroupPermissionType =
  | "create_shift"
  | "approve_shift_request"
  | "approve_swap"
  | "approve_leave"
  | "manage_attendance"
  | "view_calendar";

export const GROUP_PERMISSION_TYPES = [
  "create_shift",
  "approve_shift_request",
  "approve_swap",
  "approve_leave",
  "manage_attendance",
  "view_calendar",
] as const satisfies readonly GroupPermissionType[];

export const GROUP_PERMISSION_LABELS: Record<GroupPermissionType, string> = {
  create_shift: "Tạo ca",
  approve_shift_request: "Duyệt đăng ký ca",
  approve_swap: "Duyệt đổi ca",
  approve_leave: "Duyệt nghỉ phép / giải trình công",
  manage_attendance: "Sửa chấm công",
  view_calendar: "Xem lịch",
};

// The 3 manager roles that ever have a group, and the 7 roles that can
// ever be a target — mirrors the CHECK constraints on group_permissions
// (0047_group_permissions.sql). UI iterates these instead of hardcoding
// its own lists a 3rd time.
export const GROUP_MANAGER_ROLES = ["coo", "training_director", "hr"] as const satisfies readonly Role[];
export const GROUP_TARGET_ROLES = [
  "teacher",
  "collaborator",
  "student_affairs",
  "teaching_assistant",
  "operations_staff",
  "customer_care",
  "hr",
] as const satisfies readonly Role[];

function permKey(managerRole: Role, targetRole: Role, permission: GroupPermissionType): string {
  return `${managerRole}:${targetRole}:${permission}`;
}

// One boolean per granted (manager, target, permission) triple — absence
// means not granted. Fetched once per request (table has a few dozen rows;
// no caching layer needed, never stale).
export type GroupPermissions = ReadonlySet<string>;

// Uses supabaseAdmin (service role, bypasses RLS) because group_permissions
// is readable only by `technical` (see 0047's RLS policy), but every
// authenticated request — regardless of the viewer's own role — needs to
// resolve whether IT has a given permission. Same pattern lib/push.ts
// already uses for cross-account lookups; never imported into a client
// component.
export async function getGroupPermissions(): Promise<GroupPermissions> {
  const { data } = await supabaseAdmin.from("group_permissions").select("manager_role, target_role, permission");
  return new Set(
    (data ?? []).map((r) => permKey(r.manager_role as Role, r.target_role as Role, r.permission as GroupPermissionType))
  );
}

export function hasGroupPermission(
  permissions: GroupPermissions,
  managerRole: Role,
  targetRole: Role,
  type: GroupPermissionType
): boolean {
  return permissions.has(permKey(managerRole, targetRole, type));
}

// All target roles granted to managerRole for one specific permission type.
export function getGrantedTargetRoles(
  permissions: GroupPermissions,
  managerRole: Role,
  type: GroupPermissionType
): ReadonlySet<Role> {
  const roles = new Set<Role>();
  for (const target of GROUP_TARGET_ROLES) {
    if (hasGroupPermission(permissions, managerRole, target, type)) roles.add(target);
  }
  return roles;
}

// Union across ALL 6 permission types — used where the codebase needs one
// "who does this manager have ANY authority over" set (the manager
// dashboard's staff roster), since there is no dedicated "roster"
// permission type.
export function getGrantedTargetRolesUnion(permissions: GroupPermissions, managerRole: Role): ReadonlySet<Role> {
  const roles = new Set<Role>();
  for (const type of GROUP_PERMISSION_TYPES) {
    for (const target of getGrantedTargetRoles(permissions, managerRole, type)) roles.add(target);
  }
  return roles;
}
