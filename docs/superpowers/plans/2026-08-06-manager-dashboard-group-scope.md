# Manager Dashboard Group Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** COO, GĐ Đào Tạo, and HR each see the `/manager` dashboard scoped strictly to their own role-group (staff, swaps, leave, attendance, shift requests) instead of the whole organization; CEO and Kỹ thuật are unaffected.

**Architecture:** A new RLS migration closes the two SELECT-policy gaps (`profiles`, `shift_swap_requests`) that still bypassed group scoping via a blanket `is_manager()` check. `app/(app)/manager/page.tsx` is rewritten to compute one `groupRoles` set via the existing `getViewableGroupRoles()` and filter every fetched list through it before rendering, replacing the old COO-only "Nhóm vận hành" special-case block with a single scoped dashboard reused by all three roles.

**Tech Stack:** Next.js 16 App Router (Server Component), Supabase Postgres RLS (SQL migration), TypeScript strict mode.

## Global Constraints

- All UI copy stays in Vietnamese; code identifiers/comments in English (CLAUDE.md).
- No changes to write/update/delete RLS policies or `StaffTable`'s role dropdown — read-only dashboard scoping only (spec §3 Non-goals).
- No changes to `ceo`/`technical` visibility — both keep `getViewableGroupRoles() === null` (org-wide).
- No test suite exists in this repo — verification is `tsc --noEmit`, `npm run lint`, and manual dev-server checks (CLAUDE.md Constraints: Verification).
- Migration files are sequential-numbered SQL in `supabase/migrations/`, following the `NNNN_description.sql` naming pattern already in use (current highest: `0023_explicit_shift_branch.sql`).
- Database/Supabase field names stay `snake_case` in TS (mirrors Postgres columns).

---

## File Structure

- **Create** `supabase/migrations/0024_manager_dashboard_group_scope.sql` — fixes the two RLS policy gaps described in spec §2.1.
- **Modify** `lib/roles.ts` — add `MANAGER_GROUP_META` export (UI copy for the 3 scoped roles), alongside the existing `ROLE_LABELS`.
- **Modify** `app/(app)/manager/page.tsx` — compute `groupRoles`, filter every fetched list, replace the COO-only block, wire scoped props into the existing `ManagerDashboard`/`StaffTable`/`Section` components (no changes to those component files — spec §4.4).

---

### Task 1: RLS migration — close the `profiles` / `shift_swap_requests` scoping gap

**Files:**
- Create: `supabase/migrations/0024_manager_dashboard_group_scope.sql`

**Interfaces:**
- Consumes: existing `public.can_view_profile(uuid) returns boolean` (defined in `supabase/migrations/0019_hr_group_student_affairs_teaching_assistant.sql:6-19`) and `public.current_branch_id() returns uuid` (defined in `supabase/migrations/0001_init.sql:156-159`). Not modified by this task.
- Produces: replaces the `profiles_select_branch` policy (last defined in `0019_hr_group_student_affairs_teaching_assistant.sql:28-36`) and the `swaps_select_branch` policy (last defined in `0006_global_manager_scope.sql:42-45`). No new functions.

- [ ] **Step 1: Write the migration file**

```sql
-- 0024_manager_dashboard_group_scope.sql
-- Closes two SELECT-policy gaps left over from 0013's group-scoping pass:
-- profiles and shift_swap_requests still bypassed can_view_profile() via a
-- blanket `or is_manager()`, so coo/training_director could SELECT every
-- row in these two tables regardless of their group (hr/ceo/technical
-- were unaffected — hr was never is_manager(), and can_view_profile()
-- already returns true unconditionally for ceo/technical).
-- Mirrors the shifts_select_branch / attendance_select_branch /
-- leave_select_own_or_manager fix already applied in
-- 0013_group_scoped_visibility.sql — keep all of these in sync going
-- forward if can_view_profile() ever changes shape.

drop policy if exists profiles_select_branch on public.profiles;
create policy profiles_select_branch on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or branch_id = public.current_branch_id()
    or public.can_view_profile(id)
  );

drop policy if exists swaps_select_branch on public.shift_swap_requests;
create policy swaps_select_branch on public.shift_swap_requests
  for select to authenticated
  using (
    branch_id = public.current_branch_id()
    or public.can_view_profile(requester_id)
    or public.can_view_profile(target_id)
  );
```

