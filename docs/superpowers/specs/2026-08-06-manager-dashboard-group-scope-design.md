# Manager dashboard group scoping — design

Date: 2026-08-06
Status: approved for planning

## 1. Context

`/manager` (`app/(app)/manager/page.tsx`) is currently gated by
`canAccessManagerPage()` — `ceo`, `coo`, `training_director`, `technical`
(manager-tier) plus `hr` (a non-manager-tier role granted a narrow slice of
the page). Today, every role that can open the page sees the **entire
organization's** data: full staff list, full swap/leave/attendance data,
except for one bespoke exception — `coo` also gets an extra "Nhóm vận hành"
block below the org-wide dashboard, scoped client-side to
`OPERATIONS_GROUP_ROLES`.

`lib/roles.ts` already models three role-based "groups" a manager-tier role
can be scoped to, used today only for calendar-follow visibility and
leave/shift-request approval permission — **not** for the manager dashboard's
own data listing:

- `OPERATIONS_GROUP_ROLES` = `{hr, customer_care, operations_staff}` — COO's group
- `TRAINING_GROUP_ROLES` = `{teacher, collaborator}` — GĐ Đào Tạo's group
- `HR_GROUP_ROLES` = `{student_affairs, teaching_assistant}` — HR's group

`getViewableGroupRoles(role)` returns the matching set for `coo` /
`training_director` / `hr`, and `null` for `ceo` / `technical` (meaning "no
filtering — sees everything").

The request: **`coo`, `training_director`, and `hr` should each see the
manager dashboard scoped to only their own group** — not the whole
organization, and not an org-wide dashboard plus a bolted-on scoped block.
`ceo` and `technical` are unaffected (they keep full org-wide visibility, as
today).

## 2. Two gaps found during audit

1. **RLS is inconsistent with the group model.** Migration `0013` and
   `0019` correctly replaced the blanket `is_manager()` bypass with
   `can_view_profile()` (which already implements the exact 3-group model
   above) for `shifts`, `attendance`, and `leave_requests` SELECT policies.
   Two tables were missed:
   - `profiles_select_branch` still has `... or is_manager()`, so `coo` and
     `training_director` (both in `MANAGER_ROLES`, so `is_manager()` is
     true for them) can SELECT every row in `profiles` at the RLS layer,
     unscoped.
   - `swaps_select_branch` (on `shift_swap_requests`) has the same
     `is_manager()` bypass, unchanged since migration `0006`.

   This is the root cause of the org-wide COO staff list before any
   app-level scoping is applied.

2. **`lib/roles.ts:174-176`** comments that HR gets a "Nhóm HR" section
   "same shape as COO's Nhóm vận hành section" — this was never
   implemented. HR currently gets zero dashboard-level scoping despite the
   comment.

Both are called out in the audit report (Part 1 of this request) but are
fixed here as part of the dashboard-scoping feature, since fixing the app
layer without fixing RLS would leave the stated security model
(CLAUDE.md: "Postgres RLS ... is the actual enforcement layer") violated.

## 3. Non-goals

- No change to write/update/delete RLS policies (staff-role editing,
  shift creation, etc.) — the user confirmed `StaffTable`'s role dropdown
  and `is_manager()`-gated write policies stay as-is.
- No change to `ceo` or `technical` visibility — both keep full org-wide
  scope (`getViewableGroupRoles` already returns `null` for them).
- No change to `shift_requests` RLS (`can_approve_shift_request()`) — already
  correctly scoped to `ceo`/`hr` only, unaffected by this change.
- No new "group" concept — reuses `getViewableGroupRoles()` exactly as it
  exists today. If that function's mapping ever changes, this feature
  inherits the change automatically.

## 4. Design

### 4.1 RLS migration (new file, e.g. `0024_manager_dashboard_group_scope.sql`)

Mirrors the pattern already established in `0013_group_scoped_visibility.sql`:

```sql
-- profiles: drop the is_manager() bypass, rely on can_view_profile()
-- (which already returns true for ceo/technical unconditionally, and
-- group-scoped for coo/training_director/hr) plus the existing own-row
-- and own-branch clauses.
drop policy if exists profiles_select_branch on public.profiles;
create policy profiles_select_branch on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or branch_id = public.current_branch_id()
    or public.can_view_profile(id)
  );

-- shift_swap_requests: same substitution, scoped to either participant.
drop policy if exists swaps_select_branch on public.shift_swap_requests;
create policy swaps_select_branch on public.shift_swap_requests
  for select to authenticated
  using (
    branch_id = public.current_branch_id()
    or public.can_view_profile(requester_id)
    or public.can_view_profile(target_id)
  );
```

No changes to `can_view_profile()` itself, no changes to any write policy,
no changes to `shifts`/`attendance`/`leave_requests`/`shift_requests`
policies (already correct since 0013/0019).

### 4.2 App-level scoping (`app/(app)/manager/page.tsx`)

RLS is the outer security boundary; the page still applies its own filter
as the precise definition of "my group" for *this page's display*, because
RLS's `branch_id = current_branch_id()` clause can let a branch-assigned
role (HR has a `branch_id`, unlike the other three) see branch-mates who
aren't in their role group. The app-level filter is a strict subset of
what RLS allows, so this is defense-in-depth, not a workaround for a
missing RLS fix.

```ts
const groupRoles = getViewableGroupRoles(manager.role); // null = org-wide (ceo, technical)
```

When `groupRoles` is non-null, filter every list fetched in the page's
`Promise.all` down to members of that set before computing derived stats:

- `staffList` → filter `role ∈ groupRoles`
- `clockedInList` / `attendanceList` → filter by the same staff id set
- `leavesList` → filter `profile.role ∈ groupRoles`
- `swapsList` → filter `requester_id ∈ staffIds or target_id ∈ staffIds`
- `shiftRequestsList` → filter `profile.role ∈ groupRoles` (only reaches
  HR/CEO today via the existing section gate — unchanged)
- `shiftsToday` — replace the current head-count-only query (`select("*", {count:"exact", head:true})`,
  no row data) with a query that also returns `assignee_id`, then count
  client-side against the scoped staff id set. Needed because a raw
  head-count can't be filtered by role after the fact, and RLS's
  branch-clause fallback means the unfiltered count isn't reliably
  group-scoped for HR.

### 4.3 Single dashboard, not two

Remove the COO-only `isCoo && <Section title="Nhóm vận hành">...` block
entirely. Instead:

- `isTechnical` → `TechnicalDashboard` (unchanged, org-wide by design).
- `groupRoles !== null` (coo / training_director / hr) → **one**
  `ManagerDashboard` fed entirely by the scoped lists from 4.2.
- otherwise (`ceo`) → `ManagerDashboard` fed by the unfiltered lists, as
  today.

`Section id="staff"` ("Nhân viên"), the swap section, and the leave section
all switch their source list to the scoped versions when `groupRoles` is
set — no separate "org-wide" and "group" copies anywhere on the page for
these three roles.

### 4.4 Visual/copy consistency

Add a small metadata map next to `ROLE_LABELS` in `lib/roles.ts` (UI copy,
same pattern as the existing labels map):

```ts
export const MANAGER_GROUP_META: Partial<Record<Role, { label: string; description: string }>> = {
  coo: { label: "Nhóm vận hành", description: "HR, CSKH và Nhân viên vận hành" },
  training_director: { label: "Nhóm đào tạo", description: "Giáo viên và CTV" },
  hr: { label: "Nhóm quản sinh", description: "Quản sinh và Trợ giảng" },
};
```

Used to:
- Pass `overviewTitle={`Tổng hợp chấm công — ${meta.label}`}` into
  `ManagerDashboard` (prop already exists, no component change needed) for
  scoped roles; `undefined` (default title) for `ceo`.
- Subtitle text under the "Nhân viên" section heading for scoped roles.
- Page intro paragraph: swap "trong cơ sở của bạn" (branch-flavored copy,
  wrong for roles with no `branch_id`) for "trong nhóm bạn quản lý" when
  `groupRoles` is set.

No changes to `ManagerDashboard.tsx`, `TechnicalDashboard.tsx`, or
`StaffTable.tsx` themselves — only the props/data `page.tsx` feeds them
change, so existing styling (cards, grid, `font-heading`, oklch tokens)
carries over automatically with no visual-consistency risk.

## 5. Testing / verification plan

No test suite exists in this repo (per CLAUDE.md). Verification is manual:

- `tsc --noEmit` and `npm run lint` clean.
- Apply the new migration locally (`supabase db reset` or equivalent) and
  manually sign in as one seed user per role (`coo`, `training_director`,
  `hr`, `ceo`, `technical`) to confirm:
  - Each scoped role sees only their group's staff/swap/leave/attendance
    numbers and rows, matching `MANAGER_GROUP_META` description.
  - `ceo`/`technical` still see full org-wide data, unchanged.
  - The removed "Nhóm vận hành" duplicate block is gone for `coo`; no
    equivalent duplicate ever existed for the other two roles.
  - Direct Supabase queries (e.g. via the SQL editor as a `coo` JWT, or
    `psql` with `set role` simulation) confirm `profiles` and
    `shift_swap_requests` SELECT no longer return out-of-group rows for
    `coo`/`training_director`.

## 6. Audit report (Part 1 of the original request)

Delivered as a written summary alongside this spec, not as code changes:
1. The RLS gap described in §2.1 (root cause, fixed by this spec).
2. The stale/unimplemented comment in §2.2 (fixed by this spec, since it
   describes exactly the HR scoping this spec now implements).
3. No other CLAUDE.md/AGENTS.md convention violations found during this
   pass (naming, Server Component/Action boundaries, validation schemas,
   error-mapping, design tokens all consistent with documented
   conventions).
