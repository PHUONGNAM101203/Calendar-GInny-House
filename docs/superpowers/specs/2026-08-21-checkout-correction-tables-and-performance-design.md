# Check-out Correction, Dashboard Table Changes & Performance — Design

**Date:** 2026-08-21
**Status:** Approved (design), pending implementation plan

## Context

Four changes requested together. They are independent in intent but overlap in
the files they touch, so they ship as one sequenced piece of work.

1. **Giải trình công for check-out.** Today `attendance_corrections` only ever
   corrects `attendance.check_in_at` — migration `0026_attendance_corrections.sql`
   states check-out correction is explicitly out of scope, citing
   `2026-08-06-attendance-correction-design.md` §2. Staff need to correct their
   check-out time too, and unlike check-in (where the corrected time is always
   forced to the shift's `start_at`) the check-out time must be **user-chosen
   freely**: someone who clocked out at 19:40 may legitimately need the record to
   read 19:20.
2. **Free-typed time inputs.** The existing `TimePickerField` offers only
   15-minute marks, so the user's own example (19:20) is not even selectable.
   The requested fix applies beyond corrections: shift registration and the
   direct attendance edit on the calendar should also accept typed times.
3. **Dashboard table changes.** The "Ca làm việc" table should be visible only
   to the Kỹ thuật role; the "Tổng hợp chấm công" table needs a
   total-registered-shift-hours column surfaced at row level.
4. **Performance.** The user upgraded to Vercel Pro and Supabase Pro and wants
   the app materially faster — constrained to changes that incur **no additional
   cost** and that **keep the current deployment region**.

## Decisions Already Settled

| Question | Decision |
|---|---|
| Check-out correction scope | Both: adjust an existing check-out time **and** supply a missing one |
| Time input precision | Free typing to the minute, **with** the dropdown retained alongside |
| Where the new time input applies | Globally — upgrade the shared component so shift registration and calendar attendance editing get it too |
| Validation on the chosen time | Basic guards only: after check-in, not in the future, same day as the shift. Manager approval remains the real gate |
| "Ca làm việc" visibility | Kỹ thuật **only** — also hidden from COO, Giám Đốc Đào Tạo and HR, not just CEO |
| Period tabs (Ngày/Tháng/Năm) | Become load-on-demand instead of preloading a full year |
| Performance scope | Free-of-charge changes only; no paid features |
| Deployment region | **Changed 2026-08-21 (reversal of an earlier decision):** pin Vercel functions to `hnd1` (Tokyo) to co-locate with the Supabase database. See "Region" below |

---

## Part 1 — Check-out Correction

### Approach

Extend the existing `attendance_corrections` table rather than build a parallel
system. The lifecycle (`status`/`responder_id`/`resolved_at`), both RLS policies,
the approval authority model (`is_leave_approver()` + `can_view_profile()`), the
batch submit action, push notifications, and `AttendanceCorrectionCard` are all
reusable as-is.

**The existing check-in path must not change behaviour.** New columns are
additive; the existing `request_attendance_correction` RPC is not modified.

### Schema

Add to `attendance_corrections`:

- `actual_check_out_at timestamptz` — the check-out on record when the request
  was filed; `NULL` when there was none.
- `requested_check_out_at timestamptz` — the user's freely-chosen time.
- A `kind` discriminator resolving to `check_in` | `check_out`. Prefer a
  **generated column** derived from `issue_type` so it cannot drift; fall back to
  a plain column set by the RPCs if the generated expression proves awkward.

Extend the `attendance_correction_issue` enum with `missed_check_out` and
`adjust_check_out`.

> **Migration sequencing constraint:** `ALTER TYPE … ADD VALUE` must land in its
> own migration that commits *before* any migration referencing the new values.
> This is two migrations, not one.

`requested_check_in_at` is currently `NOT NULL`, which check-out rows cannot
satisfy. Drop that constraint and replace it with a CHECK asserting the correct
column is populated for each kind. The CHECK must be written against
`issue_type` directly, **not** against the generated `kind` column — PostgreSQL
disallows referencing a generated column from a CHECK constraint on the same
table.

**Constraint change (blocker if missed):** the partial unique index
`attendance_corrections_one_pending_per_shift` is unique on `shift_id` alone,
so a pending check-in correction would block filing a check-out correction for
the same shift. It becomes unique on `(shift_id, kind)`.

### RPCs

- **New** `request_attendance_correction_checkout(p_shift_id, p_requested_check_out_at, p_reason)`.
  Mirrors the existing request RPC's guards (authenticated, shift belongs to
  caller, within the 7-day window per `0042`, non-empty reason) plus the
  agreed time guards. Derives `missed_check_out` vs `adjust_check_out` from
  whether a check-out exists.
  **Requires an existing attendance row** — with no check-in there is no session
  to close, so it raises a Vietnamese error directing the user to correct their
  check-in first.