- [ ] **Step 2: Apply the migration locally**

Run: `supabase db push` (or `supabase migration up` / `supabase db reset` depending on the local workflow already in use in this repo — check `supabase/.temp/` for the linked project and use whichever command the repo's existing migrations were applied with; do not guess a new workflow).

Expected: migration applies with no errors, no existing policy left with the old name (`drop policy if exists` handles re-runs safely).

- [ ] **Step 3: Verify the policy change with a manual RLS check**

Using the Supabase SQL editor (or `psql` against the linked project) impersonating a `coo` user's JWT (`set request.jwt.claims` / `set role authenticated; set local "request.jwt.claim.sub" = '<coo-user-id>';` — match whatever impersonation pattern the project's Supabase CLI docs/local setup already supports), run:

```sql
select role, count(*) from public.profiles group by role;
```

Expected: only rows for `coo`'s own id, any same-branch profiles (likely none, since `coo` has `branch_id = null`), and `OPERATIONS_GROUP_ROLES` (`hr`, `customer_care`, `operations_staff`) — no `teacher`, `student_affairs`, `teaching_assistant`, `collaborator`, or other manager-tier rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0024_manager_dashboard_group_scope.sql
git commit -m "fix: close profiles/swap RLS gap left over from group-scoped visibility pass"
```

---

### Task 2: `lib/roles.ts` — add `MANAGER_GROUP_META`

**Files:**
- Modify: `lib/roles.ts` (insert after the `ROLE_LABELS` block, i.e. after line 32)

**Interfaces:**
- Consumes: `Role` type (`import type { Role } from "@/types"`, already imported at `lib/roles.ts:1`).
- Produces: `export const MANAGER_GROUP_META: Partial<Record<Role, { label: string; description: string }>>` — keyed by the **viewer's** role (`coo`, `training_director`, `hr`), each value giving the display label and one-line description of that viewer's group. Consumed by Task 3.

- [ ] **Step 1: Add the export**

Insert immediately after the closing `};` of `ROLE_LABELS` (`lib/roles.ts:32`):

```ts
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/roles.ts
git commit -m "feat: add MANAGER_GROUP_META display copy for scoped manager dashboard"
```

---

### Task 3: `app/(app)/manager/page.tsx` — generalize group scoping, remove COO-only block

**Files:**
- Modify: `app/(app)/manager/page.tsx` (full rewrite of the fetch/derive/render logic, lines 1-250)

**Interfaces:**
- Consumes:
  - `getViewableGroupRoles(role: Role): ReadonlySet<Role> | null` (`lib/roles.ts:103-108`, unchanged).
  - `MANAGER_GROUP_META` (from Task 2).
  - `isManagerRole`, `isCeo`, `isLeaveApprover`, `canApproveLeaveFor`, `canApproveShiftRequestFor` — all unchanged, already imported.
  - `ManagerDashboard` props (unchanged component, `components/manager/ManagerDashboard.tsx`): `totalStaff`, `unassignedStaff`, `shiftsToday`, `pendingSwaps`, `pendingLeave`, `clockedInCount`, `staff`, `attendance`, `leaveRequests`, `overviewTitle?`.
  - `StaffTable` props (unchanged component): `staff`, `branches`, `currentUserId`.
- Produces: no new exports (this is a page component, default export only). This is the last task — nothing downstream depends on new interfaces from this file.

- [ ] **Step 1: Replace the imports block**

Current (`app/(app)/manager/page.tsx:1-26`):

```ts
import { startOfDay, endOfDay, startOfYear } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth";
import { getBranches } from "@/lib/branches";
import {
  isOperationsGroupRole,
  isCeo,
  isLeaveApprover,
  canApproveLeaveFor,
  canApproveShiftRequestFor,
  isManagerRole,
} from "@/lib/roles";
import { Card, CardContent } from "@/components/ui/card";
import ManagerDashboard from "@/components/manager/ManagerDashboard";
import TechnicalDashboard from "@/components/manager/TechnicalDashboard";
import StaffTable from "@/components/manager/StaffTable";
import SwapRequestCard from "@/components/swaps/SwapRequestCard";
import LeaveRequestCard from "@/components/leave/LeaveRequestCard";
import ShiftRequestCard from "@/components/shifts/ShiftRequestCard";
import type {
  Attendance,
  AttendanceWithProfile,
  LeaveRequestDetailed,
  Profile,
  ShiftRequestDetailed,
  SwapRequestDetailed,
} from "@/types";
```

Replace with (drops `isOperationsGroupRole`, no longer used; adds `getViewableGroupRoles` and `MANAGER_GROUP_META`):

```ts
import { startOfDay, endOfDay, startOfYear } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth";
import { getBranches } from "@/lib/branches";
import {
  getViewableGroupRoles,
  MANAGER_GROUP_META,
  isCeo,
  isLeaveApprover,
  canApproveLeaveFor,
  canApproveShiftRequestFor,
  isManagerRole,
} from "@/lib/roles";
import { Card, CardContent } from "@/components/ui/card";
import ManagerDashboard from "@/components/manager/ManagerDashboard";
import TechnicalDashboard from "@/components/manager/TechnicalDashboard";
import StaffTable from "@/components/manager/StaffTable";
import SwapRequestCard from "@/components/swaps/SwapRequestCard";
import LeaveRequestCard from "@/components/leave/LeaveRequestCard";
import ShiftRequestCard from "@/components/shifts/ShiftRequestCard";
import type {
  Attendance,
  AttendanceWithProfile,
  LeaveRequestDetailed,
  Profile,
  ShiftRequestDetailed,
  SwapRequestDetailed,
} from "@/types";
```

- [ ] **Step 2: Replace the `shiftsToday` fetch (head-count → row list)**

Current (`app/(app)/manager/page.tsx:79-118`, the `Promise.all` array):

```ts
  const [
    { data: staff },
    { data: swaps },
    branches,
    { count: shiftsToday },
    { data: clockedIn },
    { data: leaves },
    { data: yearAttendance },
    { data: shiftRequests },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone, role, branch_id")
      .order("full_name"),
    supabase.from("shift_swap_requests").select(SELECT).order("created_at", { ascending: false }),
    getBranches(),
    supabase
      .from("shifts")
      .select("*", { count: "exact", head: true })
      .gte("start_at", todayStart)
      .lte("start_at", todayEnd),
    supabase
      .from("attendance")
      .select("*, profile:profiles!profile_id(id, full_name, role)")
      .is("check_out_at", null)
      .order("check_in_at", { ascending: false }),
    supabase
      .from("leave_requests")
      .select("*, profile:profiles!profile_id(id, full_name, role)")
      .order("created_at", { ascending: false }),
    supabase
      .from("attendance")
      .select("*")
      .gte("check_in_at", yearWindowStart)
      .order("check_in_at", { ascending: false }),
    supabase
      .from("shift_requests")
      .select("*, profile:profiles!profile_id(id, full_name, role)")
      .order("created_at", { ascending: false }),
  ]);
