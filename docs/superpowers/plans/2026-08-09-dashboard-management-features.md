# Dashboard Management Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three manager-facing capabilities to `/manager`: deactivate a staff account, delete a shift, delete a pending request (leave/swap/shift-request/attendance-correction) — plus fix the attendance-correction approval popup that doesn't auto-close.

**Architecture:** Reuse the existing group-permissions predicates (`canCreateShiftFor`, `canApproveShiftRequestFor`, `canApproveSwapRequestFor`, `canApproveLeaveFor` + their SQL mirrors from `0048_group_permissions_sql_functions.sql`) as the authorization source for every new delete action — no new permission model. Deactivation is soft (reversible): a nullable `deactivated_at` on `profiles`, gated to `technical` only, enforced at `requireProfile()`.

**Tech Stack:** Next.js 16 Server Actions, Supabase Postgres RLS, existing shadcn `AlertDialog` for destructive confirmations.

## Global Constraints
- Next migration number: 0050.
- Delete scope: requests only deletable while `status = 'pending'`; resolved/cancelled requests stay as history (locked via AskUserQuestion).
- Delete/deactivate permission scope: identical to existing approve/create scope for that resource — no new, stricter tier (locked via AskUserQuestion), except deactivate-user itself which is `technical`-only (locked via AskUserQuestion).
- `/calendar` and its components stay untouched — the new shift list is a new section on `/manager`, not a change to the calendar.
- All new user-facing strings in Vietnamese, matching existing label/tone conventions in `lib/constants.ts` and the card components.

---

### Task 0: Fix attendance-correction approval dialog not closing

**Files:**
- Modify: `components/calendar/AttendanceDetailDialog.tsx:84-97`

**Status:** Already implemented and verified (`tsc --noEmit` clean) in this session — `handleRespond` now calls `onOpenChange(false)` after a successful respond, matching `handleDelete` in the same file and `handleRespond` in every sibling dialog (`LeaveDetailDialog`, `ShiftRequestDetailDialog`).

- [ ] **Commit**

```bash
git add components/calendar/AttendanceDetailDialog.tsx
git commit -m "fix: close attendance correction dialog after approve/reject"
```

---

### Task 1: Migration 0050 — profiles.deactivated_at + request delete RLS policies

**Files:**
- Create: `supabase/migrations/0050_deactivate_and_delete_policies.sql`

**Interfaces:**
- Produces: `profiles.deactivated_at timestamptz` (nullable); RLS `for delete` policies on `leave_requests`, `shift_requests`, `shift_swap_requests`, `attendance_corrections`, all `status = 'pending'`-gated.

- [ ] **Step 1: Write the migration**

```sql
-- profiles.deactivated_at: soft-delete for staff accounts. Nullable — null
-- means active. Blocking happens app-side in requireProfile() (lib/auth.ts),
-- not in RLS, because the block must fire on every request including the
-- one that reads the profile row itself.
alter table public.profiles add column if not exists deactivated_at timestamptz;

-- Manager-side hard delete for PENDING requests only — resolved/cancelled
-- rows stay as history. Reuses the exact predicates that already gate
-- respond_to_*() RPCs (0048_group_permissions_sql_functions.sql), so delete
-- authority never exceeds approve authority for the same resource.
drop policy if exists leave_requests_delete_manager on public.leave_requests;
create policy leave_requests_delete_manager on public.leave_requests
  for delete to authenticated
  using (status = 'pending' and public.can_view_profile(profile_id));

drop policy if exists shift_requests_delete_manager on public.shift_requests;
create policy shift_requests_delete_manager on public.shift_requests
  for delete to authenticated
  using (status = 'pending' and public.can_approve_shift_request(profile_id));

-- Mirrors canApproveSwapRequestFor's own restriction: only requests with a
-- specific target_id are manager-approvable/deletable — "open" requests
-- (target_id null) stay peer-claim-only, per the existing respond flow.
drop policy if exists shift_swap_requests_delete_manager on public.shift_swap_requests;
create policy shift_swap_requests_delete_manager on public.shift_swap_requests
  for delete to authenticated
  using (
    status = 'pending'
    and target_id is not null
    and public.can_approve_swap_request(requester_id, target_id)
  );

drop policy if exists attendance_corrections_delete_manager on public.attendance_corrections;
create policy attendance_corrections_delete_manager on public.attendance_corrections
  for delete to authenticated
  using (status = 'pending' and public.can_view_profile(profile_id));
```

- [ ] **Step 2: Apply to production**

Run: `npx supabase db push`
Expected: migration `0050_deactivate_and_delete_policies` applied cleanly.

- [ ] **Step 3: Verify with disposable test accounts**

