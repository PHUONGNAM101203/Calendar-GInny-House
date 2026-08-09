# Dynamic Group Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `OPERATIONS_GROUP_ROLES`/`TRAINING_GROUP_ROLES`/`HR_GROUP_ROLES` sets and their 6 mirrored SQL functions with a `group_permissions` table that `technical` edits from the dashboard, so granting a manager new group authority never needs a code change again.

**Architecture:** One Postgres table (`group_permissions`, keyed `manager_role, target_role, permission`) becomes the single source of truth. 6 existing `security definer` SQL functions swap their hardcoded `case` branches for a lookup against this table. 6 existing TS predicates in `lib/roles.ts` gain a `permissions: GroupPermissions` parameter, fed by one new `getGroupPermissions()` fetch threaded through every Server Component page down to the client components that need it — the same prop-threading pattern this codebase already uses for `branches`/`profile`.

**Tech Stack:** Next.js 16 Server Components + Server Actions, Supabase Postgres/RLS, no test framework (this repo has none — verification is `tsc --noEmit` + `eslint` + live Supabase checks against disposable `auth.admin.createUser()` accounts, exactly as done for every prior migration this session).

## Global Constraints

- All new UI copy is Vietnamese, matching existing tone (see `lib/roles.ts` `ROLE_LABELS` for the reference vocabulary).
- Every SQL predicate function keeps its **exact current name and parameter signature** — only bodies change — so no RLS policy or RPC that calls them needs editing beyond the 6 functions themselves.
- `ceo`/`technical` keep their unconditional-true bypass in every function; only the `coo`/`training_director`/`hr` branches move to the table lookup.
- Do not touch `/calendar` route files' *visual* design — only the permission-check logic inside `components/calendar/ShiftCalendar.tsx` and `components/calendar/AttendanceDetailDialog.tsx` (already-granted lock exception from this session's earlier group-scoped-shift-management work covers logic-only edits here; no new exception needed).
- Migration numbers: next two are `0047` and `0048` (last existing is `0046_auto_checkout_2h_grace_period.sql`).

## Key Design Facts From Research (read before starting — not in the original spec)

1. **`approve_leave` covers giải trình công (attendance corrections) too.** `respond_to_leave_request()` and `respond_to_attendance_correction()` both currently gate on the same SQL function (`can_view_profile`), and `manager/page.tsx`'s `AttendanceCorrectionCard` already reuses `canApproveLeaveFor` for its `canRespond` prop (`app/(app)/manager/page.tsx:342-346`). There is **no 7th permission type** — `approve_leave` permission-type rows govern both request kinds, preserving exactly what's coupled today.

2. **`view_calendar`'s seed data is NOT the same shape as the other 5 types.** The SQL function backing calendar/shift/attendance/profile visibility (`can_view_profile_calendar`, defined in `0029`) grants `training_director` a **wider** set than every other function: `{teacher, collaborator, teaching_assistant}`, vs. `{teacher, collaborator}` for the other 5 permission types. `coo` and `hr`'s sets are identical across all 6 types. Get this seed row set exactly right in Task 1 — it is the one place the 6 types are NOT uniform.