```

Replace the `shifts` fetch entry so it returns `assignee_id` instead of a bare count (needed to filter by group membership in Step 4 — a head-count query can't be filtered by role after the fact):

```ts
  const [
    { data: staff },
    { data: swaps },
    branches,
    { data: shiftsTodayRows },
    { data: clockedIn },
    { data: leaves },
    { data: yearAttendance },
    { data: shiftRequests },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone, role, branch_id")
      .order("full_name"),
    supabase.from("shift_swap_requests").select(SELECT).order("created_at", { ascending: false }),
    getBranches(),
    supabase
      .from("shifts")
      .select("assignee_id")
      .gte("start_at", todayStart)
      .lte("start_at", todayEnd),
    supabase
      .from("attendance")
      .select("*, profile:profiles!profile_id(id, full_name, role)")
      .is("check_out_at", null)
      .order("check_in_at", { ascending: false }),
    supabase
      .from("leave_requests")
      .select("*, profile:profiles!profile_id(id, full_name, role)")
      .order("created_at", { ascending: false }),
    supabase
      .from("attendance")
      .select("*")
      .gte("check_in_at", yearWindowStart)
      .order("check_in_at", { ascending: false }),
    supabase
      .from("shift_requests")
      .select("*, profile:profiles!profile_id(id, full_name, role)")
      .order("created_at", { ascending: false }),
  ]);
