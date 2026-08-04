# Codebase Concerns

**Analysis Date:** 2026-08-04

## Test Coverage Gaps

**No automated tests exist anywhere in the repo:**
- What's not tested: everything — there is no `*.test.*`/`*.spec.*` file, no Jest/Vitest/Playwright config, and no `test` script in `package.json:6-10` (only `dev`, `build`, `start`, `lint`).
- Files: entire `actions/*.ts` (10 files, all Supabase RPC-calling server actions), `lib/calendar.ts` (484 lines of event-shaping logic: `toAttendanceEvents`, `toLeaveEvents`, `toCalendarEvents`, color-hash `getPersonColorVar`), `lib/roles.ts` (`getCalendarScope`, `canApproveLeaveFor` — permission logic mirrored in SQL, see below).
- Risk: the permission/visibility logic in `lib/roles.ts` is manually kept in sync with equivalent SQL in `supabase/migrations/0013_group_scoped_visibility.sql` (comment at top: "Mirrors lib/roles.ts getCalendarScope()/canApproveLeaveFor() — keep in sync") with no test asserting they actually agree. A drift here is a silent authorization bug (UI hides something RLS would allow, or vice versa).
- Priority: High — this app enforces role/branch/group-scoped visibility and money-adjacent scheduling (chấm công/attendance) with zero regression safety net.

## Tech Debt

**Enum/CASE-cast bug pattern shipped three times before being fixed:**
- Issue: Postgres resolves a `CASE WHEN ... THEN 'approved' ELSE 'rejected' END` expression's type from its two string-literal branches as `text`, not the target enum column's type, so a plain (uncast) `status = case when ... end` assignment fails at runtime with "column status is of type X but expression is of type text".
- Files: `supabase/migrations/0004_leave_requests.sql:83` (`respond_to_leave_request`, first version, no cast) → re-declared again with the same bug in `supabase/migrations/0006_global_manager_scope.sql:117` → the shift-request equivalent shipped with the same bug in `supabase/migrations/0010_shift_requests.sql:143` (`respond_to_shift_request`) → both finally fixed by adding `::public.leave_status` / `::public.shift_request_status` casts in `supabase/migrations/0011_fix_status_case_cast.sql:21` and `:59` → `respond_to_leave_request` redefined again (correctly, cast preserved) in `supabase/migrations/0013_group_scoped_visibility.sql:77`.
- Impact: every approve/reject action for leave requests and shift requests was completely broken (500 on every click) for two migration generations before 0011 landed. Confirmed by the fix commit's own comment in `supabase/migrations/0011_fix_status_case_cast.sql:1-6`.
- Fix approach for future migrations: any new `plpgsql` function that assigns an enum column via a `CASE WHEN <bool> THEN '<literal>' ELSE '<literal>' END` must wrap the whole expression in `(...)::public.<enum_type>` — grep new migrations for `case when.*then '.*' else '.*' end` (without a following `::`) before merging.

**Business-logic duplication between TypeScript and SQL:**
- Issue: role-based visibility scoping is implemented twice — once as `getCalendarScope()` / `canApproveLeaveFor()` in `lib/roles.ts`, and once as the `can_view_profile()` / `is_leave_approver()` SQL functions in `supabase/migrations/0013_group_scoped_visibility.sql:9-33`. The migration explicitly documents this as an invariant to maintain by hand ("keep in sync"), with no shared source of truth and no test enforcing agreement.
- Files: `lib/roles.ts`, `supabase/migrations/0013_group_scoped_visibility.sql`.
- Impact: a future role/group change applied to only one side produces a UI/RLS mismatch — e.g., UI shows a "duyệt" (approve) button that the RPC then rejects, or UI hides a record the RLS policy would actually return.
- Fix approach: either generate one from the other, or add an integration test that seeds each role/group pair and asserts `lib/roles.ts` predictions match live RLS/RPC behavior.

**Duplicated "known error message" allowlist pattern across every action file:**
- Issue: `actions/swaps.ts:8-27` (`mapSwapError`), `actions/leave.ts:9-22` (`mapLeaveError`), `actions/shifts.ts:9-19` (`mapShiftError`), and `actions/attendance.ts:8-13` (`mapAttendanceError`) each hardcode a list of exact Vietnamese `RAISE EXCEPTION` strings from the SQL RPCs and fall back to a generic message if the substring match fails. `actions/shift-requests.ts:35,66` instead passes `error.message` straight through, which is an inconsistent strategy within the same feature set (compare to `actions/leave.ts` which never passes raw RPC errors to the client).
- Files: `actions/swaps.ts`, `actions/leave.ts`, `actions/shifts.ts`, `actions/attendance.ts`, `actions/shift-requests.ts`.
- Impact: renaming or rewording any `raise exception` message in a migration silently breaks the matching client-side allowlist (falls through to the generic "Không thể thực hiện..." message) with no compiler or test signal.
- Fix approach: standardize on Postgres error codes (`errcode`) instead of message-substring matching, or centralize the mapping tables in one file per RPC family and add a test asserting each hardcoded string still appears in the corresponding migration file.

