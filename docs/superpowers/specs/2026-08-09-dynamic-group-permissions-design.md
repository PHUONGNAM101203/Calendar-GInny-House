# Dynamic Group Permissions — Design

## Context

Group-based authorization (which manager role can create shifts / approve
requests / manage attendance / view calendars for which front-line roles)
is currently hardcoded across `lib/roles.ts` (3 `ReadonlySet<Role>` constants
+ 6 predicate functions) and mirrored in SQL (`supabase/migrations/0013`,
`0019`, `0038`, `0043`, `0044`). Every time the org wants a manager to gain
or lose authority over a group (e.g. "GĐ đào tạo cần thêm quyền quản lý
Quản sinh"), it requires a code change + migration + deploy.

The user (kỹ thuật/technical, effectively the app's sole maintainer) wants
to self-serve this from the Technical dashboard: tick which groups each of
the 3 group-scoped managers (COO, GĐ đào tạo, HR) can act on, per
permission type, without needing a code change.

## Scope

**Editable rows (managers):** COO, GĐ đào tạo (`training_director`), HR —
the only 3 roles that already have a "group" concept
(`getViewableGroupRoles`). CEO and Kỹ thuật (`technical`) stay hardcoded
unrestricted (`viewerRole === "ceo" || viewerRole === "technical"` short-
circuits in every predicate) — never appear as editable rows.

**Editable columns (targets):** exactly the 7 roles that are not
themselves org-wide-unrestricted or one of the 3 editable managers —
`teacher`, `collaborator`, `student_affairs`, `teaching_assistant`,
`operations_staff`, `customer_care`, and `hr`. `hr` is included as a valid
target despite also being an editable manager row — it already is one
today (COO's operations group includes `hr`; see `OPERATIONS_GROUP_ROLES`
and the "a role can be both a group's subject and another group's
approver" comment in `lib/roles.ts`). `ceo`, `coo`, `training_director`,
`technical` are never valid targets — excluded from the UI entirely, to
close off privilege-escalation paths (no manager should ever be tickable
as "managed by" another group).

**Editable permission types (6, independent, all initially seeded to
match today's behavior):**
- `create_shift` — mirrors `canCreateShiftFor` / `can_manage_shift_for()`
- `approve_shift_request` — mirrors `canApproveShiftRequestFor` /
  `can_approve_shift_request()`
- `approve_swap` — mirrors `canApproveSwapRequestFor` /
  `can_approve_swap_request()` (still swap-specific rule: BOTH requester
  and target must satisfy the check for the same permission type)
- `approve_leave` — mirrors `canApproveLeaveFor` / `is_leave_approver()`-
  adjacent RPC logic
- `manage_attendance` — mirrors `canManageAttendanceFor` /
  `can_manage_attendance_for()`
- `view_calendar` — mirrors the group-scoped branch of
  `getCalendarFollowGroups` (coo/training_director/hr branches only — the
  ceo/technical "all" branch and the flat per-role group labels used for
  UI clustering are unaffected; a granted role just appears in a single
  flat "Nhóm" list instead of today's finer sub-grouping, e.g.
  training_director's separate "Đào tạo" vs "Trợ giảng" visual clusters
  collapse into one list. This is a presentation simplification, not a
  permission change.)

Ticking one permission type has **no side effect on any other type** —
each of the 6 is an independent boolean per (manager, target) pair. No
automatic bundling (confirmed with user).

**Overlap allowed:** a target role may be granted to more than one
manager simultaneously (e.g. both COO and HR could independently manage
`hr`... not applicable since hr can't manage itself, but e.g. two
different managers both granted `teacher` is valid and unenforced against).

**Who can edit:** only `technical`. Not even `ceo` sees/edits this section
(explicit user decision — the app's other "who has full power" precedent
of pairing ceo+technical does NOT apply here).

## Data Model

```sql
create table public.group_permissions (
  manager_role public.user_role not null,
  target_role  public.user_role not null,
  permission   text not null,
  created_at   timestamptz not null default now(),
  constraint group_permissions_permission_valid check (permission in (
    'create_shift', 'approve_shift_request', 'approve_swap',
    'approve_leave', 'manage_attendance', 'view_calendar'
  )),
  constraint group_permissions_manager_valid check (
    manager_role in ('coo', 'training_director', 'hr')
  ),
  constraint group_permissions_target_valid check (
    target_role in ('teacher', 'collaborator', 'student_affairs',
      'teaching_assistant', 'operations_staff', 'customer_care', 'hr')
  ),
  primary key (manager_role, target_role, permission)
);
```

RLS: SELECT restricted to `technical` (and implicitly bypassed by every
`security definer` predicate function below, which read the table
regardless of the caller's own RLS visibility — same pattern as every
other `can_x_for()` function in this codebase). INSERT/UPDATE/DELETE
restricted to `technical` only.

A seed migration inserts one row per (manager, target, permission) that
is `true` under **today's** hardcoded logic — i.e. exactly reproduces
`OPERATIONS_GROUP_ROLES` × all 6 permissions for `coo`,
`TRAINING_GROUP_ROLES` × all 6 for `training_director`,
`HR_GROUP_ROLES` × all 6 for `hr`. Day-1 behavior is unchanged; only the
storage moves from code to data.

## SQL Layer

Each of the 5 existing `security definer` predicate functions
(`can_manage_shift_for`, `can_approve_shift_request`,
`can_approve_swap_request`, and the leave/attendance equivalents) drops
its hardcoded per-manager-role `case` branches for `coo`/`training_director`/
`hr` and replaces them with a single `exists` lookup against
`group_permissions`, keyed by the caller's own role, the target's role,
and the fixed permission-type literal for that function. The
`ceo`/`technical` unconditional-true branch is unchanged. `can_view_profile`
(calendar visibility, `0013`) gets the same treatment for its
`coo`/`training_director`/`hr` branches, keyed to `view_calendar`.

This is a net simplification in SQL — 5-6 near-duplicated `case`
statements collapse to the same `exists (select 1 from group_permissions
where manager_role = ... and target_role = ... and permission = '...')`
shape, differing only in the literal.

## TypeScript Layer

`getViewableGroupRoles(role): ReadonlySet<Role> | null` is retired — it
no longer has a single meaning once each permission type can differ. In
its place, `lib/permissions.ts` (new file) exports:

```ts
export type GroupPermissionType =
  | "create_shift" | "approve_shift_request" | "approve_swap"
  | "approve_leave" | "manage_attendance" | "view_calendar";

// One row fetched per (manager_role, target_role, permission) that's
// currently granted. Fetched once per request via a Server Component,
// threaded down as a prop — same pattern as `branches`/`profile` today.
export type GroupPermissions = ReadonlyMap<string, true>; // key: `${manager}:${target}:${permission}`

export async function getGroupPermissions(): Promise<GroupPermissions>; // lib/supabase/server.ts read, ceo/technical-only table but every authenticated request needs the resolved booleans — fetched server-side via the request's own session (RLS-limited to technical) is insufficient for a non-technical viewer's own request, so this read uses supabaseAdmin (server-only, never shipped to client) the same way lib/push.ts already does for cross-account lookups.

export function hasGroupPermission(
  permissions: GroupPermissions,
  managerRole: Role,
  targetRole: Role,
  type: GroupPermissionType
): boolean;
```

The 6 existing predicate functions in `lib/roles.ts` keep their names and
`ceo`/`technical` short-circuit, but each gains a trailing
`permissions: GroupPermissions` parameter and delegates the
group-scoped branch to `hasGroupPermission(...)` instead of a hardcoded
`Set.has()`. Every call site (11 files — `app/(app)/calendar/page.tsx`,
`app/(app)/leave/page.tsx`, `app/(app)/manager/page.tsx`,
`app/(app)/layout.tsx`, `components/calendar/ShiftCalendar.tsx`,
`components/calendar/AttendanceDetailDialog.tsx`, `actions/shifts.ts`,
`actions/attendance.ts`, `lib/push.ts`, `lib/notifications.ts`,
`lib/calendar.ts`) gains the extra parameter, sourced from one
`getGroupPermissions()` call per Server Component page/layout and passed
down as a prop to client components — mechanical, not architectural: this
is the exact prop-threading pattern the codebase already uses everywhere
else (no new client-side data fetching, no caching layer, no
`revalidateTag` — table is tiny, a plain per-request read is cheap and
never stale).

## UI

New collapsible section in `components/manager/TechnicalDashboard.tsx`:
one block per manager (COO / GĐ đào tạo / HR), each a 7-row × 6-column
checkbox grid (row = target role, column = permission type). Backed by a
new Server Action `updateGroupPermissionAction(managerRole, targetRole,
permission, granted)` in a new `actions/group-permissions.ts`
(`requireProfile()` + explicit `profile.role !== "technical"` gate on top
of RLS, zod-validated against the same 3/7/6 whitelists as the DB
constraints, `revalidatePath` every route whose data the change could
affect: `/calendar`, `/manager`, `/leave`, `/attendance`).

## Out of Scope

- No audit trail / history of who changed what (no existing pattern for
  this in the codebase; can be added later if needed).
- No support for adding new manager roles or new target roles through
  this UI — the row/column universe is fixed by the CHECK constraints
  above; introducing a genuinely new role still requires a code change
  (new enum value, new UI copy, etc.) regardless.
- `getCalendarFollowGroups`'s `ceo`/`technical` "all" branch and its
  finer visual sub-grouping (separate CTV/Trợ giảng clusters) are
  unaffected — only the `coo`/`training_director`/`hr` branches move to
  `view_calendar` lookups, collapsing to one flat list per manager.
