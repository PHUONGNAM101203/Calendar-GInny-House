# Multi-Branch Staff & Shift Assignment — Design

**Date:** 2026-08-05
**Status:** Approved (pending implementation)

## Problem

`profiles.branch_id` is a single, nullable FK — one staff member can only belong to
one branch ("cơ sở"). In reality, teachers and staff regularly work across multiple
branches (e.g. teach at all 3, or cover CS1 one day and CS2 another). The system
needs to model "belongs to N branches" instead of "belongs to 1 branch", and every
shift needs an explicit, creator-chosen branch instead of one silently derived from
the assignee's single branch.

## Scope

In scope: `profiles` ↔ `branches` becomes many-to-many; shift creation gets an
explicit branch selector; Register form and Staff Table both use a shared
multi-select branch picker; the calendar shows each shift's branch (badge on the
event + a branch filter in the sidebar).

Out of scope: RLS visibility rules for staff/leave (`can_view_profile`,
`is_leave_approver`) are role/group-based already, not branch-based — this project
does not change who can see whom, only how branch membership and shift branch are
stored/selected/displayed.

## 1. Data Model

- New join table `profile_branches (profile_id uuid references profiles(id) on delete cascade, branch_id uuid references branches(id) on delete cascade, primary key (profile_id, branch_id))`.
- Migrate existing `profiles.branch_id` data into `profile_branches`, then **drop
  `profiles.branch_id`** — single source of truth, no transitional dual-column state.
- `shifts.branch_id` (FK, not null) is **unchanged in shape**, but the `sync_shift_branch()`
  trigger that auto-derives it from the assignee's (former single) branch is **removed**.
  Branch becomes a required, explicitly-chosen field on shift create/edit.
- Management-tier roles (`ceo`, `coo`, `training_director`, `technical` — the existing
  `MANAGER_ROLES` set) do **not** get `profile_branches` rows and are treated as
  "all branches" everywhere a branch-membership check happens — same behavior as
  today's "Toàn hệ thống" special case, just re-expressed against the new model.

## 2. Server Actions & RLS

- `actions/staff.ts`: `updateStaffBranchAction(profileId, branchIds: string[])` replaces
  the single-`branchId` version. Backed by a new `SECURITY DEFINER` RPC
  `set_profile_branches(p_profile_id uuid, p_branch_ids uuid[])` that atomically
  replaces a profile's branch rows (delete + insert in one function), following the
  codebase's existing convention of pushing atomic multi-row writes into Postgres RPCs.
- `lib/validations/shift.ts`: `shiftSchema` gains `branch_id: z.uuid()` (required).
  `actions/shifts.ts` validates the submitted `branch_id` is a member of the assignee's
  `profile_branches` (or accepts any branch if the assignee is management-tier).
- `actions/auth.ts` (Register): `branch_id` (single) becomes `branch_ids: string[]`,
  passed through `supabase.auth.signUp({ options: { data: { branch_ids } } })`.
  `handle_new_user()` (SQL trigger) is updated to read the JSON array from
  `raw_user_meta_data` and insert one `profile_branches` row per id, instead of setting
  a single column.
- **Audit required before implementation**: grep every migration for
  `current_branch_id()` and any policy comparing `branch_id = current_branch_id()`
  (e.g. `swaps_select_branch`) to confirm which are still live after being loosened in
  migrations `0006`/`0013`. Multi-branch breaks the "one scalar branch per user"
  assumption those policies were written against — each live usage needs a rewrite to
  an `EXISTS (select 1 from profile_branches ...)` check (or removal, if superseded).

## 3. UI Components

- **New shared component `MultiSelectBranches`** (Popover + Command + checkbox items +
  removable badge chips — the standard shadcn multi-select recipe; shadcn has no
  built-in multi-select primitive). Styled per `DESIGN.md` (navy/gold, soft-tint
  badges). Reused in:
  - `components/manager/StaffTable.tsx` — replaces the current single `<Select>` in
    `RoleAndBranchCells`. Management-tier rows keep showing static "Toàn hệ thống" text
    (no picker), same as today.
  - `components/auth/RegisterForm.tsx` — replaces the current single `<Select
    name="branch_id">`. Whatever the user picks here becomes their permanent
    `profile_branches` rows — Register is the only "first write"; nothing downstream
    re-asks or re-collects this, it only *displays/edits* the same underlying rows
    (e.g. later in Staff Table, admin-only).
- **`components/shifts/ShiftFormDialog.tsx`**: gains a single-select branch field
  (one shift = one branch). Options = the currently-selected assignee's
  `profile_branches` (or all 3 branches if the assignee is management-tier). Every
  role sees this field when creating a shift — including CEO/COO/GĐĐT/Kỹ thuật
  registering their own shift, since even management-tier must pick which specific
  branch a given shift belongs to (their "all branches" status only widens the
  dropdown's options, it doesn't hide or skip the field). Field re-populates whenever
  the assignee selection changes.

## 4. Calendar Display

- Each shift chip in `ShiftCalendar.tsx` shows a small branch badge (code, e.g. "CS1")
  alongside the existing person-color styling — reuses `branches.color_token` already
  in the schema.
- `CalendarSidebar.tsx` gains a branch filter/toggle group (checkbox list, same
  interaction pattern as the existing per-person follow-color list), so a viewer can
  show/hide shifts by branch independent of the person-follow selection.

## Risks / Open Items for Planning

1. RLS policy audit (see §2) must happen before writing the migration — could surface
   additional policies needing rewrite beyond what's listed here.
2. `handle_new_user()` trigger currently sets a scalar column; parsing a JSON array
   out of `raw_user_meta_data` inside a trigger needs care (empty array / null handling
   for management-tier signups, if that path is ever used for them).
3. Dropping `profiles.branch_id` is a breaking schema change — no automated tests
   exist (`TESTING.md` confirms none), so manual verification of every branch-reading
   surface (Staff Table, shift create/edit, calendar filter, Register) is required
   before considering this done.
