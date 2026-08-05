# Shift Type (Ca sáng/chiều/tối/remote) — Design

**Date:** 2026-08-05
**Status:** Approved (pending implementation)

## Problem

Shifts have no concept of "loại ca" (shift type). Staff need to register/be assigned
a shift type (morning/afternoon/evening/remote), auto-suggested from the time range
picked but still editable, and approvers need to see which shift type they're
approving, not just a time range.

## 1. Data Model

- New Postgres enum `shift_type` with values `morning | afternoon | evening | remote`.
- New column `shift_type` (not null, default `'morning'`) on both `shifts` and
  `shift_requests`.
- "Remote" is just an enum value — no special handling of `branch_id`. Every shift
  (including remote ones) still requires a branch, per the multi-branch design
  (`2026-08-05-multi-branch-staff-design.md`): remote work is still administratively
  under one branch.

## 2. Auto-Detection + Server Actions

- Boundaries (based on shift start time): `<12:00` → morning, `12:00–17:00` →
  afternoon, `≥17:00` → evening. New constants in `lib/constants.ts` alongside
  `CALENDAR_MIN_HOUR`/`CALENDAR_MAX_HOUR`.
- `ShiftFormDialog.tsx` and `ShiftRequestDialog.tsx`: a `shift_type` `<Select>` is
  added. Changing `startTime` auto-updates the selected value via the boundary rule
  above, but the field stays a normal, freely-editable dropdown — the user can
  override it (e.g. picking "Remote" regardless of what time bucket the hours fall
  into).
- `lib/validations/shift.ts` (`shiftSchema`) and `lib/validations/shift-request.ts`
  (`shiftRequestSchema`) both gain a required `shift_type` enum field. No
  cross-validation against the time range — the final dropdown value is trusted as-is
  since it's user-editable by design.
- `respond_to_shift_request` RPC (`supabase/migrations/0010_shift_requests.sql`) is
  updated to copy `shift_type` from the `shift_requests` row into the new `shifts`
  row on approval (currently doesn't copy it because the column doesn't exist yet).

## 3. Approval Display

- New `SHIFT_TYPE_LABELS` map in `lib/constants.ts` (Vietnamese labels: "Ca sáng",
  "Ca chiều", "Ca tối", "Ca remote"), following the existing
  `LEAVE_REQUEST_TYPE_LABELS` pattern.
- `components/shifts/ShiftRequestCard.tsx` gains a second `Badge` next to the status
  badge showing the shift type label, so approvers see e.g. "Ca sáng" / "Ca remote"
  alongside the time range, not just start/end time.

## 4. Calendar (optional, deferred)

A shift-type icon/badge on calendar event chips (`ShiftCalendar.tsx`) was discussed
but not committed to this spec — left as a follow-up, not blocking this feature.

## Risks / Open Items

- Both `shifts` and `shift_requests` need the new column + enum type in the same
  migration; the approval RPC must be updated in the same migration to avoid a
  window where approved requests silently default to `'morning'`.
