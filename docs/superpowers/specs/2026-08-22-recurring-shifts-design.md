# Ca cố định (Recurring Shifts) — Design

**Date:** 2026-08-22
**Status:** Phases 1–3 shipped (1 on 2026-08-22, 3 on 2026-08-23, 2 on
2026-08-24). Phase 4 (scoped edit) is the only one left.

> Phase 1 landed as migration `0078_shift_series.sql`, not `0077` — that number
> went to the notifications table in the same session. Everything else in the
> Phase 1 section below is as built.

## Context

Managers currently create shifts one day at a time. In practice a large part of
the roster is fixed — same person, same branch, same hours, every week — so the
same shift is re-entered by hand week after week. The request, verbatim:
*"Cái đăng ký lịch làm ấy, em cũng cho chị tick các ca cố định nhé — tuần nào
cũng zậy đó"*, and *"tới lúc xoá thì cũng được chọn xoá 1 event hay xoá cái này
trở về sau"*.

Refined by the owner: this lives in the **dashboard of quản lý / giám đốc /
kỹ thuật** as a create-update-edit-manage section. Staff do not create recurring
shifts. A series may run between two dates or have **no end**, and deleting or
editing one occurrence must offer a choice of scope.

## Decisions already settled

| Question | Decision |
|---|---|
| Who creates them | Managers, directors, technical only — not staff |
| Weekday selection | Multi-select as **pill toggle buttons** (Sun–Sat), not checkboxes, in the app's own font and colours. Paired with an "Every N week(s)" interval |
| Assignee | **Optional** — pick a person, or leave the slot empty to fill later |
| Unassigned slots | A **separate concept**, not a shift with an empty assignee (see below) |
| Indefinite series | Materialise **12 weeks** ahead, extended nightly by cron |
| Occurrence conflicts | **Skip that occurrence and report it**; create the rest |
| Delivery | **Phased**, deploying each phase |

## Why not a nullable assignee

`shifts.assignee_id` is `NOT NULL`, and that column is load-bearing in three
places: the RLS policies (`shifts_delete_manager` uses
`can_manage_shift_for(assignee_id)`, `shifts_select_branch` uses
`can_view_shift_calendar(assignee_id)`), the `shifts_no_overlap` GiST exclusion
constraint which is scoped per `assignee_id`, and every UI surface that reads
`shift.assignee.full_name`.

Making it nullable would weaken the overlap constraint (a NULL never conflicts),
force every query and policy to reason about the null case, and require every
consumer to guard a name read. One missed guard is a wrong-data bug, not a
crash — the worst kind.

An empty slot and a staffed shift are also different things in the business: one
is a plan, the other is an assignment. Phase 3 gives slots their own table and
renders them on the calendar as a distinct card type, which the calendar already
supports for six other kinds. Assigning a person converts the slot into a real
`shifts` row, at which point every existing rule applies unchanged.

## Phase 1 — assigned series, fixed date range, scoped delete

The useful core, shippable on its own.

### Schema (migration `0077`)

New table `shift_series`, holding the *rule*:

- `id`, `branch_id` (not null), `assignee_id` (not null in Phase 1),
  `shift_type`, `note`
- `weekdays` — the selected days, `0`=Sunday … `6`=Saturday
- `interval_weeks` — the "Every N weeks" value, default `1`
- `start_time` / `end_time` as `time`, plus the shift's own overnight rule
  (`end <= start` means it ends the next day, matching `ShiftFormDialog`'s
  existing behaviour)
- `starts_on` / `ends_on` as `date`; `ends_on` null is reserved for Phase 2
- `created_by`, `created_at`

And on `shifts`: `series_id uuid references shift_series(id) on delete set null`.
`SET NULL`, not `CASCADE` — deleting the rule must never silently delete
attendance-bearing history. Bulk removal is an explicit, guarded action.

### Materialisation

An RPC computes the occurrence dates from the rule and inserts one `shifts` row
each. For every candidate it first checks the two conditions that would make the
insert fail, and **skips rather than aborts**:

- an existing shift overlapping that assignee's range
- `student_affairs_slot_taken` — for `quản sinh`, only one person may hold a
  shift starting at a given time at a branch

