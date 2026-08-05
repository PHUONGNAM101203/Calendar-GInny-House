import type { Role } from "@/types";

// Order here is the organizational hierarchy, highest first — reused
// anywhere a role list is rendered (staff table dropdown) so it always
// reads top-down instead of alphabetically.
export const ROLE_HIERARCHY: Role[] = [
  "ceo",
  "coo",
  "training_director",
  "hr",
  "technical",
  "teacher",
  "collaborator",
  "customer_care",
  "operations_staff",
];

export const ROLE_LABELS: Record<Role, string> = {
  ceo: "Tổng Giám Đốc",
  coo: "Giám Đốc Vận Hành",
  training_director: "Giám Đốc Đào Tạo",
  hr: "HR",
  technical: "Kỹ thuật",
  teacher: "Giáo viên",
  collaborator: "CTV",
  customer_care: "CSKH",
  operations_staff: "Nhân viên vận hành",
};

// Mirrors is_manager() in supabase/migrations/0005_role_hierarchy.sql —
// keep both in sync if the manager-tier set ever changes. These 4 roles run
// every cơ sở at once, so they never pick a branch for themselves (see
// migration 0006_global_manager_scope.sql).
const MANAGER_ROLES: ReadonlySet<Role> = new Set([
  "ceo",
  "coo",
  "training_director",
  "technical",
]);

export function isManagerRole(role: Role): boolean {
  return MANAGER_ROLES.has(role);
}

// The "vận hành" group the COO gets a dedicated filtered view over (see
// ManagerPage's "Nhóm vận hành" tab) — front-line roles only, none of these
// are manager-tier.
export const OPERATIONS_GROUP_ROLES: ReadonlySet<Role> = new Set([
  "hr",
  "customer_care",
  "operations_staff",
]);

export function isOperationsGroupRole(role: Role): boolean {
  return OPERATIONS_GROUP_ROLES.has(role);
}

// The "đào tạo" group — Giám Đốc Đào Tạo's counterpart to OPERATIONS_GROUP_ROLES.
export const TRAINING_GROUP_ROLES: ReadonlySet<Role> = new Set(["teacher", "collaborator"]);

export function isTrainingGroupRole(role: Role): boolean {
  return TRAINING_GROUP_ROLES.has(role);
}

// Who can see/follow whose calendar (2026-08 pass): three tiers, not one
// flat "sees everyone" set —
//   "all"   — ceo, technical: every role, org-wide.
//   "group" — coo: operations group only; training_director: training
//             group only. Mirrors can_view_profile() in
//             0013_group_scoped_visibility.sql — keep both in sync.
//   "none"  — everyone else: just their own branch's shared schedule, no
//             follow feature at all (unchanged default behavior).
export type CalendarScope = "all" | "group" | "none";

export function getCalendarScope(role: Role): CalendarScope {
  if (role === "ceo" || role === "technical") return "all";
  if (role === "coo" || role === "training_director") return "group";
  return "none";
}

export function canSeeAllCalendars(role: Role): boolean {
  return getCalendarScope(role) !== "none";
}

// The specific set of roles a "group"-scope viewer can see/follow. Null for
// "all"-scope viewers (no filtering needed) and "none"-scope viewers (no
// follow feature to begin with).
export function getViewableGroupRoles(role: Role): ReadonlySet<Role> | null {
  if (role === "coo") return OPERATIONS_GROUP_ROLES;
  if (role === "training_director") return TRAINING_GROUP_ROLES;
  return null;
}

// Leave-request approval — ceo approves anyone; coo/training_director only
// their own group's people; everyone else (including technical, which only
// gets the read-only analytics dashboard) approves no one. Mirrors
// is_leave_approver()/respond_to_leave_request() in
// 0013_group_scoped_visibility.sql — keep in sync.
const LEAVE_APPROVER_ROLES: ReadonlySet<Role> = new Set(["ceo", "coo", "training_director"]);

export function isLeaveApprover(role: Role): boolean {
  return LEAVE_APPROVER_ROLES.has(role);
}

export function canApproveLeaveFor(approverRole: Role, targetRole: Role): boolean {
  if (approverRole === "ceo") return true;
  if (approverRole === "coo") return OPERATIONS_GROUP_ROLES.has(targetRole);
  if (approverRole === "training_director") return TRAINING_GROUP_ROLES.has(targetRole);
  return false;
}

// Everyone else — including training_director, despite being manager-tier
// for shifts/swaps/leave RLS — submits a "Đăng ký ca làm" request instead
// (see supabase/migrations/0010_shift_requests.sql) that only the CEO can
// approve. Same 3 roles as CALENDAR_FOLLOW_ALL_ROLES today, kept as its own
// set since the two are separate product decisions that happen to coincide.
export const DIRECT_SHIFT_ROLES: ReadonlySet<Role> = new Set(["ceo", "coo", "technical"]);

export function canCreateShiftDirectly(role: Role): boolean {
  return DIRECT_SHIFT_ROLES.has(role);
}

// Only the CEO approves shift registrations.
export function isCeo(role: Role): boolean {
  return role === "ceo";
}
