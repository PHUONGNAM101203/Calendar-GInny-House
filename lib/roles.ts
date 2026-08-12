import { hasGroupPermission, getGrantedTargetRoles, type GroupPermissions } from "@/lib/permissions";
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
  "student_affairs",
  "teaching_assistant",
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
  student_affairs: "Quản sinh",
  teaching_assistant: "Trợ giảng",
  collaborator: "CTV",
  customer_care: "CSKH",
  operations_staff: "Nhân viên vận hành",
};

// Display copy for the manager dashboard's group-scoped view — keyed by
// the viewer's own role, not the group members' roles. Mirrors
// getViewableGroupRoles() below 1:1; if that mapping changes, update this
// too. ceo/technical intentionally have no entry (they see the org-wide
// dashboard, no group label needed).
export const MANAGER_GROUP_META: Partial<Record<Role, { label: string; description: string }>> = {
  coo: { label: "Nhóm vận hành", description: "HR, CSKH và Nhân viên vận hành" },
  training_director: { label: "Nhóm đào tạo", description: "Giáo viên và CTV" },
  hr: { label: "Nhóm quản sinh", description: "Quản sinh và Trợ giảng" },
};

// Which primary roles may hold teaching_assistant as a secondary ("kiêm
// nhiệm") role. Mirrors the profiles_secondary_role_valid_pair CHECK
// constraint in supabase/migrations/0051_staff_secondary_role.sql — keep
// both in sync.
export const SECONDARY_ROLE_ELIGIBLE_ROLES: ReadonlySet<Role> = new Set(["teacher", "student_affairs"]);

// Display-only combined label, e.g. "Giáo viên · Trợ giảng" — never used
// for authorization. Approval authority stays keyed to profiles.role
// (primary) alone; secondary_role has no effect on any can*For predicate
// in this file.
export function getRoleLabel(profile: { role: Role; secondary_role: Role | null }): string {
  if (!profile.secondary_role) return ROLE_LABELS[profile.role];
  return `${ROLE_LABELS[profile.role]} · ${ROLE_LABELS[profile.secondary_role]}`;
}

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
  if (role === "coo" || role === "training_director" || role === "hr") return "group";
  return "none";
}

export function canSeeAllCalendars(role: Role): boolean {
  return getCalendarScope(role) !== "none";
}

// Leave-request approval — ceo approves anyone; coo/training_director/hr
// only their own group's people (dynamically, via group_permissions — see
// lib/permissions.ts); everyone else (including technical, which only
// gets the read-only analytics dashboard) approves no one. Also governs
// giải trình công (attendance correction) approval — respond_to_leave_
// request() and respond_to_attendance_correction() share the same
// can_view_profile() SQL check, so this one predicate covers both request
// kinds on purpose. Mirrors can_view_profile() in
// 0048_group_permissions_sql_functions.sql (permission literal
// 'approve_leave') — keep in sync.
const LEAVE_APPROVER_ROLES: ReadonlySet<Role> = new Set(["ceo", "coo", "training_director", "hr"]);

export function isLeaveApprover(role: Role): boolean {
  return LEAVE_APPROVER_ROLES.has(role);
}

export function canApproveLeaveFor(approverRole: Role, targetRole: Role, permissions: GroupPermissions): boolean {
  if (approverRole === "ceo") return true;
  return hasGroupPermission(permissions, approverRole, targetRole, "approve_leave");
}

// Who can open the direct-create-shift UI at all (coarse gate — doesn't say
// WHO they can create a shift for, see canCreateShiftFor below for that).
// ceo/technical: unrestricted. coo/training_director/hr: scoped to their own
// group (canCreateShiftFor enforces the actual scoping). Everyone else still
// submits a "Đăng ký ca làm" request instead (0010_shift_requests.sql).
export const DIRECT_SHIFT_ROLES: ReadonlySet<Role> = new Set([
  "ceo",
  "coo",
  "training_director",
  "hr",
  "technical",
]);

export function canCreateShiftDirectly(role: Role): boolean {
  return DIRECT_SHIFT_ROLES.has(role);
}

// Per-assignee shift create/edit/delete scoping. ceo/technical: anyone.
// coo/training_director/hr: only their own group's people (dynamically,
// via group_permissions). Mirrors can_manage_shift_for() in
// 0048_group_permissions_sql_functions.sql (permission literal
// 'create_shift') — keep both in sync.
export function canCreateShiftFor(viewerRole: Role, targetRole: Role, permissions: GroupPermissions): boolean {
  if (viewerRole === "ceo" || viewerRole === "technical") return true;
  return hasGroupPermission(permissions, viewerRole, targetRole, "create_shift");
}

// Only the CEO approves shift registrations.
export function isCeo(role: Role): boolean {
  return role === "ceo";
}

// Shift-request approval: CEO approves anyone; coo/training_director/hr only
// their own group (dynamically, via group_permissions). Mirrors
// can_approve_shift_request() in 0048_group_permissions_sql_functions.sql
// (permission literal 'approve_shift_request') — keep in sync.
export function canApproveShiftRequestFor(approverRole: Role, targetRole: Role, permissions: GroupPermissions): boolean {
  if (approverRole === "ceo") return true;
  return hasGroupPermission(permissions, approverRole, targetRole, "approve_shift_request");
}

const SHIFT_REQUEST_APPROVER_ROLES: ReadonlySet<Role> = new Set([
  "ceo",
  "coo",
  "training_director",
  "hr",
]);

export function isShiftRequestApprover(role: Role): boolean {
  return SHIFT_REQUEST_APPROVER_ROLES.has(role);
}