- **Modify** `respond_to_attendance_correction` — add a `check_out` branch
  writing `attendance.check_out_at`. Existing check-in branches untouched.
- **Modify** `revert_attendance_correction` — its `check_out_at is not null`
  guard unconditionally refuses any row with a check-out, which is always true
  for an approved check-out correction. Make the guard kind-aware and add a
  branch restoring `actual_check_out_at` (or clearing it when there was none).

### Application layer

- `types/index.ts` — extend the issue union, add the new fields and `kind`.
- `lib/constants.ts` — `ATTENDANCE_CORRECTION_ISSUE_LABELS` is an exhaustive
  `Record`, so it fails to compile until the two new labels are added. This is a
  deliberate safety net; the same applies to `ISSUE_ICON` in
  `AttendanceCorrectionCard.tsx`.
- `lib/validations/attendance-correction.ts` — a check-out schema carrying the
  chosen time, with cross-field `.refine()` rules for the agreed guards and
  Vietnamese messages.
- `actions/attendance-corrections.ts` — a new request action; extend the
  `CorrectionPreview` union with check-out variants.
  **`mapAttendanceCorrectionError` is a whitelist** — every new SQL error string
  must be added there or it silently collapses to the generic fallback.
  `getAttendanceCorrectionPreviewAction` duplicates the RPC's discrepancy
  detection in TypeScript; both sides need the check-out branch.