3. **`manager/page.tsx`'s dashboard filtering currently uses ONE unified `groupRoles` set for everything** (staff roster, attendance, leave, swaps, shift-requests, attendance-corrections, shifts-today count) via `getViewableGroupRoles()`. Since permission types are now independent, this single set must split into per-section filters keyed by the section's actual governing permission type:
   - Staff roster (`scopedStaff`/`scopedStaffIds`, and `scopedShiftsToday` which derives from it) → **union of all 6 types** (broadest "who do I manage in any capacity" — there's no dedicated "roster" permission type)
   - `scopedClockedIn`, `scopedAttendance` → `view_calendar` (matches what `attendance_select_branch` RLS actually grants)
   - `scopedLeaves` → `approve_leave`
   - `scopedSwaps` → `approve_swap`
   - `scopedShiftRequests` → `approve_shift_request`
   - `scopedAttendanceCorrections` → `approve_leave`
   - `groupMeta` (section header text) → unchanged, still keyed by `manager.role` alone (cosmetic, not data-driven — see Out of Scope in the spec)

3 files own the two SQL functions that get merged treatment: `can_view_profile` (permission literal `'approve_leave'`) and `can_view_profile_calendar` (permission literal `'view_calendar'`) — both keep their own name and their own `auth.uid() = p_target_id` self-visibility bypass, only the group branch changes.

---

### Task 1: `group_permissions` table + RLS + seed migration

**Files:**
- Create: `supabase/migrations/0047_group_permissions.sql`

**Interfaces:**
- Produces: table `public.group_permissions(manager_role, target_role, permission)`, readable/writable only by `technical`, containing every row that reproduces today's hardcoded behavior — consumed by Task 2's SQL functions.

- [ ] **Step 1: Write the migration**

```sql
-- Data-driven replacement for lib/roles.ts's OPERATIONS_GROUP_ROLES/
-- TRAINING_GROUP_ROLES/HR_GROUP_ROLES + the 6 SQL functions that hardcode
-- them (can_manage_shift_for, can_approve_shift_request,
-- can_approve_swap_request, can_view_profile, can_view_profile_calendar,
-- can_manage_attendance_for). technical edits this from the dashboard
-- instead of needing a code change + migration + deploy every time a
-- manager's group authority changes. See
-- docs/superpowers/specs/2026-08-09-dynamic-group-permissions-design.md.
create table public.group_permissions (
  manager_role public.user_role not null,
  target_role  public.user_role not null,
  permission   text not null,
  created_at   timestamptz not null default now(),
  constraint group_permissions_permission_valid check (permission in (
    'create_shift', 'approve_shift_request', 'approve_swap',
    'approve_leave', 'manage_attendance', 'view_calendar'
  )),
  -- Only the 3 roles that already have a "group" concept can be a row's
  -- manager — ceo/technical stay unconditionally unrestricted in every
  -- predicate function and never consult this table.
  constraint group_permissions_manager_valid check (
    manager_role in ('coo', 'training_director', 'hr')
  ),
  -- Never allow a manager-tier role (ceo/coo/training_director/technical)
  -- as a target — closes the privilege-escalation path of one group
  -- manager being granted authority over another. hr IS a valid target
  -- (coo's operations group includes hr today) despite hr also being an
  -- editable manager row — a role can be both a group's subject and
  -- another group's approver, same precedent as HR_GROUP_ROLES's comment
  -- in lib/roles.ts.
  constraint group_permissions_target_valid check (
    target_role in ('teacher', 'collaborator', 'student_affairs',
      'teaching_assistant', 'operations_staff', 'customer_care', 'hr')
  ),
  primary key (manager_role, target_role, permission)
);

alter table public.group_permissions enable row level security;

create policy group_permissions_select_technical on public.group_permissions
  for select to authenticated
  using ((select role from public.profiles where id = auth.uid()) = 'technical');

create policy group_permissions_write_technical on public.group_permissions
  for all to authenticated
  using ((select role from public.profiles where id = auth.uid()) = 'technical')
  with check ((select role from public.profiles where id = auth.uid()) = 'technical');

-- Seed: exactly reproduce today's hardcoded OPERATIONS_GROUP_ROLES/
-- TRAINING_GROUP_ROLES/HR_GROUP_ROLES for all 6 permission types, EXCEPT
-- view_calendar's training_director row, which is wider today (adds
-- teaching_assistant — see can_view_profile_calendar in 0029). Day-1
-- behavior is unchanged; only the storage moves from code to data.
insert into public.group_permissions (manager_role, target_role, permission)
select m.manager_role, m.target_role, p.permission
from (values
  ('coo', 'hr'), ('coo', 'customer_care'), ('coo', 'operations_staff'),
  ('training_director', 'teacher'), ('training_director', 'collaborator'),
  ('hr', 'student_affairs'), ('hr', 'teaching_assistant')
) as m(manager_role, target_role)
cross join (values
  ('create_shift'), ('approve_shift_request'), ('approve_swap'),
  ('approve_leave'), ('manage_attendance')
) as p(permission);

insert into public.group_permissions (manager_role, target_role, permission)
values
  ('coo', 'hr', 'view_calendar'), ('coo', 'customer_care', 'view_calendar'), ('coo', 'operations_staff', 'view_calendar'),
  ('training_director', 'teacher', 'view_calendar'), ('training_director', 'collaborator', 'view_calendar'),
  ('training_director', 'teaching_assistant', 'view_calendar'),
  ('hr', 'student_affairs', 'view_calendar'), ('hr', 'teaching_assistant', 'view_calendar');
```

- [ ] **Step 2: Apply and verify row count**

Run: `npx supabase db push`
Then verify the seed landed correctly (43 rows total: 5 types × 7 (manager,target) pairs = 35, plus 8 view_calendar rows):

```bash
cat > .verify-0047.mjs << 'EOF'
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0,i), l.slice(i+1)]; }));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await admin.from("group_permissions").select("*");
if (error) { console.error("FAIL", error); process.exit(1); }
console.log("total rows (expect 43):", data.length);
console.log("view_calendar rows for training_director (expect 3):", data.filter(r => r.manager_role === "training_director" && r.permission === "view_calendar").length);
EOF
node .verify-0047.mjs
rm .verify-0047.mjs
```
Expected: `total rows (expect 43): 43` and `view_calendar rows for training_director (expect 3): 3`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0047_group_permissions.sql
git commit -m "feat: group_permissions table, seeded to match current hardcoded groups"
```

---

### Task 2: Rewrite the 6 SQL predicate functions to read from `group_permissions`

**Files:**
- Create: `supabase/migrations/0048_group_permissions_sql_functions.sql`

**Interfaces:**
- Consumes: `public.group_permissions` table from Task 1.
- Produces: same 6 function names/signatures as before, now table-driven — no other SQL file needs to change (every RLS policy and RPC that calls these by name transparently picks up the new body).

- [ ] **Step 1: Write the migration**

```sql
-- Point A: the 6 predicate functions collapse their coo/training_director/hr
-- case branches into one shared shape — a lookup against group_permissions
-- keyed by the caller's own role, the target's role, and this function's
-- fixed permission-type literal. ceo/technical's unconditional-true branch
-- (and self-visibility bypass, where present) is unchanged.
create or replace function public.can_manage_shift_for(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when (select role from public.profiles where id = auth.uid()) in ('ceo', 'technical') then true
    else exists (
      select 1 from public.group_permissions gp
      where gp.manager_role = (select role from public.profiles where id = auth.uid())
        and gp.target_role = (select role from public.profiles where id = p_target_id)
        and gp.permission = 'create_shift'
    )
  end;
$$;

create or replace function public.can_approve_shift_request(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_ceo() then true
    else exists (
      select 1 from public.group_permissions gp
      where gp.manager_role = (select role from public.profiles where id = auth.uid())
        and gp.target_role = (select role from public.profiles where id = p_target_id)
        and gp.permission = 'approve_shift_request'
    )
  end;
$$;

create or replace function public.can_approve_swap_request(p_requester_id uuid, p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_ceo() then true
    else
      exists (
        select 1 from public.group_permissions gp
        where gp.manager_role = (select role from public.profiles where id = auth.uid())
          and gp.target_role = (select role from public.profiles where id = p_requester_id)
          and gp.permission = 'approve_swap'
      )
      and exists (
        select 1 from public.group_permissions gp
        where gp.manager_role = (select role from public.profiles where id = auth.uid())
          and gp.target_role = (select role from public.profiles where id = p_target_id)
          and gp.permission = 'approve_swap'
      )
  end;
$$;

-- Governs BOTH respond_to_leave_request() and respond_to_attendance_correction()
-- — both already shared this function before this migration; that coupling
-- is preserved on purpose (see plan's Key Design Facts §1).
create or replace function public.can_view_profile(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() = p_target_id then true
    when (select role from public.profiles where id = auth.uid()) in ('ceo', 'technical') then true
    else exists (
      select 1 from public.group_permissions gp
      where gp.manager_role = (select role from public.profiles where id = auth.uid())
        and gp.target_role = (select role from public.profiles where id = p_target_id)
        and gp.permission = 'approve_leave'
    )
  end;
$$;

create or replace function public.can_view_profile_calendar(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() = p_target_id then true
    when (select role from public.profiles where id = auth.uid()) in ('ceo', 'technical') then true
    else exists (
      select 1 from public.group_permissions gp
      where gp.manager_role = (select role from public.profiles where id = auth.uid())
        and gp.target_role = (select role from public.profiles where id = p_target_id)
        and gp.permission = 'view_calendar'
    )
  end;
$$;

create or replace function public.can_manage_attendance_for(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when (select role from public.profiles where id = auth.uid()) in ('ceo', 'technical') then true
    else exists (
      select 1 from public.group_permissions gp
      where gp.manager_role = (select role from public.profiles where id = auth.uid())
        and gp.target_role = (select role from public.profiles where id = p_target_id)
        and gp.permission = 'manage_attendance'
    )
  end;
$$;
```

- [ ] **Step 2: Apply**

Run: `npx supabase db push`

- [ ] **Step 3: Live regression check — every function must return identical results to before this migration**

```bash
cat > .verify-0048.mjs << 'EOF'
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0,i), l.slice(i+1)]; }));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function makeUser(role) {
  const email = `verify-0048-${role}-${Date.now()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "verify-test-password-123", email_confirm: true });
  if (error) throw error;
  await admin.from("profiles").update({ role, full_name: `Verify ${role}` }).eq("id", data.user.id);
  return data.user.id;
}

const coo = await makeUser("coo");
const teacher = await makeUser("teacher");
const operationsStaff = await makeUser("operations_staff");

const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
await admin.auth.admin.updateUserById(coo, { password: "verify-test-password-123" });
const cooEmail = (await admin.auth.admin.getUserById(coo)).data.user.email;
await client.auth.signInWithPassword({ email: cooEmail, password: "verify-test-password-123" });

const { data: canManageOps } = await client.rpc("can_manage_shift_for", { p_target_id: operationsStaff });
const { data: canManageTeacher } = await client.rpc("can_manage_shift_for", { p_target_id: teacher });
console.log("coo can_manage_shift_for operations_staff (expect true):", canManageOps);
console.log("coo can_manage_shift_for teacher (expect false):", canManageTeacher);
if (canManageOps !== true || canManageTeacher !== false) { console.error("FAIL"); process.exit(1); }

for (const id of [coo, teacher, operationsStaff]) await admin.auth.admin.deleteUser(id);
console.log("ALL PASS");
EOF
node .verify-0048.mjs
rm .verify-0048.mjs
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0048_group_permissions_sql_functions.sql
git commit -m "refactor: 6 permission SQL functions read group_permissions instead of hardcoded case branches"
```

---

### Task 3: `lib/permissions.ts` — new TS module

**Files:**
- Create: `lib/permissions.ts`

**Interfaces:**
- Consumes: `supabaseAdmin` from `lib/supabase/admin.ts` (server-only, same pattern `lib/push.ts` already uses for cross-account reads that RLS would otherwise block for a non-technical viewer).
- Produces: `GroupPermissionType`, `GroupPermissions`, `getGroupPermissions()`, `hasGroupPermission()`, `getGrantedTargetRoles()`, `getGrantedTargetRolesUnion()` — consumed by every task after this one.

- [ ] **Step 1: Write the module**

```ts
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Role } from "@/types";

export type GroupPermissionType =
  | "create_shift"
  | "approve_shift_request"
  | "approve_swap"
  | "approve_leave"
  | "manage_attendance"
  | "view_calendar";

export const GROUP_PERMISSION_TYPES: readonly GroupPermissionType[] = [
  "create_shift",
  "approve_shift_request",
  "approve_swap",
  "approve_leave",
  "manage_attendance",
  "view_calendar",
];

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
export const GROUP_MANAGER_ROLES: readonly Role[] = ["coo", "training_director", "hr"];
export const GROUP_TARGET_ROLES: readonly Role[] = [
  "teacher",
  "collaborator",
  "student_affairs",
  "teaching_assistant",
  "operations_staff",
  "customer_care",
  "hr",
];

function key(managerRole: Role, targetRole: Role, permission: GroupPermissionType): string {
  return `${managerRole}:${targetRole}:${permission}`;
}

// One boolean per granted (manager, target, permission) triple — absence
// means not granted. Fetched once per request (table has ≤ a few dozen
// rows; no caching layer needed, never stale).
export type GroupPermissions = ReadonlySet<string>;

// Uses supabaseAdmin (service role, bypasses RLS) because group_permissions
// is readable only by `technical` (see 0047's RLS policy), but every
// authenticated request — regardless of the viewer's own role — needs to
// resolve whether IT has a given permission. Same pattern lib/push.ts
// already uses for cross-account lookups; never imported into a client
// component.
export async function getGroupPermissions(): Promise<GroupPermissions> {
  const { data } = await supabaseAdmin.from("group_permissions").select("manager_role, target_role, permission");
  return new Set((data ?? []).map((r) => key(r.manager_role as Role, r.target_role as Role, r.permission as GroupPermissionType)));
}

export function hasGroupPermission(
  permissions: GroupPermissions,
  managerRole: Role,
  targetRole: Role,
  type: GroupPermissionType
): boolean {
  return permissions.has(key(managerRole, targetRole, type));
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
// dashboard's staff roster — see plan's Key Design Facts §3), since there
// is no dedicated "roster" permission type.
export function getGrantedTargetRolesUnion(permissions: GroupPermissions, managerRole: Role): ReadonlySet<Role> {
  const roles = new Set<Role>();
  for (const type of GROUP_PERMISSION_TYPES) {
    for (const target of getGrantedTargetRoles(permissions, managerRole, type)) roles.add(target);
  }
  return roles;
}
```

- [ ] **Step 2: Verify it compiles standalone**

Run: `npx tsc --noEmit`
Expected: no new errors (this file has no callers yet).

- [ ] **Step 3: Commit**

```bash
git add lib/permissions.ts
git commit -m "feat: add lib/permissions.ts — GroupPermissions fetch + lookup helpers"
```

---

### Task 4: `lib/roles.ts` — thread `permissions` through the 6 predicates, retire the hardcoded Sets

**Files:**
- Modify: `lib/roles.ts`

**Interfaces:**
- Consumes: `GroupPermissions`, `hasGroupPermission`, `GroupPermissionType` from Task 3's `lib/permissions.ts`.
- Produces: new signatures for `canCreateShiftFor`, `canApproveShiftRequestFor`, `canApproveSwapRequestFor`, `canApproveLeaveFor`, `canManageAttendanceFor`, `getCalendarFollowGroups` — every later task's call sites must match these exactly.

- [ ] **Step 1: Remove the 3 hardcoded group constants and `getViewableGroupRoles`**

Delete `OPERATIONS_GROUP_ROLES`, `isOperationsGroupRole`, `TRAINING_GROUP_ROLES`, `isTrainingGroupRole`, `HR_GROUP_ROLES`, `isHrGroupRole`, `getViewableGroupRoles` (lines 63–119 in the current file). Keep `MANAGER_GROUP_META` (cosmetic labels, unaffected — see plan's Key Design Facts §3) and `getCalendarScope`/`canSeeAllCalendars` (coarse role-tier checks, no target-role logic, untouched).

- [ ] **Step 2: Update the 5 non-calendar predicates to accept `permissions`**

```ts
import { hasGroupPermission, type GroupPermissions } from "@/lib/permissions";

export function canApproveLeaveFor(approverRole: Role, targetRole: Role, permissions: GroupPermissions): boolean {
  if (approverRole === "ceo") return true;
  return hasGroupPermission(permissions, approverRole, targetRole, "approve_leave");
}

export function canCreateShiftFor(viewerRole: Role, targetRole: Role, permissions: GroupPermissions): boolean {
  if (viewerRole === "ceo" || viewerRole === "technical") return true;
  return hasGroupPermission(permissions, viewerRole, targetRole, "create_shift");
}

export function canApproveShiftRequestFor(approverRole: Role, targetRole: Role, permissions: GroupPermissions): boolean {
  if (approverRole === "ceo") return true;
  return hasGroupPermission(permissions, approverRole, targetRole, "approve_shift_request");
}

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

export function canManageAttendanceFor(viewerRole: Role, targetRole: Role, permissions: GroupPermissions): boolean {
  if (viewerRole === "ceo" || viewerRole === "technical") return true;
  return hasGroupPermission(permissions, viewerRole, targetRole, "manage_attendance");
}
```

(Keep every existing doc comment's *content* — just update the "Mirrors X in migration Y" references to point at `0048_group_permissions_sql_functions.sql` instead of the old migration numbers.)

- [ ] **Step 3: Update `getCalendarFollowGroups`**

Its `ceo`/`technical` branch (org-wide taxonomy tiles) is unchanged — those groupings are informational labels for an already-unrestricted viewer, not an access boundary, and intentionally diverge from the group-permission constants per the existing comment (keep it). Only the `coo`/`training_director`/`hr` branches change, from the hardcoded constants to `getGrantedTargetRoles`:

```ts
export function getCalendarFollowGroups(role: Role, permissions: GroupPermissions): CalendarFollowGroup[] | null {
  if (role === "ceo" || role === "technical") {
    return [
      { key: "management", label: "Quản lý", roles: CALENDAR_MANAGEMENT_ROLES },
      { key: "operations", label: "Vận hành", roles: new Set(["hr", "customer_care", "operations_staff"]) },
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
```

`CALENDAR_MANAGEMENT_ROLES`'s literal `new Set([...])` for the ceo/technical "operations" tile replaces its former `OPERATIONS_GROUP_ROLES` reference (that constant no longer exists per Step 1) — inline the same 3-role literal directly, since it was always just a display grouping, not the access-control set.

Add the import at the top of the file: `import { hasGroupPermission, getGrantedTargetRoles, type GroupPermissions } from "@/lib/permissions";`.

- [ ] **Step 4: Verify compile errors point only at call sites (expected — fixed in later tasks)**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: a nonzero count, all in files listed in Tasks 5–9 below (every caller of the 6 changed functions now needs an extra argument). Do not fix any call site from this task — that's the point of the remaining tasks existing separately.

- [ ] **Step 5: Commit**

```bash
git add lib/roles.ts
git commit -m "refactor: lib/roles.ts predicates take GroupPermissions instead of hardcoded Sets"
```

---

### Task 5: Thread `permissions` through Server Component pages

**Files:**
- Modify: `app/(app)/calendar/page.tsx`
- Modify: `app/(app)/leave/page.tsx`
- Modify: `app/(app)/manager/page.tsx`
- Modify: `app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `getGroupPermissions()` (Task 3), the 6 updated predicates (Task 4).
- Produces: `permissions` prop passed into `ShiftCalendarLoader`/`ShiftCalendar` (consumed by Task 8) and `ManagerDashboard`/`AttendanceCorrectionCard`/etc. (consumed inline in this task for `manager/page.tsx` since those are Server-Component-computed booleans, not further-threaded props).

- [ ] **Step 1: `app/(app)/layout.tsx`**

Add `const permissions = await getGroupPermissions();` alongside the existing `Promise.all` data fetch, and pass it into `buildNotifications({..., permissions})`. Import: `import { getGroupPermissions } from "@/lib/permissions";`.

(Task 7 updates `buildNotifications`'s signature to accept and use it — this task only wires the fetch+pass at the call site.)

- [ ] **Step 2: `app/(app)/leave/page.tsx`**

```ts
import { getGroupPermissions } from "@/lib/permissions";
// ... inside the page component, alongside existing profile/data fetches:
const permissions = await getGroupPermissions();
```

Update every `canApproveLeaveFor(profile.role, r.profile.role)` call (lines 24, 31, 35 currently) to `canApproveLeaveFor(profile.role, r.profile.role, permissions)`.

- [ ] **Step 3: `app/(app)/calendar/page.tsx`**

```ts
import { getGroupPermissions } from "@/lib/permissions";
// ... alongside existing data fetches:
const permissions = await getGroupPermissions();
```

Pass `permissions` as a new prop into `ShiftCalendarLoader` (Task 8 threads it the rest of the way into `ShiftCalendar`). `canCreateShiftDirectly`/`canSeeAllCalendars` calls on this page are unchanged (coarse role checks, no group data needed).

- [ ] **Step 4: `app/(app)/manager/page.tsx`**

Replace the single `groupRoles`/`groupMeta` block with per-section sets, per the plan's Key Design Facts §3:

```ts
import { getGroupPermissions, getGrantedTargetRolesUnion, getGrantedTargetRoles } from "@/lib/permissions";
// remove: import { getViewableGroupRoles, MANAGER_GROUP_META } from "@/lib/roles";
import { MANAGER_GROUP_META } from "@/lib/roles";

// ... alongside existing data fetches:
const permissions = await getGroupPermissions();

const isGroupManager = manager.role === "coo" || manager.role === "training_director" || manager.role === "hr";
const groupMeta = isGroupManager ? MANAGER_GROUP_META[manager.role] : undefined;

const rosterRoles = isGroupManager ? getGrantedTargetRolesUnion(permissions, manager.role) : null;
const calendarRoles = isGroupManager ? getGrantedTargetRoles(permissions, manager.role, "view_calendar") : null;
const leaveRoles = isGroupManager ? getGrantedTargetRoles(permissions, manager.role, "approve_leave") : null;
const shiftRequestRoles = isGroupManager ? getGrantedTargetRoles(permissions, manager.role, "approve_shift_request") : null;

const scopedStaff = rosterRoles ? staffList.filter((s) => rosterRoles.has(s.role)) : staffList;
const scopedStaffIds = new Set(scopedStaff.map((s) => s.id));
const scopedClockedIn = calendarRoles
  ? clockedInList.filter((a) => calendarRoles.has(a.profile.role))
  : clockedInList;
const scopedAttendance = calendarRoles
  ? attendanceList.filter((a) => scopedStaffIds.has(a.profile_id))
  : attendanceList;
const scopedLeaves = leaveRoles ? leavesList.filter((l) => leaveRoles.has(l.profile.role)) : leavesList;
const scopedSwaps = rosterRoles
  ? swapsList.filter(
      (s) => scopedStaffIds.has(s.requester_id) || (!!s.target_id && scopedStaffIds.has(s.target_id))
    )
  : swapsList;
const scopedShiftRequests = shiftRequestRoles
  ? shiftRequestsList.filter((r) => shiftRequestRoles.has(r.profile.role))
  : shiftRequestsList;
const scopedAttendanceCorrections = leaveRoles
  ? attendanceCorrectionsList.filter((r) => leaveRoles.has(r.profile.role))
  : attendanceCorrectionsList;
const scopedShiftsToday = rosterRoles
  ? shiftsTodayList.filter((s) => scopedStaffIds.has(s.assignee_id)).length
  : shiftsTodayList.length;
```

Note `scopedSwaps` keeps using `rosterRoles`-derived `scopedStaffIds` for display breadth (matches its pre-existing OR-based display logic — the narrower `approve_swap`-specific AND-of-both-sides check still happens in `canApproveSwapRequestFor` for the actual `canRespond` gate below, unchanged shape).

Update every remaining call in this file:
- `canApproveShiftRequestFor(manager.role, r.profile.role)` → add `, permissions`
- `canApproveSwapRequestFor(manager.role, r.requester.role, r.target.role)` → add `, permissions`
- `canApproveLeaveFor(manager.role, r.profile.role)` (both occurrences, including the `AttendanceCorrectionCard`'s `canRespond`) → add `, permissions`

`isTechnical`/`TechnicalDashboard` branch is unaffected by this task (no group filtering applies to technical's org-wide view) — but see Task 9, which adds a new section to `TechnicalDashboard` and therefore needs `permissions` passed into it too:

```tsx
<TechnicalDashboard
  staff={staffList}
  attendance={attendanceList}
  leaveRequests={leavesList}
  swapRequests={swapsList}
  shiftRequests={shiftRequestsList}
  attendanceCorrections={attendanceCorrectionsList}
  groupPermissions={permissions}
/>
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — error count should have dropped from Task 4's count (these 4 files' errors now gone; remaining errors are in Tasks 6–9's files).

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/calendar/page.tsx" "app/(app)/leave/page.tsx" "app/(app)/manager/page.tsx" "app/(app)/layout.tsx"
git commit -m "refactor: thread GroupPermissions through calendar/leave/manager pages and app layout"
```

---

### Task 6: Thread `permissions` through Server Actions

**Files:**
- Modify: `actions/shifts.ts`
- Modify: `actions/attendance.ts`

**Interfaces:**
- Consumes: `getGroupPermissions()` (Task 3), `canCreateShiftFor`/`canManageAttendanceFor` (Task 4).

- [ ] **Step 1: `actions/shifts.ts`**

In `assertAssigneeAllowed` (the function wrapping the `canCreateShiftFor` call at line 25), add a `getGroupPermissions()` fetch and pass it through:

```ts
import { getGroupPermissions } from "@/lib/permissions";
// inside assertAssigneeAllowed, before the canCreateShiftFor call:
const permissions = await getGroupPermissions();
if (!canCreateShiftFor(callerRole, assignee.role, permissions)) {
```

- [ ] **Step 2: `actions/attendance.ts`**

Same pattern around the `canManageAttendanceFor(viewerRole, target.role)` call at line 56:

```ts
import { getGroupPermissions } from "@/lib/permissions";
// before the canManageAttendanceFor call:
const permissions = await getGroupPermissions();
return canManageAttendanceFor(viewerRole, target.role, permissions);
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — drops further.

- [ ] **Step 4: Commit**

```bash
git add actions/shifts.ts actions/attendance.ts
git commit -m "refactor: thread GroupPermissions through shift-creation and attendance-management actions"
```

---

### Task 7: Thread `permissions` through `lib/push.ts`, `lib/notifications.ts`, `lib/calendar.ts`

**Files:**
- Modify: `lib/push.ts`
- Modify: `lib/notifications.ts`
- Modify: `lib/calendar.ts`

**Interfaces:**
- Consumes: `getGroupPermissions()` (Task 3), `canApproveLeaveFor`/`canApproveShiftRequestFor`/`canApproveSwapRequestFor` (Task 4).
- Produces: `buildNotifications` gains a required `permissions: GroupPermissions` field on its input object (consumed by Task 5 Step 1's `app/(app)/layout.tsx` call site, already wired there).

- [ ] **Step 1: `lib/push.ts`**

`sendPushToLeaveApprovers`/`sendPushToShiftRequestApprovers` currently loop over candidate profiles and call `canApproveLeaveFor(p.role, targetRole)`/`canApproveShiftRequestFor(p.role, targetRole)`. Fetch permissions once per call and pass through:

```ts
import { getGroupPermissions } from "@/lib/permissions";

export async function sendPushToLeaveApprovers(targetRole: Role, payload: PushPayload): Promise<void> {
  if (!configured) return;
  const permissions = await getGroupPermissions();
  const { data } = await supabaseAdmin.from("profiles").select("id, role").in("role", LEAVE_APPROVER_CANDIDATE_ROLES);
  const ids = (data ?? []).filter((p) => canApproveLeaveFor(p.role, targetRole, permissions)).map((p) => p.id);
  await sendPushToProfiles(ids, payload);
}

export async function sendPushToShiftRequestApprovers(targetRole: Role, payload: PushPayload): Promise<void> {
  if (!configured) return;
  const permissions = await getGroupPermissions();
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .in("role", SHIFT_REQUEST_APPROVER_CANDIDATE_ROLES);
  const ids = (data ?? []).filter((p) => canApproveShiftRequestFor(p.role, targetRole, permissions)).map((p) => p.id);
  await sendPushToProfiles(ids, payload);
}
```

- [ ] **Step 2: `lib/notifications.ts`**

Add `permissions: GroupPermissions` to `buildNotifications`'s destructured parameter type and pass it to the one call site that needs it (`canApproveShiftRequestFor(profile.role, r.profile.role)` inside the shift-requests loop):

```ts
import type { GroupPermissions } from "@/lib/permissions";

export function buildNotifications({
  profile,
  swaps,
  leaves,
  shiftRequests,
  attendanceCorrections,
  permissions,
}: {
  profile: Pick<Profile, "id" | "role">;
  swaps: SwapRequestDetailed[];
  leaves: LeaveRequestDetailed[];
  shiftRequests: ShiftRequestDetailed[];
  attendanceCorrections: AttendanceCorrectionDetailed[];
  permissions: GroupPermissions;
}): AppNotification[] {
```

Update the shift-request loop's `canApproveShiftRequestFor(profile.role, r.profile.role)` to `canApproveShiftRequestFor(profile.role, r.profile.role, permissions)`.

- [ ] **Step 3: `lib/calendar.ts`**

`toCalendarEvents`'s inline `approvableFor(swap)` helper calls `canApproveSwapRequestFor(currentUserRole, swap.requester.role, swap.target.role)` (line 565). Add a `permissions: GroupPermissions` parameter to `toCalendarEvents` itself (it's already called with `currentUserRole` as an explicit argument from `ShiftCalendar.tsx` per this session's earlier group-scoped-shift-management work — add `permissions` right after it in the same parameter list), and pass it through to the `canApproveSwapRequestFor` call:

```ts
import type { GroupPermissions } from "@/lib/permissions";

export function toCalendarEvents(
  shifts: ShiftWithAssignee[],
  currentUserId: string,
  currentUserRole: Role,
  permissions: GroupPermissions,
  pendingSwaps: SwapRequestDetailed[],
  colorFor: (id: string) => string
): ShiftEvent[] {
  // ...
  const approvableFor = (swap: SwapRequestDetailed) =>
    swap.target_id !== null &&
    swap.target !== null &&
    swap.requester_id !== currentUserId &&
    swap.target_id !== currentUserId &&
    canApproveSwapRequestFor(currentUserRole, swap.requester.role, swap.target.role, permissions);
  // ...
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — drops further (remaining errors confined to Tasks 8–9's client-component files).

- [ ] **Step 5: Commit**

```bash
git add lib/push.ts lib/notifications.ts lib/calendar.ts
git commit -m "refactor: thread GroupPermissions through push, notifications, and calendar event builder"
```

---

### Task 8: Thread `permissions` through client components

**Files:**
- Modify: `components/calendar/ShiftCalendarLoader.tsx`
- Modify: `components/calendar/ShiftCalendar.tsx`
- Modify: `components/calendar/AttendanceDetailDialog.tsx`

**Interfaces:**
- Consumes: `permissions` prop from `app/(app)/calendar/page.tsx` (Task 5), `GroupPermissions` type (Task 3), updated predicates (Task 4), updated `toCalendarEvents` (Task 7).

- [ ] **Step 1: `components/calendar/ShiftCalendarLoader.tsx`**

This file just spreads `props` straight into `ShiftCalendar` — add the field to its props type and import, no other change needed:

```ts
import type { GroupPermissions } from "@/lib/permissions";

export default function ShiftCalendarLoader(props: {
  shifts: ShiftWithAssignee[];
  pendingSwaps: SwapRequestDetailed[];
  attendance: AttendanceWithProfileRole[];
  leaveRequests: LeaveRequestWithRole[];
  shiftRequests: ShiftRequestDetailed[];
  attendanceCorrections: AttendanceCorrectionDetailed[];
  branches: Branch[];
  customCalendars: CustomCalendar[];
  customEvents: CustomEvent[];
  currentUserId: string;
  currentUserName: string;
  currentUserRole: Role;
  canManageShifts: boolean;
  branchMembers: Pick<Profile, "id" | "full_name" | "role" | "branch_ids">[];
  canFollowAll: boolean;
  followedIds: string[];
  followColors: Record<string, string>;
  branchColors: Record<string, string>;
  defaultView: CalendarView;
  permissions: GroupPermissions;
}) {
  return <ShiftCalendar {...props} />;
}
```

- [ ] **Step 2: `components/calendar/ShiftCalendar.tsx`**

Add `permissions: GroupPermissions` to `ShiftCalendarProps` (or equivalent prop type name — read the file's current props interface first). Update:
- Import: `import type { GroupPermissions } from "@/lib/permissions";`
- Line ~369: `canCreateShiftFor(currentUserRole, event.resource.shift.assignee.role)` → add `, permissions`
- Line ~409: `canApproveSwapRequestFor(currentUserRole, request.requester.role, request.target.role)` → add `, permissions`
- Line ~562: `canCreateShiftFor(currentUserRole, m.role)` → add `, permissions`; add `permissions` to this `useMemo`'s dependency array
- Line ~604: `canApproveSwapRequestFor(currentUserRole, r.requester.role, r.target.role)` → add `, permissions`; add `permissions` to its `useMemo` dependency array
- The `getCalendarFollowGroups(currentUserRole)` call (line ~526) → `getCalendarFollowGroups(currentUserRole, permissions)`
- The `toCalendarEvents(...)` call site → add `permissions` as the 4th argument (after `currentUserRole`, before `pendingSwaps`), matching Task 7 Step 3's new signature

- [ ] **Step 3: `components/calendar/AttendanceDetailDialog.tsx`**

Add `permissions: GroupPermissions` to its props type. Update line ~79: `canManageAttendanceFor(currentUserRole, profileRole)` → add `, permissions`. Check its parent render site (inside `ShiftCalendar.tsx` or wherever it's opened from) to pass the prop through from the same `permissions` already threaded in Step 2.

- [ ] **Step 4: Verify — full compile should now be clean**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: same 3 pre-existing warnings as every prior task this session (react-hooks/incompatible-library on `watch()` calls in unrelated files) — no new warnings or errors.

- [ ] **Step 5: Commit**

```bash
git add components/calendar/ShiftCalendarLoader.tsx components/calendar/ShiftCalendar.tsx components/calendar/AttendanceDetailDialog.tsx
git commit -m "refactor: thread GroupPermissions through calendar client components"
```

---

### Task 9: `technical`-only edit action + UI on the Technical dashboard

**Files:**
- Create: `lib/validations/group-permissions.ts`
- Create: `actions/group-permissions.ts`
- Create: `components/manager/GroupPermissionsEditor.tsx`
- Modify: `components/manager/TechnicalDashboard.tsx`

**Interfaces:**
- Consumes: `GROUP_MANAGER_ROLES`, `GROUP_TARGET_ROLES`, `GROUP_PERMISSION_TYPES`, `GROUP_PERMISSION_LABELS`, `hasGroupPermission`, `GroupPermissions` (Task 3); `ROLE_LABELS` (`lib/roles.ts`, unchanged).
- Produces: `updateGroupPermissionAction(input: unknown): Promise<ActionResult>` — the only write path to `group_permissions`.

- [ ] **Step 1: Validation schema**

```ts
// lib/validations/group-permissions.ts
import { z } from "zod";
import { GROUP_MANAGER_ROLES, GROUP_TARGET_ROLES, GROUP_PERMISSION_TYPES } from "@/lib/permissions";

export const groupPermissionUpdateSchema = z.object({
  manager_role: z.enum(GROUP_MANAGER_ROLES as [string, ...string[]], "Vai trò quản lý không hợp lệ"),
  target_role: z.enum(GROUP_TARGET_ROLES as [string, ...string[]], "Vai trò được quản lý không hợp lệ"),
  permission: z.enum(GROUP_PERMISSION_TYPES as [string, ...string[]], "Loại quyền không hợp lệ"),
  granted: z.boolean(),
});

export type GroupPermissionUpdateInput = z.infer<typeof groupPermissionUpdateSchema>;
```

- [ ] **Step 2: Server Action**

```ts
// actions/group-permissions.ts
"use server";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { groupPermissionUpdateSchema } from "@/lib/validations/group-permissions";
import type { ActionResult } from "@/types";

function mapGroupPermissionError(message: string): string {
  if (message.includes("row-level security policy") || message.includes("permission denied")) {
    return "Bạn không có quyền chỉnh sửa mục này";
  }
  return "Không thể cập nhật quyền, vui lòng thử lại";
}

export async function updateGroupPermissionAction(input: unknown): Promise<ActionResult> {
  const profile = await requireProfile();
  if (profile.role !== "technical") {
    return { ok: false, error: "Chỉ tài khoản kỹ thuật mới chỉnh sửa được mục này" };
  }

  const parsed = groupPermissionUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const { manager_role, target_role, permission, granted } = parsed.data;

  const { error } = granted
    ? await supabase.from("group_permissions").insert({ manager_role, target_role, permission })
    : await supabase
        .from("group_permissions")
        .delete()
        .match({ manager_role, target_role, permission });

  if (error) {
    return { ok: false, error: mapGroupPermissionError(error.message) };
  }

  revalidatePath("/calendar");
  revalidatePath("/manager");
  revalidatePath("/leave");
  revalidatePath("/attendance");
  return { ok: true };
}
```

- [ ] **Step 3: Checkbox grid component**

```tsx
// components/manager/GroupPermissionsEditor.tsx
"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { CheckIcon } from "lucide-react";
import {
  GROUP_MANAGER_ROLES,
  GROUP_TARGET_ROLES,
  GROUP_PERMISSION_TYPES,
  GROUP_PERMISSION_LABELS,
  hasGroupPermission,
  type GroupPermissions,
} from "@/lib/permissions";
import { ROLE_LABELS, MANAGER_GROUP_META } from "@/lib/roles";
import { updateGroupPermissionAction } from "@/actions/group-permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Role } from "@/types";

function PermissionCell({
  managerRole,
  targetRole,
  permission,
  checked,
}: {
  managerRole: Role;
  targetRole: Role;
  permission: (typeof GROUP_PERMISSION_TYPES)[number];
  checked: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const result = await updateGroupPermissionAction({
        manager_role: managerRole,
        target_role: targetRole,
        permission,
        granted: !checked,
      });
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      aria-pressed={checked}
      aria-label={`${checked ? "Bỏ" : "Cấp"} quyền ${GROUP_PERMISSION_LABELS[permission]} cho ${ROLE_LABELS[targetRole]}`}
      className="flex size-6 items-center justify-center rounded-[4px] disabled:opacity-50"
      style={{
        backgroundColor: checked ? "var(--primary)" : "transparent",
        boxShadow: "inset 0 0 0 1.5px var(--primary)",
      }}
    >
      {checked && <CheckIcon className="size-3.5 text-primary-foreground" strokeWidth={3} />}
    </button>
  );
}

export default function GroupPermissionsEditor({ permissions }: { permissions: GroupPermissions }) {
  return (
    <div className="space-y-6">
      {GROUP_MANAGER_ROLES.map((managerRole) => (
        <Card key={managerRole}>
          <CardHeader>
            <CardTitle className="text-base">{MANAGER_GROUP_META[managerRole]?.label ?? ROLE_LABELS[managerRole]}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left font-medium text-muted-foreground">Nhóm</th>
                  {GROUP_PERMISSION_TYPES.map((permission) => (
                    <th key={permission} className="p-2 text-center font-medium text-muted-foreground">
                      {GROUP_PERMISSION_LABELS[permission]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {GROUP_TARGET_ROLES.map((targetRole) => (
                  <tr key={targetRole} className="border-t">
                    <td className="p-2">{ROLE_LABELS[targetRole]}</td>
                    {GROUP_PERMISSION_TYPES.map((permission) => (
                      <td key={permission} className="p-2 text-center">
                        <PermissionCell
                          managerRole={managerRole}
                          targetRole={targetRole}
                          permission={permission}
                          checked={hasGroupPermission(permissions, managerRole, targetRole, permission)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Wire into `TechnicalDashboard.tsx`**

Add `groupPermissions` to the destructured props and its type (currently `{ staff, attendance, leaveRequests, swapRequests, shiftRequests, attendanceCorrections }` typed inline — add the new field to both the destructure and the inline type object), and render the editor as a new top-level block inside the existing `<div className="space-y-6">` wrapper, above or below the existing chart grid:

```tsx
import type { GroupPermissions } from "@/lib/permissions";
import GroupPermissionsEditor from "@/components/manager/GroupPermissionsEditor";

export default function TechnicalDashboard({
  staff,
  attendance,
  leaveRequests,
  swapRequests,
  shiftRequests,
  attendanceCorrections,
  groupPermissions,
}: {
  staff: Pick<Profile, "id" | "full_name" | "role">[];
  attendance: Attendance[];
  leaveRequests: LeaveRequestDetailed[];
  swapRequests: SwapRequestDetailed[];
  shiftRequests: ShiftRequestDetailed[];
  attendanceCorrections: AttendanceCorrectionDetailed[];
  groupPermissions: GroupPermissions;
}) {
  // ... existing roleCounts/hoursByDay/totalHours/peakDay unchanged ...

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 font-heading text-lg font-semibold">Phân quyền theo nhóm</h2>
        <GroupPermissionsEditor permissions={groupPermissions} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* existing chart cards unchanged */}
```

- [ ] **Step 5: Verify — full compile clean**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: same 3 pre-existing warnings only.

- [ ] **Step 6: Live UI check — start dev server, exercise the toggle as a real `technical` account**

```bash
npx supabase db push 2>&1 | tail -5  # confirm Tasks 1-2's migrations already applied
npm run dev &
sleep 3
```
Manually (or via a disposable-account script following this session's established pattern): sign in as a `technical`-role test account, open `/manager`, tick "GĐ đào tạo" × "Quản sinh" × "Duyệt nghỉ phép", confirm the row appears in `group_permissions` via a quick `select`, untick it, confirm the row is gone.

- [ ] **Step 7: Commit**

```bash
git add lib/validations/group-permissions.ts actions/group-permissions.ts components/manager/GroupPermissionsEditor.tsx components/manager/TechnicalDashboard.tsx
git commit -m "feat: technical-only UI to edit group_permissions from the dashboard"
```

---

### Task 10: End-to-end regression verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything from Tasks 1–9.

- [ ] **Step 1: Full static verification**

```bash
npx tsc --noEmit
npm run lint
npm run build
```
Expected: all three clean (build succeeds, same 3 pre-existing lint warnings, zero tsc errors).

- [ ] **Step 2: Live regression — reproduce the exact scenarios from this session's Feature 1/2/3 work, now against the data-driven path**

Using disposable `auth.admin.createUser()` accounts (create → test → `admin.auth.admin.deleteUser()` cleanup, matching every prior verification script this session):
- `coo` creates a shift for `operations_staff` → succeeds; for `teacher` → blocked with the Vietnamese error message.
- `training_director` approves a shift-request from `teacher` → succeeds; from `student_affairs` → blocked.
- Targeted swap: `operations_staff` A requests B (also `operations_staff`), `coo` approves on their behalf → shift ends up assigned to B, not `coo` (the `v_taker` regression this session already found once — must not reappear).
- `training_director` approves a `teacher`'s leave request → succeeds. Same `training_director` approves a `teacher`'s giải trình công (attendance correction) → succeeds (confirms the shared `approve_leave` permission type covers both, per Key Design Facts §1).
- **New scenario only possible after this feature ships:** as `technical`, grant `training_director` → `student_affairs` → `approve_leave` via the new UI (or directly via `updateGroupPermissionAction`). Re-run the leave-approval test with a `student_affairs` leave request against `training_director` — now succeeds (was blocked before the grant). Revoke it — blocked again.
- `ceo`/`technical` — every action above still fully unrestricted (the one thing that must never regress across this whole feature).

- [ ] **Step 3: Clean up all test data created during verification, in Supabase production**

- [ ] **Step 4: Report status** — no commit for this task (verification only, not a code change).

---

### Task 11: Deploy

**Files:** none

- [ ] **Step 1: Confirm migrations already applied** (Tasks 1–2 already ran `npx supabase db push`) — re-run once more to confirm idempotent no-op:

```bash
npx supabase db push
```

- [ ] **Step 2: Push commits and deploy**

```bash
git push origin main
npx vercel deploy --prod
```

- [ ] **Step 3: Report the production URL and readyState to the user.**