```

- [ ] **Step 3: Replace the list-normalization + derived-var block**

Current (`app/(app)/manager/page.tsx:120-134`):

```ts
  const staffList = (staff as Pick<Profile, "id" | "full_name" | "phone" | "role" | "branch_id">[]) ?? [];
  const swapsList = (swaps as SwapRequestDetailed[]) ?? [];
  const leavesList = (leaves as (LeaveRequestDetailed & { profile: ProfileRoleRef })[]) ?? [];
  const clockedInList = (clockedIn as (AttendanceWithProfile & { profile: ProfileRoleRef })[]) ?? [];
  const attendanceList = (yearAttendance as Attendance[]) ?? [];
  const shiftRequestsList = (shiftRequests as ShiftRequestDetailed[]) ?? [];

  const isCoo = manager.role === "coo";
  const isTechnical = manager.role === "technical";
  const managerIsCeo = isCeo(manager.role);
  const opsStaff = staffList.filter((s) => isOperationsGroupRole(s.role));
  const opsStaffIds = new Set(opsStaff.map((s) => s.id));
  const opsClockedIn = clockedInList.filter((a) => isOperationsGroupRole(a.profile.role));
  const opsAttendance = attendanceList.filter((a) => opsStaffIds.has(a.profile_id));
  const opsLeaves = leavesList.filter((l) => isOperationsGroupRole(l.profile.role));
```

Replace with (all raw lists unchanged in shape; adds `shiftsTodayList`; replaces the COO-only `ops*` variables with role-generic `scoped*` variables built from `groupRoles`):

```ts
  const staffList = (staff as Pick<Profile, "id" | "full_name" | "phone" | "role" | "branch_id">[]) ?? [];
  const swapsList = (swaps as SwapRequestDetailed[]) ?? [];
  const leavesList = (leaves as (LeaveRequestDetailed & { profile: ProfileRoleRef })[]) ?? [];
  const clockedInList = (clockedIn as (AttendanceWithProfile & { profile: ProfileRoleRef })[]) ?? [];
  const attendanceList = (yearAttendance as Attendance[]) ?? [];
  const shiftRequestsList = (shiftRequests as ShiftRequestDetailed[]) ?? [];
  const shiftsTodayList = (shiftsTodayRows as Pick<{ assignee_id: string }, "assignee_id">[]) ?? [];

  const isTechnical = manager.role === "technical";
  const managerIsCeo = isCeo(manager.role);

  // null => org-wide (ceo, technical); otherwise the exact set of roles
  // this viewer's dashboard is scoped to. This is the single source of
  // truth for "my group" on this page — see
  // docs/superpowers/specs/2026-08-06-manager-dashboard-group-scope-design.md §4.2
  // for why the page re-filters on top of RLS instead of trusting RLS alone.
  const groupRoles = getViewableGroupRoles(manager.role);
  const groupMeta = groupRoles ? MANAGER_GROUP_META[manager.role] : undefined;

  const scopedStaff = groupRoles ? staffList.filter((s) => groupRoles.has(s.role)) : staffList;
  const scopedStaffIds = new Set(scopedStaff.map((s) => s.id));
  const scopedClockedIn = groupRoles
    ? clockedInList.filter((a) => groupRoles.has(a.profile.role))
    : clockedInList;
  const scopedAttendance = groupRoles
    ? attendanceList.filter((a) => scopedStaffIds.has(a.profile_id))
    : attendanceList;
  const scopedLeaves = groupRoles ? leavesList.filter((l) => groupRoles.has(l.profile.role)) : leavesList;
  const scopedSwaps = groupRoles
    ? swapsList.filter((s) => scopedStaffIds.has(s.requester_id) || scopedStaffIds.has(s.target_id))
    : swapsList;
  const scopedShiftRequests = groupRoles
    ? shiftRequestsList.filter((r) => groupRoles.has(r.profile.role))
    : shiftRequestsList;
  const scopedShiftsToday = groupRoles
    ? shiftsTodayList.filter((s) => scopedStaffIds.has(s.assignee_id)).length
    : shiftsTodayList.length;