Create 2 test profiles via `auth.admin.createUser` (a `training_director` and a `teacher`), have the teacher submit a leave request, confirm:
- `training_director` (in-group) can `delete` the pending row via the anon client with their session — row disappears.
- A second pending row, approved first (`status = 'approved'`), then delete attempt from the same manager → RLS denies (0 rows affected).
- An out-of-group manager (`hr`) delete attempt on a pending in-group row → RLS denies.

Delete both test profiles via `auth.admin.deleteUser` when done.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0050_deactivate_and_delete_policies.sql
git commit -m "feat: add profiles.deactivated_at and manager delete RLS for pending requests"
```

---

### Task 2: Deactivate/reactivate staff — types, auth gate, server action

**Files:**
- Modify: `types/index.ts` (add `deactivated_at: string | null` to `Profile`)
- Modify: `lib/auth.ts` (`PROFILE_COLUMNS`, `ProfileRow`, `toProfile`, `requireProfile`)
- Modify: `actions/staff.ts` (new `deactivateStaffAction`)

**Interfaces:**
- Produces: `deactivateStaffAction(profileId: string, deactivate: boolean): Promise<ActionResult>`, `technical`-only, self-deactivation blocked.

- [ ] **Step 1: Add the field to the `Profile` type**

In `types/index.ts`, add `deactivated_at: string | null;` next to the existing `notifications_seen_at: string | null;` field on `Profile`.

- [ ] **Step 2: Thread it through `lib/auth.ts`**

```ts
const PROFILE_COLUMNS =
  "id, full_name, phone, role, color, notifications_seen_at, deactivated_at, profile_branches(branch_id)";

type ProfileRow = {
  // ...existing fields
  deactivated_at: string | null;
};

function toProfile(row: ProfileRow): Omit<Profile, "email"> {
  return {
    // ...existing fields
    deactivated_at: row.deactivated_at,
    branch_ids: (row.profile_branches ?? []).map((pb) => pb.branch_id),
  };
}
```

- [ ] **Step 3: Block login for deactivated accounts in `requireProfile()`**

```ts
export async function requireProfile() {
  const profile = await getSessionProfile();
  if (!profile) redirect("/login");
  if (profile.deactivated_at) {
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }
  return profile;
}
```

- [ ] **Step 4: Write `deactivateStaffAction`**

```ts
export async function deactivateStaffAction(
  profileId: string,
  deactivate: boolean
): Promise<ActionResult> {
  const manager = await requireManager();
  if (manager.role !== "technical") {
    return { ok: false, error: "Chỉ Kỹ thuật mới có quyền vô hiệu hoá tài khoản" };
  }
  if (profileId === manager.id) {
    return { ok: false, error: "Không thể tự vô hiệu hoá tài khoản của chính mình" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ deactivated_at: deactivate ? new Date().toISOString() : null })
    .eq("id", profileId);

  if (error) return { ok: false, error: "Không thể cập nhật trạng thái tài khoản" };

  revalidatePath("/manager");
  return { ok: true, data: undefined };
}
```

Note: this relies on the existing `profiles_update_manager` RLS policy (any manager-tier role can update any profile row) for the actual write — the `technical`-only gate is app-layer only, same pattern as `updateStaffRoleAction` in the same file. That is an acceptable, existing precedent in this codebase (see Global Constraints: reuse existing scope, no new stricter DB-layer tier for this feature).

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` and `npm run lint` — both clean.

- [ ] **Step 6: Commit**

```bash
git add types/index.ts lib/auth.ts actions/staff.ts
git commit -m "feat: add deactivateStaffAction and deactivated_at login gate"
```

---

### Task 3: Deactivate/reactivate UI in StaffTable

**Files:**
- Modify: `components/manager/StaffTable.tsx`
- Modify: `app/(app)/manager/page.tsx` (pass `currentUserRole` to `StaffTable`)

**Interfaces:**
- Consumes: `deactivateStaffAction` from Task 2.
- Produces: `StaffTable` gains `currentUserRole: Role` prop; renders a status column when `currentUserRole === "technical"`.

- [ ] **Step 1: Pass `deactivated_at` and role through the staff query**

In `app/(app)/manager/page.tsx`, add `deactivated_at` to the `staff` select and to `StaffQueryRow`/`staffList` mapping (mirrors how `branch_ids` is already assembled from the joined row). Pass `currentUserRole={manager.role}` to `<StaffTable />`.

- [ ] **Step 2: Add the deactivate/reactivate column to `StaffTable.tsx`**

