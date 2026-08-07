# Multi-Branch Staff — Cutover Design

**Date:** 2026-08-07
**Status:** Approved (pending implementation)
**Supersedes/completes:** `docs/superpowers/specs/2026-08-05-multi-branch-staff-design.md` — that spec was approved 2026-08-05 and partially landed as migration `0024_profile_branches.sql` (the `profile_branches` join table + `is_branch_member()` function), but the cutover it called for (RLS rewrite, server actions, UI) was never done. `profiles.branch_id` (single) has remained the only live source of truth since, and `profile_branches` has silently drifted out of sync (populated once at migration time, never written to since). This spec re-verifies every assumption against the current codebase (post-`0031`) and completes the cutover.

## Problem

A staff member can only belong to one cơ sở today (`profiles.branch_id`, single nullable FK). Real staff (Quản sinh, Trợ giảng, Giáo viên, etc.) regularly work across multiple branches. Need: assign a person to N branches (register form + manager dashboard, both multi-select), and have that membership set drive branch visibility everywhere — calendar, shift creation, and the request flows — instead of the current single value.

## What's already true today (verified 2026-08-07, not assumed from the old spec)

- `profile_branches(profile_id, branch_id)` and `is_branch_member(p_profile_id, p_branch_id)` already exist (`0024`). RLS on the table: anyone can read all rows; only `is_manager()` can write. **No dual-write exists anywhere** — `updateStaffBranchAction` and `handle_new_user()` both still only touch `profiles.branch_id`. Every profile created since `0024` shipped has zero `profile_branches` rows.
- Management-tier roles (`ceo`, `coo`, `training_director`, `technical`) already have `branch_id = null` by convention ("Toàn hệ thống") and are exempt from branch pickers in `StaffTable.tsx`. This exemption carries over unchanged: management-tier gets no `profile_branches` rows either, still "all branches" everywhere.
- Unlike what the 2026-08-05 spec assumed, `ShiftFormDialog.tsx` and `ShiftRequestDialog.tsx` **already have explicit branch `<Select>` fields** (added by `0023_explicit_shift_branch.sql`, after that spec was written) — but both show the full unfiltered branch list, not scoped to the assignee/requester's branches. `CalendarSidebar.tsx` **already has** a "Cơ sở" branch-filter/toggle section. So the "UI Components" and "Calendar Display" sections of the old spec are partly done already — this spec only adds the missing filtering, not new fields from scratch.
- `leave_requests.branch_id` is a **vestigial column**: `request_leave()` still requires deriving it from the caller's single `profiles.branch_id` (raises if null), but the live `leave_select_own_or_manager` RLS policy (current version, `0029`) and `respond_to_leave_request()`'s authorization check do **not** reference branch at all anymore — both were already migrated to role/group-based (`can_view_profile`/`can_view_profile_calendar`) visibility. No app code reads `leave_requests.branch_id` for filtering or display either. This means leave requests need no branch-picker UI and no real "which branch" decision — just something non-null to satisfy the column.
- Shift swap requests and (on approval) attendance corrections already derive `branch_id` from the referenced **shift's** own `branch_id`, not from any profile — unaffected by this change.
- `current_branch_id()` (`select branch_id from profiles where id = auth.uid()`) is referenced by ~20 RLS policies/RPCs across 10 migrations (full list produced during research; the implementation plan will re-verify each site directly against the live migration files rather than trusting this count from memory).

## Scope

In scope: `profiles` ↔ `branches` becomes many-to-many, live and enforced; Register form + Staff Table both get a multi-select branch picker; every `current_branch_id()`-gated RLS policy/RPC is rewritten to membership-based (`is_branch_member`); `ShiftFormDialog`/`ShiftRequestDialog`'s existing branch pickers get scoped to the relevant person's branches; `profiles.branch_id` is dropped once the cutover is verified.

Out of scope: leave/swap/attendance-correction still don't get a branch field in their own UI (leave's is vestigial per above, swap/correction already derive from the shift) — no product change needed there beyond making `request_leave()` not depend on the now-retired single column. Calendar shift-chip branch badges (mentioned as a nice-to-have in the old spec) — not requested this round, not added.

## 1. Data model & backfill

- `profile_branches` stays as-is (schema, RLS unchanged — already correctly scoped: public read, manager-only write).
- New migration reconciles it with current reality: `insert into profile_branches (profile_id, branch_id) select id, branch_id from profiles where branch_id is not null on conflict do nothing` — catches every profile created or reassigned since `0024`'s one-time backfill (idempotent, safe to re-run).
- `profiles.branch_id` is **dropped** in a later migration, once the app no longer reads or writes it anywhere (last step, not first — see Sequencing).

## 2. RLS & RPCs