```

- [ ] **Step 4: Replace the header paragraph + dashboard render block**

Current (`app/(app)/manager/page.tsx:136-155`):

```tsx
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Quản lý</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Theo dõi nhân sự và yêu cầu đổi ca trong cơ sở của bạn.
        </p>
      </div>

      {isTechnical ? (
        <TechnicalDashboard staff={staffList} attendance={attendanceList} leaveRequests={leavesList} />
      ) : (
        <ManagerDashboard
          totalStaff={staffList.length}
          unassignedStaff={staffList.filter((s) => !s.branch_id && !isManagerRole(s.role)).length}
          shiftsToday={shiftsToday ?? 0}
          pendingSwaps={swapsList.filter((s) => s.status === "pending").length}
          pendingLeave={leavesList.filter((l) => l.status === "pending").length}
          clockedInCount={clockedInList.length}
          staff={staffList}
          attendance={attendanceList}
          leaveRequests={leavesList}
        />
      )}
```

Replace with (three branches: technical org-wide, ceo org-wide, group-scoped for coo/training_director/hr):

```tsx
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Quản lý</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {groupMeta
            ? `Theo dõi nhân sự và yêu cầu đổi ca trong ${groupMeta.label.toLowerCase()} bạn quản lý.`
            : "Theo dõi nhân sự và yêu cầu đổi ca trong cơ sở của bạn."}
        </p>
      </div>

      {isTechnical ? (
        <TechnicalDashboard staff={staffList} attendance={attendanceList} leaveRequests={leavesList} />
      ) : groupRoles ? (
        <ManagerDashboard
          totalStaff={scopedStaff.length}
          unassignedStaff={scopedStaff.filter((s) => !s.branch_id).length}
          shiftsToday={scopedShiftsToday}
          pendingSwaps={scopedSwaps.filter((s) => s.status === "pending").length}
          pendingLeave={scopedLeaves.filter((l) => l.status === "pending").length}
          clockedInCount={scopedClockedIn.length}
          staff={scopedStaff}
          attendance={scopedAttendance}
          leaveRequests={scopedLeaves}
          overviewTitle={groupMeta ? `Tổng hợp chấm công — ${groupMeta.label}` : undefined}
        />
      ) : (
        <ManagerDashboard
          totalStaff={staffList.length}
          unassignedStaff={staffList.filter((s) => !s.branch_id && !isManagerRole(s.role)).length}
          shiftsToday={scopedShiftsToday}
          pendingSwaps={swapsList.filter((s) => s.status === "pending").length}
          pendingLeave={leavesList.filter((l) => l.status === "pending").length}
          clockedInCount={clockedInList.length}
          staff={staffList}
          attendance={attendanceList}
          leaveRequests={leavesList}
        />
      )}
```

Note: `scopedShiftsToday` is used in the `else` (ceo) branch too — when `groupRoles` is `null`, `scopedShiftsToday` already equals `shiftsTodayList.length` (the full unfiltered count) per Step 3's ternary, so this is correct for `ceo` without any special-casing.

- [ ] **Step 5: Delete the COO-only "Nhóm vận hành" block**

Delete this entire block (`app/(app)/manager/page.tsx:157-185` in the original file):

```tsx
      {isCoo && (
        <Section title="Nhóm vận hành">
          <p className="mb-4 text-sm text-muted-foreground">
            HR, CSKH và Nhân viên vận hành — {opsStaff.length} người.
          </p>
          <div className="space-y-4">
            <ManagerDashboard
              totalStaff={opsStaff.length}
              unassignedStaff={opsStaff.filter((s) => !s.branch_id).length}
              shiftsToday={shiftsToday ?? 0}
              pendingSwaps={swapsList.filter(
                (s) => s.status === "pending" && opsStaff.some((m) => m.id === s.requester_id)
              ).length}
              pendingLeave={opsLeaves.filter((l) => l.status === "pending").length}
              clockedInCount={opsClockedIn.length}
              staff={opsStaff}
              attendance={opsAttendance}
              leaveRequests={opsLeaves}
              overviewTitle="Tổng hợp chấm công — Nhóm vận hành"
            />
            <Card>
              <CardContent>
                <StaffTable staff={opsStaff} branches={branches} currentUserId={manager.id} />
              </CardContent>
            </Card>
          </div>
        </Section>
      )}