**No shared error page (`app/error.tsx` / `app/global-error.tsx` / `app/not-found.tsx`):**
- Issue: `find app -iname "error.tsx" -o -iname "not-found.tsx" -o -iname "global-error.tsx"` returns nothing. Only `loading.tsx` files exist (`app/(app)/loading.tsx`, `app/(app)/attendance/loading.tsx`, `app/(app)/calendar/loading.tsx`, `app/(app)/manager/loading.tsx`).
- Impact: any uncaught render-time exception in a Server Component (e.g. a Supabase query throwing instead of returning `{ error }`, a bad `searchParams` parse) falls through to Next's default unstyled error screen instead of a branded Vietnamese error state, and there is no custom 404 for typo'd routes.
- Fix approach: add `app/(app)/error.tsx` (client component boundary) and a root `app/not-found.tsx`.

## Silently-ignored query errors on data-fetching pages

- Issue: `app/(app)/calendar/page.tsx:38-82` runs 9 Supabase queries in `Promise.all` and destructures only `{ data }` from every one of them — `error` is never checked. If any query fails (e.g. an RLS policy regression, a dropped column, a network blip), the corresponding `data` is `null`, which every consumer coerces to an empty array (`(shifts as ShiftWithAssignee[]) ?? []` at `app/(app)/calendar/page.tsx:94`, similarly for `pendingSwaps`, `attendance`, `leaveRequests`, `customCalendars`, `customEvents`). The page renders a calendar that looks correctly empty rather than surfacing a failure.
- Files: `app/(app)/calendar/page.tsx:38-108`, `app/(app)/manager/page.tsx:69-115` (same pattern — 8 parallel queries, only `data` destructured, no `error` check anywhere in the file).
- Impact: a manager could see "0 người đang làm" or an empty swap/leave section not because there's genuinely nothing pending, but because a query silently failed — no error boundary, toast, or log will reveal it.
- Fix approach: destructure `error` alongside `data` for each query and either log server-side (`console.error`) or render a visible degraded-state banner when any of the 9/8 queries fail.

## Performance Bottlenecks

**Unbounded full-year / full-history queries on the manager dashboard:**
- `app/(app)/manager/page.tsx:99-103` fetches **every** attendance row since `startOfYear(new Date())` with no `.limit()`, for use only in client-side chart aggregation (`ManagerDashboard`/`TechnicalDashboard` via `recharts`). For a multi-branch operation running months into the year this becomes an ever-growing unbounded payload on every manager-dashboard page load.
- `app/(app)/manager/page.tsx:83` fetches **all** `shift_swap_requests` ever created (`.order("created_at", { ascending: false })`, no `.limit()`/pagination), and `app/(app)/manager/page.tsx:95-98` fetches **all** `leave_requests` ever created, both with a joined `profiles` row per record (Postgrest embed, not a manual N+1, but still an unbounded row scan+join).
- `app/(app)/manager/page.tsx:104-107` fetches all `shift_requests` ever created, same unbounded pattern.
- Impact: response time and memory for `/manager` grows linearly and unboundedly with organization age/size — no pagination, no date-window filter on swaps/leave/shift-request history (only the attendance query is at least bounded to "this year").
- Fix approach: add `.limit()` + status/date filters (e.g. only `pending` + last N days for the "resolved" ones) or move history views behind explicit pagination instead of loading total history on every dashboard visit.

**No `.limit()` on `custom_events` range query:**
- `app/(app)/calendar/page.tsx:77-81` filters `custom_events` by the visible calendar range (correct), but since a user could accumulate arbitrarily many personal events inside one visible week/month/agenda range (agenda view spans 30 days, `getVisibleRange` in `lib/calendar.ts:35`), there's no hard cap — low risk today given custom calendars are single-owner personal data, but worth flagging alongside the dashboard's unbounded queries.

## Fragile Areas

**`updateStaffBranchAction` / `updateStaffRoleAction` require a read-after-write workaround because RLS failures are silent:**
- Files: `actions/staff.ts:8-38` (branch) and `actions/staff.ts:40-67` (role).
- Why fragile: the code's own comment (`actions/staff.ts:18-24`) explains that a plain `.update().eq()` reports success even when the RLS policy blocks the write and zero rows match — so both actions have to `.select().maybeSingle()` the row back and manually compare `data.branch_id !== branchId` / `data.role !== role` to detect a no-op. This is a correct workaround, but it means every future manager-write action that doesn't replicate this exact "read back and diff" pattern is at risk of the same "silently didn't save" bug class (this exact failure mode was hit once already, per the comment: "chọn cơ sở xong nó lại tự về Chưa gán").
- Safe modification: any new `profiles`-mutating server action (or any table with row-level RLS write policies) must follow the same "select the row back and assert it changed" pattern, not a bare `.update()`.
- Test coverage: none — this exact regression class has no automated test guarding against a future RLS policy change silently breaking staff management.