Add `deactivated_at: string | null` to `StaffRow`, add `currentUserRole: Role` to the component props, and render a 5th column (only when `currentUserRole === "technical"`) with an `AlertDialog`-confirmed toggle button ("Vô hiệu hoá" / "Kích hoạt lại"), calling `deactivateStaffAction`. A deactivated row gets a muted `Badge variant="outline"` reading "Đã vô hiệu hoá" next to the name — visible, not hidden, so it can be found and reversed. Follow the same `useTransition` + optimistic local state pattern already used by `handleRoleChange`/`handleBranchesChange` in the same file, and the same `AlertDialog` confirm pattern already used in `components/calendar/AttendanceDetailDialog.tsx`'s delete button.

- [ ] **Step 3: Verify with `tsc --noEmit` and manual click-test**

Run `npx tsc --noEmit`. Then start the dev server, log in as a `technical` test account, open `/manager`, deactivate a disposable test account, confirm the badge appears and a `coo`/`hr` account does NOT see the deactivate button. Reactivate and confirm the badge disappears. Log in as the deactivated test account directly (before reactivating) and confirm it's bounced to `/login`.

- [ ] **Step 4: Commit**

```bash
git add components/manager/StaffTable.tsx "app/(app)/manager/page.tsx"
git commit -m "feat: deactivate/reactivate staff accounts from the technical dashboard"
```

---

### Task 4: Shift list + delete on `/manager`

**Files:**
- Create: `components/manager/ShiftsOverviewTable.tsx`
- Modify: `app/(app)/manager/page.tsx` (fetch shifts, render new Section)

**Interfaces:**
- Consumes: existing `deleteShiftAction` (`actions/shifts.ts:137`, already RLS-scoped via `can_manage_shift_for`), existing `canCreateShiftFor(viewerRole, targetRole, permissions)`.
- Produces: a new "Ca làm việc" Section on `/manager`, period-tab-filtered (day/month/year, reusing `OverviewPeriod`), each row showing person/date/time/branch/type with a Xoá button gated by `canCreateShiftFor`.

- [ ] **Step 1: Fetch shifts in `manager/page.tsx`**

Add a query alongside the existing `Promise.all` fetches:

```ts
supabase
  .from("shifts")
  .select("id, start_at, end_at, shift_type, assignee:profiles!assignee_id(id, full_name, role), branch:branches!branch_id(id, name)")
  .order("start_at", { ascending: false })
  .limit(500),
```

Scope it the same way `scopedStaff`/`scopedSwaps` etc. are scoped (filter to `rosterRoles` when `isGroupManager`), and pass the scoped list into a new `<Section id="shifts" title="Ca làm việc">` rendering `<ShiftsOverviewTable />`, placed after the existing "Nhân viên" Section.

- [ ] **Step 2: Write `ShiftsOverviewTable.tsx`**

Mirror `RequestsOverviewTable.tsx`'s period-tabs-and-search shell, but render one row per shift (not aggregated counts): name, ngày, giờ bắt đầu–kết thúc, cơ sở, `Badge` cho `shift_type`. Each row gets a Xoá button, shown only when `canCreateShiftFor(currentUserRole, shift.assignee.role, permissions)` is true, wrapped in the same `AlertDialog` confirm pattern as Task 3, calling `deleteShiftAction(shift.id)` and showing a `toast.success("Đã xoá ca làm việc")`. Requires `currentUserRole: Role` and `permissions: GroupPermissions` as new props, passed from `manager/page.tsx` (`manager.role`, the already-fetched `permissions`).

- [ ] **Step 3: Verify**

Run `npx tsc --noEmit` and `npm run lint`. Manually: as `coo`, open `/manager`, confirm the shift list shows only vận hành-group shifts, delete one, confirm it disappears from `/calendar` too (same underlying row). As `training_director`, confirm no Xoá button appears on a `coo`-group shift shown in view (if visible at all under scoping).

- [ ] **Step 4: Commit**

```bash
git add components/manager/ShiftsOverviewTable.tsx "app/(app)/manager/page.tsx"
git commit -m "feat: add shift list with delete to the manager dashboard"
```

---

### Task 5: Delete pending requests — server actions

**Files:**
- Modify: `actions/leave.ts` (new `deleteLeaveRequestAction`)
- Modify: `actions/shift-requests.ts` (new `deleteShiftRequestAction`)
- Modify: `actions/swaps.ts` (new `deleteSwapRequestAction`)
- Modify: `actions/attendance-corrections.ts` (new `deleteAttendanceCorrectionAction`)

**Interfaces:**
- Produces: 4 new `Promise<ActionResult>` actions, each `requireManager()`-gated, deleting a `status = 'pending'` row by id. The RLS policies from Task 1 are the actual authorization boundary — these actions are thin wrappers, matching the codebase's established Server Actions pattern (validate → call → map error → revalidate → return).