- `components/attendance/AttendanceCorrectionForm.tsx` — the user picks what to
  correct (giờ vào / giờ ra). Choosing giờ ra reveals the time input,
  pre-filled with the recorded check-out (or the shift's end time when absent).
  Preview copy is currently hardcoded check-in language and needs check-out
  variants.
- `lib/calendar.ts` — `pendingCorrectionsByShiftId` assumes at most one pending
  correction per shift (comment at its definition says so explicitly). It becomes
  one-to-many, as does the single-correction shape in `AttendanceDetailDialog`.

---

## Part 2 — Free-Typed Time Input

Upgrade `components/ui/time-picker-field.tsx` in place: accept typed input at
minute precision while keeping the existing dropdown of 15-minute marks. The
public prop contract (`value` as `"HH:mm"`, `onChange`) stays identical, so every
current consumer benefits with no call-site changes:

`ShiftFormDialog`, `ShiftRequestDialog`, `AttendanceDetailDialog` (the Vào/Ra
manual edit), `CreateAttendanceManualDialog`, `LeaveRequestDialog`,
`CustomEventFormDialog`.

Typed input normalises on blur and rejects invalid values rather than silently
coercing. The component's existing wheel/touch scroll workaround for Radix's
modal scroll-lock must survive the change.

---

## Part 3 — Dashboard Tables

### "Ca làm việc" → Kỹ thuật only

Rendered from exactly one call site, in the page-level `Section` wrapper in
`app/(app)/manager/page.tsx`. Wrap that section in the page's existing
`isTechnical` flag. The component import must stay — the shared `ShiftOverviewRow`
type is exported from that file and used across several components.

### "Tổng hợp chấm công" → new registered-hours column

Add a total-registered-shift-hours column beside "Giờ làm", in the same
`41g 37p` format. Row-click through to the per-person detail dialog is unchanged.

The shift data is **already passed** to this table (it currently only forwards it
to the dialog), so no new query and no new props are required.

Two correctness notes:

- The empty-state `colSpan` must go from 5 to 6.
- The detail dialog and `buildStaffOverview` compute shift minutes
  **differently** — the dialog sums raw `end_at - start_at` for shifts starting
  within the period, while `buildStaffOverview` clips to the period boundary. The
  new column must match **the dialog**, so the row total and the popup total
  always agree.

`formatHours` is currently duplicated verbatim in two components. Extract it and
the shift-minutes computation into `lib/attendance.ts` rather than adding a third
copy.

---

## Part 4 — Performance

Constraints: no cost increase, no region change, no visual redesign.

### Measured problems and fixes

| Problem | Fix |
|---|---|
| `/manager` fetches a **full year** of attendance to render a 7-day chart and a day-scoped table; the rows are serialised to the browser and discarded | Fetch only the period being viewed; period tabs become server-driven with a smooth pending state |

**Period-tab specifics.** Each table keeps its **own independent** period
selector — switching "Tổng hợp chấm công" to Tháng must not move "Ca làm việc"
— so each gets its own URL search param and the server derives a fetch window
per table. Current defaults are preserved (Tổng hợp chấm công = Ngày,
Ca làm việc = Tháng). Two constraints the plan must respect: the 7-day
activity chart always needs at least 7 days of attendance regardless of the
selected period, and the new registered-hours column must be scoped to the
*same* period as the attendance table it sits in.

| `attendance` is filtered by `check_in_at` with no leading indexed column → **sequential scan of the whole table** on every `/manager` and `/calendar` load | Add `attendance (check_in_at desc)` |
| `shifts` global `ORDER BY start_at DESC LIMIT 500` → **full scan + top-N sort** | Add `shifts (start_at desc)` |
| Four more hot predicates unindexed: `leave_requests` date range, `custom_events` date overlap, `shift_swap_requests (status, created_at)`, `attendance_corrections (status, created_at)` | Add the four indexes |
| `getGroupPermissions()` runs **twice per page** (layout + page) and is awaited **serially before** the parallel batch on three pages | Memoise with React `cache()` and move the call into the existing `Promise.all` |
| Four queries pull **entire unbounded history** (swaps, leave, shift requests, corrections) largely to compute pending counts | Push status filters into SQL; add limits and date floors |
| Nine JS `scoped*` filters discard rows the viewer may not see, after fetching them | Express as SQL predicates |
| `recharts` (~300KB) statically imported though charts sit below the fold | Dynamic import, following the existing `react-big-calendar` precedent |
| RLS helper functions re-evaluate `auth.uid()` **per candidate row** | Wrap as `(select auth.uid())` — standard Supabase guidance |
| `CalendarSidebar` (807 lines) has zero `useMemo` and re-derives every list on each render of its 917-line parent | Memoise derived lists |

### Region

Measured on 2026-08-21: `x-vercel-id: hkg1::iad1::…` — requests enter at the
Hong Kong edge but functions execute in **`iad1` (Washington DC)**, while the
Supabase database is in **`ap-northeast-1` (Tokyo)**. Every dynamic page render
therefore crosses the Pacific 15–18 times.

**Decision: pin functions to `hnd1` (Tokyo)** via `"regions": ["hnd1"]` in
`vercel.json`.

The counter-intuitive part, recorded so it is not "corrected" later by someone
optimising for the wrong hop: the function belongs next to the **database**, not
next to the user. One page load is *one* user round-trip but *15–18* database
round-trips, so Singapore (physically closest to Vietnam) would be **slower**
than Tokyo while the database stays in Tokyo. Static assets are unaffected —
they are already served from the Hong Kong edge and remain so.

Rejected: migrating the Supabase project to Singapore to shave the remaining
user hop (~80ms → ~30ms). Supabase has no in-place region move; it requires a
new project, a backup restore, new URL and keys, and downtime on a live system
carrying real staff data. Not worth ~50ms.

### Explicitly out of scope

- **No Cache Components / PPR.** Next 16's `cacheComponents` flag would give both
  heavy pages an instant static shell, but it is a broad behavioural change
  requiring route-by-route verification. Deferred by choice.
- **No paid features** — no Speed Insights, no larger compute, no read replicas.
- `lib/branches.ts` uses `unstable_cache`, which Next 16 documents as replaced by
  `use cache`. Left alone since migrating it properly depends on Cache Components.

### Risk note

The RLS rewrite touches the authorization boundary. Migration `0069`'s header
documents a prior incident where widening visibility leaked into unrelated
features. These changes are performance-only and must be **semantically
identical** role by role — `(select auth.uid())` and dropping a redundant
`OR` branch that is already unconditionally true. Any change that alters *who
sees what* belongs to a different piece of work.

---

## Verification

No test suite exists in this project, so every phase is verified by
`tsc --noEmit`, `eslint`, and manual exercise against the dev server.

Per phase:

1. **Time input** — type `19:20` and `19:47` in shift registration, the calendar's
   attendance edit, and the correction form; confirm the dropdown still works and
   invalid input is rejected.
2. **Check-out correction** — file both a missed and an adjusted check-out;
   approve one and confirm `attendance.check_out_at` matches the requested time;
   reject one; revert an approved one as Kỹ thuật; confirm a check-in and a
   check-out correction can be pending on the same shift simultaneously; confirm
   a shift with no check-in is refused with the intended message.
3. **Tables** — confirm "Ca làm việc" is gone for CEO/COO/GĐĐT/HR and present for
   Kỹ thuật; confirm the new column's total equals the popup's total for the same
   person and period.
4. **Performance** — compare `/manager` and `/calendar` load before and after;
   confirm each role still sees exactly the same rows as before (the RLS and
   SQL-filter changes are the risk surface).

Migrations are applied to the linked Supabase project with `supabase db push`.