// Swap approval — ONLY applies to targeted swaps (target_id set); "open"
// swaps stay pure peer-claim, no manager gate. ceo approves any; coo/
// training_director/hr require BOTH the requester and the chosen target to
// be in their own group (safer than requester-only — avoids a manager
// reassigning a shift belonging to someone entirely outside their group),
// checked dynamically via group_permissions. technical never approves
// swaps (view-only everywhere, consistent with its role elsewhere in this
// app). Mirrors can_approve_swap_request() in
// 0048_group_permissions_sql_functions.sql (permission literal
// 'approve_swap') — keep both in sync.
export function canApproveSwapRequestFor(
  approverRole: Role,
  requesterRole: Role,
  targetRole: Role,
  permissions: GroupPermissions
): boolean {
  if (approverRole === "ceo") return true;
  return (
    hasGroupPermission(permissions, approverRole, requesterRole, "approve_swap") &&
    hasGroupPermission(permissions, approverRole, targetRole, "approve_swap")
  );
}

// Front-line roles a new user can self-select at signup (RegisterForm) —
// everything else (management/approver roles: ceo, coo, training_director,
// hr, technical) must be granted by an existing manager via Staff Table,
// never self-chosen. Order matches how they're listed in the dropdown.
// Mirrors the whitelist in handle_new_user() —
// 0020_self_signup_role.sql — keep both in sync: that SQL function is the
// actual security boundary (never trust this TS list alone, since signup
// metadata is client-controlled).
export const SELF_SIGNUP_ROLES = [
  "teacher",
  "operations_staff",
  "student_affairs",
  "teaching_assistant",
  "collaborator",
  "customer_care",
] as const;

export type SelfSignupRole = (typeof SELF_SIGNUP_ROLES)[number];

// Calendar-follow-sidebar grouping (2026-08). The ceo/technical branch
// below is a pure display taxonomy for an already-unrestricted viewer —
// not an access boundary — so it keeps its own fixed tile groupings
// (intentionally diverging from the dynamic group_permissions data, e.g.
// splitting "Đào tạo"/CTV/Trợ giảng into separate tiles) rather than
// reading from group_permissions. The coo/training_director/hr branches
// ARE an access boundary and read live from group_permissions
// (permission 'view_calendar') — a role only appears once granted, and
// each manager's grants collapse into one flat list (no more sub-
// grouping by target role — that finer clustering was cosmetic, not a
// permission difference; see the plan's Out of Scope note).
export type CalendarFollowGroup = { key: string; label: string; roles: ReadonlySet<Role> };

const CALENDAR_TEACHER_ONLY: ReadonlySet<Role> = new Set(["teacher"]);
const CALENDAR_COLLABORATOR_ONLY: ReadonlySet<Role> = new Set(["collaborator"]);
const CALENDAR_TEACHING_ASSISTANT_ONLY: ReadonlySet<Role> = new Set(["teaching_assistant"]);
const CALENDAR_STUDENT_AFFAIRS_ONLY: ReadonlySet<Role> = new Set(["student_affairs"]);
const CALENDAR_OPERATIONS_ONLY: ReadonlySet<Role> = new Set(["hr", "customer_care", "operations_staff"]);
const CALENDAR_MANAGEMENT_ROLES: ReadonlySet<Role> = new Set([
  "ceo",
  "coo",
  "training_director",
  "hr",
  "technical",
]);

// null => this viewer keeps the flat, non-interactive legend (canFollowAll
// is already false for every role that returns null here).
export function getCalendarFollowGroups(role: Role, permissions: GroupPermissions): CalendarFollowGroup[] | null {
  if (role === "ceo" || role === "technical") {
    return [
      { key: "management", label: "Quản lý", roles: CALENDAR_MANAGEMENT_ROLES },
      { key: "operations", label: "Vận hành", roles: CALENDAR_OPERATIONS_ONLY },
      { key: "training", label: "Đào tạo", roles: CALENDAR_TEACHER_ONLY },
      { key: "student_affairs", label: "Quản sinh", roles: CALENDAR_STUDENT_AFFAIRS_ONLY },
      { key: "teaching_assistant", label: "Trợ giảng", roles: CALENDAR_TEACHING_ASSISTANT_ONLY },
      { key: "collaborators", label: "CTV", roles: CALENDAR_COLLABORATOR_ONLY },
    ];
  }
  if (role === "coo" || role === "training_director" || role === "hr") {
    const granted = getGrantedTargetRoles(permissions, role, "view_calendar");
    if (granted.size === 0) return null;
    const label = MANAGER_GROUP_META[role]?.label ?? "Nhóm của bạn";
    return [{ key: "granted", label, roles: granted }];
  }
  return null;
}

// Attendance edit/delete: ceo/technical manage everyone's records (incl.
// old ones, to clean up erroneous check-ins); coo/training_director/hr only
// their own group's people (dynamically, via group_permissions).
// Deliberately NOT reusing isLeaveApprover — this is a net-new capability
// for technical, which approves no leave today. Mirrors
// can_manage_attendance_for() in 0048_group_permissions_sql_functions.sql
// (permission literal 'manage_attendance') — keep both in sync.
export function canManageAttendanceFor(viewerRole: Role, targetRole: Role, permissions: GroupPermissions): boolean {
  if (viewerRole === "ceo" || viewerRole === "technical") return true;
  return hasGroupPermission(permissions, viewerRole, targetRole, "manage_attendance");
}

// Who can open the /manager page at all: manager-tier roles, plus HR for
// its own scoped "Nhóm HR" section (HR itself isn't manager-tier — no
// MANAGER_ROLES/is_manager() access — it just gets a narrow view+approve
// slice of this page, same shape as COO's "Nhóm vận hành" section).
export function canAccessManagerPage(role: Role): boolean {
  return isManagerRole(role) || role === "hr";
}