```

No replacement needed — the scoped `ManagerDashboard` from Step 4 and the scoped `Section id="staff"` from Step 6 now cover this for all three group-scoped roles, not just COO.

- [ ] **Step 6: Scope the "Nhân viên" (staff) section**

Current (`app/(app)/manager/page.tsx:187-193` in the original file):

```tsx
      <Section id="staff" title="Nhân viên" count={staffList.length}>
        <Card>
          <CardContent>
            <StaffTable staff={staffList} branches={branches} currentUserId={manager.id} />
          </CardContent>
        </Card>
      </Section>
```

Replace with:

```tsx
      <Section
        id="staff"
        title={groupMeta ? `Nhân viên — ${groupMeta.label}` : "Nhân viên"}
        count={scopedStaff.length}
      >
        {groupMeta && (
          <p className="mb-4 text-sm text-muted-foreground">{groupMeta.description}</p>
        )}
        <Card>
          <CardContent>
            <StaffTable staff={scopedStaff} branches={branches} currentUserId={manager.id} />
          </CardContent>
        </Card>
      </Section>
```

- [ ] **Step 7: Scope the "Đăng ký ca" (shift requests) section**

Current (`app/(app)/manager/page.tsx:195-213` in the original file):

```tsx
      {(managerIsCeo || manager.role === "hr") && (
        <Section title="Đăng ký ca" count={shiftRequestsList.length}>
          {shiftRequestsList.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có đăng ký ca làm nào.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {shiftRequestsList.map((r) => (
                <ShiftRequestCard
                  key={r.id}
                  request={r}
                  canRespond={r.status === "pending" && canApproveShiftRequestFor(manager.role, r.profile.role)}
                  canCancel={r.status === "pending"}
                  showName
                />
              ))}
            </div>
          )}
        </Section>
      )}
```

Replace with (only the source list changes, from `shiftRequestsList` to `scopedShiftRequests` — for `ceo`, `groupRoles` is `null` so `scopedShiftRequests === shiftRequestsList`, unchanged behavior; for `hr`, it's now filtered to `HR_GROUP_ROLES`, matching what `canApproveShiftRequestFor` already permits them to act on):

```tsx
      {(managerIsCeo || manager.role === "hr") && (
        <Section title="Đăng ký ca" count={scopedShiftRequests.length}>
          {scopedShiftRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có đăng ký ca làm nào.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {scopedShiftRequests.map((r) => (
                <ShiftRequestCard
                  key={r.id}
                  request={r}
                  canRespond={r.status === "pending" && canApproveShiftRequestFor(manager.role, r.profile.role)}
                  canCancel={r.status === "pending"}
                  showName
                />
              ))}
            </div>
          )}
        </Section>
      )}
```

- [ ] **Step 8: Scope the "Yêu cầu đổi ca" (swaps) section**

Current (`app/(app)/manager/page.tsx:215-225` in the original file):

```tsx
      <Section id="swaps" title="Yêu cầu đổi ca" count={swapsList.length}>
        {swapsList.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có yêu cầu đổi ca nào.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {swapsList.map((r) => (
              <SwapRequestCard key={r.id} request={r} canRespond={false} canCancel={r.status === "pending"} />
            ))}
          </div>
        )}
      </Section>
```

Replace with (`swapsList` → `scopedSwaps`):

```tsx
      <Section id="swaps" title="Yêu cầu đổi ca" count={scopedSwaps.length}>
        {scopedSwaps.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có yêu cầu đổi ca nào.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {scopedSwaps.map((r) => (
              <SwapRequestCard key={r.id} request={r} canRespond={false} canCancel={r.status === "pending"} />
            ))}
          </div>
        )}
      </Section>