- [ ] **Step 1: `deleteLeaveRequestAction`**

```ts
export async function deleteLeaveRequestAction(requestId: string): Promise<ActionResult> {
  await requireManager();
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("leave_requests")
    .delete({ count: "exact" })
    .eq("id", requestId)
    .eq("status", "pending");

  if (error) return { ok: false, error: "Không thể xoá đơn nghỉ phép" };
  if (!count) return { ok: false, error: "Bạn không có quyền xoá đơn này" };

  revalidateLeavePaths();
  return { ok: true, data: undefined };
}
```

(`count: "exact"` — same "read the row back" defensiveness as `updateStaffRoleAction`: a bare `.delete()` silently no-ops instead of erroring if RLS denies it, so an explicit affected-row count is required to detect a denied delete and surface it as a real error instead of a false-success toast.)

- [ ] **Step 2: `deleteShiftRequestAction`** — same shape, `shift_requests` table, call `revalidateShiftRequestPaths()`-equivalent (match whatever the file's existing revalidate helper is named).

- [ ] **Step 3: `deleteSwapRequestAction`** — same shape, `shift_swap_requests` table.

- [ ] **Step 4: `deleteAttendanceCorrectionAction`** — same shape, `attendance_corrections` table.

- [ ] **Step 5: Verify**

Run `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add actions/leave.ts actions/shift-requests.ts actions/swaps.ts actions/attendance-corrections.ts
git commit -m "feat: add manager delete actions for pending leave/shift/swap/correction requests"
```

---

### Task 6: Delete button on the 4 request cards

**Files:**
- Modify: `components/leave/LeaveRequestCard.tsx`
- Modify: `components/shifts/ShiftRequestCard.tsx`
- Modify: `components/swaps/SwapRequestCard.tsx`
- Modify: `components/attendance/AttendanceCorrectionCard.tsx`
- Modify: `app/(app)/manager/page.tsx` (pass `canDelete` to each card)

**Interfaces:**
- Consumes: the 4 delete actions from Task 5.
- Produces: each card gains a `canDelete: boolean` prop and a destructive "Xoá" button (`AlertDialog`-confirmed — this removes the row entirely, unlike "Từ chối" which keeps it as history), shown only when `canDelete && request.status === "pending"`.

- [ ] **Step 1: `LeaveRequestCard.tsx`** — add `canDelete: boolean` prop, `handleDelete` calling `deleteLeaveRequestAction`, and an `AlertDialog`-wrapped destructive "Xoá" button next to the existing Từ chối/Duyệt/Huỷ buttons (same row, `gap-2` flex container already there).

- [ ] **Step 2: `ShiftRequestCard.tsx`** — same pattern, `deleteShiftRequestAction`.

- [ ] **Step 3: `SwapRequestCard.tsx`** — same pattern, `deleteSwapRequestAction`.

- [ ] **Step 4: `AttendanceCorrectionCard.tsx`** — same pattern, `deleteAttendanceCorrectionAction`.

- [ ] **Step 5: Wire `canDelete` in `manager/page.tsx`**

For each of the 4 card usages, add `canDelete={<same boolean expression already passed to canRespond>}` — delete authority mirrors approve authority exactly, per the locked design decision.

- [ ] **Step 6: Verify**

Run `npx tsc --noEmit` and `npm run lint`. Manually: as `hr`, open `/manager`, delete a pending leave request from an in-group staff member, confirm it disappears from the Nghỉ phép section and does not reappear on reload. Confirm an already-approved request shows no Xoá button.

- [ ] **Step 7: Commit**

```bash
git add components/leave/LeaveRequestCard.tsx components/shifts/ShiftRequestCard.tsx components/swaps/SwapRequestCard.tsx components/attendance/AttendanceCorrectionCard.tsx "app/(app)/manager/page.tsx"
git commit -m "feat: add delete button to pending request cards on the manager dashboard"
```

---

### Task 7: Full regression + deploy

- [ ] **Step 1:** `npx tsc --noEmit`, `npm run lint`, `npm run build` — all clean.
- [ ] **Step 2:** Regression per role (ceo, coo, training_director, hr, technical) on `/manager`: existing approve/reject/cancel flows unchanged; new deactivate/delete controls appear only where the locked design says they should.
- [ ] **Step 3:** Clean up every disposable test account created during verification (`auth.admin.deleteUser`).
- [ ] **Step 4:** `npx supabase db push` (if Task 1 wasn't already pushed), then `npx vercel deploy --prod`.
- [ ] **Step 5:** Re-verify the popup-close fix (Task 0) and one deactivate/delete flow each on live production.
