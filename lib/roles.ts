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

// The "quản sinh / trợ giảng" group — HR's own group to approve/view,
// split out from TRAINING_GROUP_ROLES (2026-08). Note HR is itself a
// member of OPERATIONS_GROUP_ROLES (their own leave is COO-approved) while
// also being the approver for this separate group — a role can be both a
// group's subject and another group's approver.
export const HR_GROUP_ROLES: ReadonlySet<Role> = new Set(["student_affairs", "teaching_assistant"]);

export function isHrGroupRole(role: Role): boolean {
  return HR_GROUP_ROLES.has(role);
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

// The specific set of roles a "group"-scope viewer can see/follow. Null for
// "all"-scope viewers (no filtering needed) and "none"-scope viewers (no
// follow feature to begin with).
export function getViewableGroupRoles(role: Role): ReadonlySet<Role> | null {
  if (role === "coo") return OPERATIONS_GROUP_ROLES;
  if (role === "training_director") return TRAINING_GROUP_ROLES;
  if (role === "hr") return HR_GROUP_ROLES;
  return null;
}

// Leave-request approval — ceo approves anyone; coo/training_director only
// their own group's people; everyone else (including technical, which only
// gets the read-only analytics dashboard) approves no one. Mirrors
// is_leave_approver()/respond_to_leave_request() in
// 0013_group_scoped_visibility.sql — keep in sync.
const LEAVE_APPROVER_ROLES: ReadonlySet<Role> = new Set(["ceo", "coo", "training_director", "hr"]);

export function isLeaveApprover(role: Role): boolean {
  return LEAVE_APPROVER_ROLES.has(role);
}

export function canApproveLeaveFor(approverRole: Role, targetRole: Role): boolean {
  if (approverRole === "ceo") return true;
  if (approverRole === "coo") return OPERATIONS_GROUP_ROLES.has(targetRole);
  if (approverRole === "training_director") return TRAINING_GROUP_ROLES.has(targetRole);
  if (approverRole === "hr") return HR_GROUP_ROLES.has(targetRole);
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

// Shift-request approval: CEO approves anyone; HR only their own group
// (student_affairs/teaching_assistant). Mirrors can_approve_shift_request()
// in 0019_hr_group_student_affairs_teaching_assistant.sql — keep in sync.
export function canApproveShiftRequestFor(approverRole: Role, targetRole: Role): boolean {
  if (approverRole === "ceo") return true;
  if (approverRole === "hr") return HR_GROUP_ROLES.has(targetRole);
  return false;
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

// Calendar-follow-sidebar grouping (2026-08) — deliberately SEPARATE from
// OPERATIONS_GROUP_ROLES/TRAINING_GROUP_ROLES/HR_GROUP_ROLES above, which
// drive leave/shift-request approval and must not change. The calendar
// groups diverge on purpose: "Đào tạo" here is {teacher} only (not
// {teacher, collaborator} — CTV gets its own group for ceo/technical and
// is dropped entirely from training_director's calendar view), and
// training_director additionally gets a Trợ giảng-only group for VIEWING
// teaching_assistant's calendar — see 0029_calendar_visibility_training_
// director_teaching_assistant.sql for the matching RLS widening. HR
// remains the sole approver for teaching_assistant either way.
export type CalendarFollowGroup = { key: string; label: string; roles: ReadonlySet<Role> };

const CALENDAR_TEACHER_ONLY: ReadonlySet<Role> = new Set(["teacher"]);
const CALENDAR_COLLABORATOR_ONLY: ReadonlySet<Role> = new Set(["collaborator"]);
const CALENDAR_TEACHING_ASSISTANT_ONLY: ReadonlySet<Role> = new Set(["teaching_assistant"]);
const CALENDAR_MANAGEMENT_ROLES: ReadonlySet<Role> = new Set([
  "ceo",
  "coo",
  "training_director",
  "hr",
  "technical",
]);

// null => this viewer keeps the flat, non-interactive legend (canFollowAll
// is already false for every role that returns null here).
export function getCalendarFollowGroups(role: Role): CalendarFollowGroup[] | null {
  if (role === "ceo" || role === "technical") {
    return [
      { key: "management", label: "Quản lý", roles: CALENDAR_MANAGEMENT_ROLES },
      { key: "operations", label: "Vận hành", roles: OPERATIONS_GROUP_ROLES },
      { key: "training", label: "Đào tạo", roles: CALENDAR_TEACHER_ONLY },
      { key: "hr_group", label: "Quản sinh + Trợ giảng", roles: HR_GROUP_ROLES },
      { key: "collaborators", label: "CTV", roles: CALENDAR_COLLABORATOR_ONLY },
    ];
  }
  if (role === "coo") {
    return [{ key: "operations", label: "Nhóm vận hành", roles: OPERATIONS_GROUP_ROLES }];
  }
  if (role === "hr") {
    return [{ key: "hr_group", label: "Nhóm trợ giảng + quản sinh", roles: HR_GROUP_ROLES }];
  }
  if (role === "training_director") {
    return [
      { key: "training", label: "Đào tạo", roles: CALENDAR_TEACHER_ONLY },
      { key: "teaching_assistant", label: "Trợ giảng", roles: CALENDAR_TEACHING_ASSISTANT_ONLY },
    ];
  }
  return null;
}

// Who can open the /manager page at all: manager-tier roles, plus HR for
// its own scoped "Nhóm HR" section (HR itself isn't manager-tier — no
// MANAGER_ROLES/is_manager() access — it just gets a narrow view+approve
// slice of this page, same shape as COO's "Nhóm vận hành" section).
export function canAccessManagerPage(role: Role): boolean {
  return isManagerRole(role) || role === "hr";
}