```

- [ ] **Step 9: Scope the "Nghỉ phép" (leave) section**

Current (`app/(app)/manager/page.tsx:227-247` in the original file):

```tsx
      <Section id="leave" title="Nghỉ phép" count={leavesList.length}>
        {leavesList.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có đơn nghỉ phép nào.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {leavesList.map((r) => (
              <LeaveRequestCard
                key={r.id}
                request={r}
                canRespond={
                  r.status === "pending" &&
                  isLeaveApprover(manager.role) &&
                  canApproveLeaveFor(manager.role, r.profile.role)
                }
                canCancel={r.status === "pending"}
                showName
              />
            ))}
          </div>
        )}
      </Section>
```

Replace with (`leavesList` → `scopedLeaves`):

```tsx
      <Section id="leave" title="Nghỉ phép" count={scopedLeaves.length}>
        {scopedLeaves.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có đơn nghỉ phép nào.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {scopedLeaves.map((r) => (
              <LeaveRequestCard
                key={r.id}
                request={r}
                canRespond={
                  r.status === "pending" &&
                  isLeaveApprover(manager.role) &&
                  canApproveLeaveFor(manager.role, r.profile.role)
                }
                canCancel={r.status === "pending"}
                showName
              />
            ))}
          </div>
        )}
      </Section>
```

- [ ] **Step 10: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors. In particular, confirm no leftover reference to the deleted `isCoo`, `opsStaff`, `opsStaffIds`, `opsClockedIn`, `opsAttendance`, `opsLeaves`, `isOperationsGroupRole`, or the old `shiftsToday` count variable — all should be gone from the file.

Run: `npx eslint app/\(app\)/manager/page.tsx`
Expected: no errors (in particular no `no-unused-vars` for anything left behind by the rewrite).

- [ ] **Step 11: Manual dev-server verification**

Run: `npm run dev`, then sign in as one seed/test user per role and open `/manager`:

- `ceo` — sees the full org-wide dashboard, full staff table, full swap/leave sections, "Đăng ký ca" section with every pending request. No visible regression from before.
- `technical` — sees `TechnicalDashboard`, unchanged from before.
- `coo` — sees exactly one dashboard titled with `overviewTitle="Tổng hợp chấm công — Nhóm vận hành"`, staff section titled "Nhân viên — Nhóm vận hành" with only `hr`/`customer_care`/`operations_staff` rows, swap/leave sections showing only rows involving those roles, no "Đăng ký ca" section (gate unchanged), no duplicate/second dashboard block anywhere on the page.
- `training_director` — same shape as `coo`, labeled "Nhóm đào tạo", staff limited to `teacher`/`collaborator`.
- `hr` — same shape, labeled "Nhóm quản sinh", staff limited to `student_affairs`/`teaching_assistant`, plus the "Đăng ký ca" section now showing only requests from that group (previously showed the whole org's requests).

Expected: matches every bullet above, page layout visually consistent with the rest of the app (same `Card`/grid/`font-heading` styling as before — no new components were introduced).

- [ ] **Step 12: Commit**

```bash
git add "app/(app)/manager/page.tsx"
git commit -m "feat: scope manager dashboard to viewer's role-group for coo, training_director, hr"
```

---

## Self-Review Notes

- **Spec coverage:** §4.1 (RLS) → Task 1. §4.2 (app-level filtering, including the `shiftsToday` head-count replacement) → Task 3 Steps 2-3. §4.3 (single dashboard, remove COO-only block) → Task 3 Steps 4-5. §4.4 (visual/copy consistency via `MANAGER_GROUP_META` and `overviewTitle`) → Task 2 + Task 3 Steps 4/6. §5 (verification) → Task 1 Step 3, Task 3 Steps 10-11. §6 (audit report) is a written deliverable outside this plan's code changes, already delivered in conversation.
- **Placeholder scan:** no TBD/TODO; every step has literal code or a literal shell command.
- **Type consistency:** `groupRoles` (`ReadonlySet<Role> | null`) and `groupMeta` (`{label, description} | undefined`) are defined once in Task 3 Step 3 and reused with the same names through Steps 4-9; `scopedStaff`/`scopedStaffIds`/`scopedClockedIn`/`scopedAttendance`/`scopedLeaves`/`scopedSwaps`/`scopedShiftRequests`/`scopedShiftsToday` are each defined exactly once and consumed downstream with matching names — no renames across steps.
