// This file must stay import-free of anything server-only (supabaseAdmin,
// next/headers, etc.) — lib/roles.ts imports from it, and lib/roles.ts is
// imported by client components (ShiftCalendar.tsx and friends). A
// server-only import here gets bundled into the browser and crashes on
// load the moment it touches an env var that's never sent to the client
// (this exact bug shipped once — service-role key construction ran in the
// browser, threw "supabaseKey is required," and blanked the whole app).
// The server-only counterpart (getGroupPermissions) lives in
// lib/permissions-server.ts instead, imported only from Server Components/
// Actions/server-only libs — never from here, never from lib/roles.ts.
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

export function permKey(managerRole: Role, targetRole: Role, permission: GroupPermissionType): string {
  return `${managerRole}:${targetRole}:${permission}`;
}

// One boolean per granted (manager, target, permission) triple — absence
// means not granted. Fetched once per request (table has a few dozen rows;
// no caching layer needed, never stale).
export type GroupPermissions = ReadonlySet<string>;

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