It returns the created count plus the skipped dates and their reason, which the
UI lists back to the creator.

> **Why pre-check instead of catching the error:** `shifts_no_overlap` is
> `DEFERRABLE INITIALLY DEFERRED`, so a bulk insert fails at COMMIT as one error
> naming the constraint, with no way to attribute it to a date. Catching it would
> lose the whole batch and be unable to say which week clashed.

### Scoped delete

Deleting a shift that carries a `series_id` opens a dialog with the three
options the owner asked for:

1. **Chỉ xoá ca này** — the single row, exactly as today
2. **Xoá tất cả ca thuộc ca cố định này** — every occurrence of the series
3. **Xoá trong khoảng ngày** — occurrences between two chosen dates

**Occurrences that already have attendance recorded are never deleted**, in any
scope. `attendance.shift_id` is `ON DELETE SET NULL`, so deleting such a shift
would orphan a real clock-in and quietly corrupt the hours report. The RPC skips
them and reports how many it kept, so the manager can act on them deliberately.

`deleteShiftAction` currently issues a bare delete with no `count: "exact"`, so
an RLS-denied delete returns success and shows "Đã xoá" while nothing happened.
Tolerable for one row, dangerous for a bulk scope — Phase 1 fixes it. A sibling
action, `deleteShiftRequestAction`, already uses `count: "exact"` for exactly
this reason and is the pattern to follow.

### UI

A new dashboard section for quản lý / giám đốc / kỹ thuật, listing existing
series with their rule in plain Vietnamese ("Thứ 2, 4, 6 · 18:00–22:00 · Cơ sở
1 · Lý Mai Hương"), plus create and delete. The create form reuses
`TimePickerField`, `DatePickerField` and the branch/assignee selects from
`ShiftFormDialog`; the only new control is the weekday pill row.

## Phases 2–4

- **Phase 2 — "Không kết thúc". Shipped 2026-08-24** (`0083`,
  `/api/cron/shift-series-extend`, daily at 17:00 UTC = midnight Vietnam).
  `ends_on` null is now accepted; the occurrence loop moved out of
  `create_shift_series` into a shared `materialise_shift_series()` so creating
  and extending run one implementation. Two things to keep in mind if this is
  ever touched: the week counter anchors on `series.starts_on`, never on the
  window being filled (otherwise an "every 2 weeks" rule re-phases on each
  run), and progress lives in a new `shift_series.materialised_through` column
  rather than being derived from `max(shifts.start_at)` (derived, deleting the
  last occurrence would have the cron recreate it the next night).
  `extend_shift_series()` is granted to `service_role` only — it skips every
  per-user check, which it must, having no session.
- **Phase 3 — Unassigned slots. Shipped**; the table, actions and `/manager`
  section landed 2026-08-22, and the calendar card that was the whole point of
  giving slots their own table landed 2026-08-23. They render as the only
  outline card on the grid and open the assign dialog on click.
- **Phase 4 — Scoped edit.** The same three scopes as delete. Larger than it
  looks: editing "all" has to re-materialise future occurrences, re-run the
  conflict check, and leave occurrences that already have attendance alone.

## Out of scope

- Staff-initiated recurring registration. The owner was explicit that only
  management sets fixed schedules.
- Any change to how a single, non-recurring shift is created or approved.
- Monthly or day-of-month recurrence. Weekly with an interval covers the need.

## Verification

No test suite exists; each phase is verified with `tsc --noEmit`, `eslint`, and
manual exercise against the deployed app — local browser automation cannot reach
this app. Per phase:

1. Create a series over a fixed range; confirm the expected occurrences appear
   on `/calendar` for the right person, branch and hours.
2. Create one that deliberately clashes on a single week; confirm the other
   weeks are created and the clash is reported with its date and reason.
3. Delete with each of the three scopes; confirm exactly the intended rows go,
   that occurrences with attendance survive, and that the reported count matches
   what actually changed.
4. Confirm a non-manager sees no new controls anywhere.

Migrations are applied with `supabase db push`, which reaches the live database
directly — there is no staging copy.