**`shift_swap_requests` cancellation authority uses branch-scoping, not the newer role-group scoping introduced for other tables:**
- `supabase/migrations/0001_init.sql:340` (`cancel_swap_request`) authorizes any `is_manager()` (ceo/coo/training_director/technical) whose own branch matches the swap's `branch_id` to cancel it. `supabase/migrations/0013_group_scoped_visibility.sql` later introduced a finer-grained `can_view_profile()`/group model (coo → operations group only, training_director → training group only) for shifts/attendance/leave visibility and leave approval, but `cancel_swap_request` was never revisited to use it.
- Impact: a `training_director` can cancel a swap request between two `hr`/`customer_care` staff in their own branch (outside the training group) even though the equivalent leave-approval path (`respond_to_leave_request` in `supabase/migrations/0013_group_scoped_visibility.sql:63-91`) would block them from approving that same person's leave request. This is an inconsistency in how deep the 0013 group-scoping refactor was applied, not a full data leak (still branch-scoped, still `is_manager()`-gated).
- Fix approach: decide whether swap-request moderation should also become group-scoped and, if so, update `cancel_swap_request`/`respond_to_swap_request` in a new migration; if intentional, document why swaps stay branch-scoped while leave/shift-request approval is group-scoped.

**`CalendarSidebar.tsx` and `lib/calendar.ts` are the largest, most-central files with no tests:**
- `components/calendar/CalendarSidebar.tsx` is 512 lines, `lib/calendar.ts` is 484 lines (largest non-generated files in the repo per `wc -l`), both central to every calendar view (shift/attendance/leave/custom-calendar toggle state, color resolution, event-shaping for 4 different event kinds).
- Files: `components/calendar/CalendarSidebar.tsx`, `lib/calendar.ts`, `components/calendar/ShiftCalendar.tsx` (407 lines).
- Why fragile: `getPersonColorVar()` in `lib/calendar.ts:130-136` hashes a profile UUID into one of 13 palette swatches — any change to `AUTO_COLOR_VARS`/`EVENT_COLOR_SWATCHES` order changes everyone's auto-assigned color simultaneously with no migration/warning. `toAttendanceEvents()` (`lib/calendar.ts:265-338`) has nontrivial open/closed-session grouping and duration-summing logic with several date-arithmetic edge cases (in-progress sessions clamped to `now`, zero-duration fallback to 15 minutes) and zero test coverage.
- Safe modification: treat `lib/calendar.ts`'s event-shaping functions as the highest-value target for adding unit tests before further feature work touches them.

## Accessibility Gaps

- Only 15 of the `.tsx` files under `app/`+`components/` use any `aria-*` attribute (`grep -rl "aria-" app components --include="*.tsx" | wc -l` → 15), out of ~49 client components (`grep -rl '"use client"' app components hooks --include="*.tsx" --include="*.ts" | wc -l` → 49) — most interactive dialogs/dropdowns rely entirely on Radix UI's (`components/ui/*`) built-in ARIA wiring rather than any hand-authored labeling, which is reasonable for the primitives themselves but means custom composite widgets (e.g. `components/calendar/ColorPickerDialog.tsx`, `components/calendar/CalendarSidebar.tsx`) were not separately audited for labeling — no `alt`-less `<img>` tags were found, so image accessibility itself is not a concern.

## Security Considerations

**Service-role key usage is correctly isolated but centrally load-bearing:**
- `lib/supabase/admin.ts:1-5` creates a single `supabaseAdmin` client using `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS entirely). It is imported in exactly one place, `lib/auth.ts:4`, used only inside `ensureProfile()` (`lib/auth.ts:14-32`) to self-heal a missing `profiles` row for a just-authenticated user. No client (`"use client"`) component imports `lib/supabase/admin.ts`, `lib/supabase/server.ts`, or `lib/auth.ts` (verified — zero matches across all 49 `"use client"` files), so the service-role key cannot leak into the browser bundle via a bad import.
- `SUPABASE_SERVICE_ROLE_KEY` is listed (empty) in `.env.sample:3` and `.env*` is fully gitignored (`.gitignore:34`), so no key material is committed.
- Residual risk: `ensureProfile()` runs on every unauthenticated-but-session-present request until a profile row exists, using the admin client's full bypass privileges for an `upsert` + `select` on `profiles` — scoped narrowly enough (keyed to `user.id` from a verified Supabase session) that this is low risk, but it is the one place in the app where an RLS-bypassing client executes on a hot path, worth keeping an eye on if `ensureProfile()` is ever extended to touch more tables.

**`respond_to_shift_request` / `respond_to_leave_request` re-check `status = 'pending'` for concurrency but not every RPC does:**
- `supabase/migrations/0011_fix_status_case_cast.sql:24-25` and `:48-51` guard against double-approval via `where ... and status = 'pending'` / `select ... for update`. Consistent with the swap RPCs' `for update` row locks in `supabase/migrations/0001_init.sql:281`. No inconsistency found here on inspection — noted as verified-safe rather than a concern.

---

*Concerns audit: 2026-08-04*