- Every policy/RPC currently comparing `branch_id = current_branch_id()` is rewritten to `public.is_branch_member(auth.uid(), branch_id)` — an unconditional widening (a person who could already see a row via their old single branch still can, via the now-equivalent single-row membership from backfill; they additionally gain visibility at any other branch they're added to). Any existing `is_manager()` / `can_view_profile()` / `can_view_profile_calendar()` OR-clauses in these policies are left untouched.
- `current_branch_id()` itself: once no policy calls it, it becomes dead code — dropped in the same cleanup migration as `profiles.branch_id` (a function reading a column that no longer exists can't be kept anyway).
- New `SECURITY DEFINER` RPC `set_profile_branches(p_profile_id uuid, p_branch_ids uuid[])`: atomically replaces a profile's `profile_branches` rows (delete + insert in one function, `is_manager()`-gated) — mirrors the codebase's existing convention of pushing atomic multi-row writes into Postgres RPCs rather than doing delete+insert as two round trips from a Server Action.
- `handle_new_user()` trigger: reads a JSON array (`raw_user_meta_data -> 'branch_ids'`) instead of a scalar `branch_id`, inserts one `profile_branches` row per id. Empty/missing array (self-signup didn't pick anything, or a management-tier signup path) → zero rows, same as today's `branch_id = null` case — no exception raised, matches the existing "front-line with no branch yet, nagged by the banner until a manager fixes it" pattern.
- `request_leave()`: drop the "derive from `profiles.branch_id`, raise if null" step entirely. `leave_requests.branch_id` becomes nullable in the same migration (column kept for now — dropping it is a separate, unrequested cleanup outside this spec's scope) and `request_leave()` stops setting it, since it's confirmed unused for both visibility and display. No arbitrary "pick one branch" derivation — that would fabricate meaning a column no longer has.

## 3. UI — Register form & Staff Table

- New shared component `MultiSelectBranches` (Popover + Command + checkbox items + removable badge chips — shadcn has no built-in multi-select). Styled per `DESIGN.md` conventions (soft-tint chips, navy/gold).
- `RegisterForm.tsx`: replaces the single `<Select name="branch_id">` with `MultiSelectBranches`, at least one branch required. `signUpAction`/`registerSchema` change `branch_id: string` → `branch_ids: string[]`.
- `StaffTable.tsx`: replaces the single `<Select>` in the branch cell with `MultiSelectBranches`, backed by `set_profile_branches` via a new `updateStaffBranchesAction(profileId, branchIds: string[])` in `actions/staff.ts` (replaces `updateStaffBranchAction`). Management-tier rows keep the static "Toàn hệ thống" text, unchanged — and the existing role-change handler that clears branch on promotion to manager-tier now calls `set_profile_branches(profileId, [])` instead of the old single-branch nulling.
- The "Bạn chưa được gán cơ sở làm việc" banner (`app/(app)/layout.tsx`) and the manager dashboard's "unassigned staff" KPI both flip their condition from `!profile.branch_id` to "zero `profile_branches` rows" (front-line only; management-tier stays exempt, unchanged).

## 4. UI — Shift creation & self-request branch filtering

- `ShiftFormDialog.tsx`: its existing branch `<Select>` gets scoped — when the selected assignee is front-line, options narrow to that assignee's `profile_branches`; when management-tier, options stay the full branch list (unchanged, matches their "all branches" status). Re-filters whenever the assignee selection changes. `actions/shifts.ts` adds a server-side check that the submitted `branch_id` is actually valid for the assignee (defense in depth — the picker filtering is UX, the server check is the real gate, matching this codebase's established "server actions do the real validation" convention).
- `ShiftRequestDialog.tsx`: same treatment, scoped to the logged-in requester's own `profile_branches` (or all branches if they're management-tier, per `DIRECT_SHIFT_ROLES`/self-request eligibility already in place).

## Sequencing (for the implementation plan)

1. Backfill migration (additive, no behavior change yet).
2. RLS/RPC rewrite migration(s) — widening only, safe to ship alone and verify before touching UI.
3. Server actions (`set_profile_branches`, `updateStaffBranchesAction`, `handle_new_user()` array support, `request_leave()` column-dependency removal).
4. UI (`MultiSelectBranches`, Register form, Staff Table, Shift dialogs' filtering).
5. Verify end-to-end against production (mirroring this session's established pattern: real signed-in test sessions, not just reading policy text) — confirm a multi-branch person is visible/schedulable at every branch they belong to, and that dropping their old single branch's *sole* membership correctly removes visibility there.
6. Only after 1–5 are verified stable: drop `profiles.branch_id` and `current_branch_id()` in a final cleanup migration.

## Risks

1. RLS rewrite touches ~20 policy/RPC bodies across 10 migrations — each needs individual verification against its current (possibly already-superseded) live definition, not just the original 0001-era text, since several were rewritten multiple times since (`shifts_select_branch`, `swaps_select_branch`, `profiles_select_branch` all have 2+ historical versions).
2. `handle_new_user()` parsing a JSON array out of `raw_user_meta_data` inside a `plpgsql` trigger needs care around empty/missing arrays — get this wrong and self-signup could silently create zero-branch profiles even when the user did pick branches.
3. Dropping `profiles.branch_id` is a breaking schema change with no automated tests in this repo — every branch-reading surface must be manually re-verified working off `profile_branches` before step 6 runs, not just "believed done."
