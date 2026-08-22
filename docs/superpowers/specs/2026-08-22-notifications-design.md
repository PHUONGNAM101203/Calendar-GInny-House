# Thông báo cho nhân viên — Design

**Date:** 2026-08-22
**Status:** Approved

## Context

The owner's request: non-manager staff should see notifications about anything
concerning them personally — *"quên chấm công, chưa check out, quá giờ, được
duyệt, ca được tạo dành cho bạn, và tất cả thông báo liên quan đến mình"*.

Today they see almost none of that. An audit found:

**A plain staff member receives exactly five kinds of bell notification**, all of
the form "your request was resolved": swap targeted at them, their swap
resolved, their leave resolved, their shift-request resolved, their correction
resolved. Nothing about shifts or attendance.

**Three specific gaps match the request exactly:**

| Event | Who is told today |
|---|---|
| Quên chấm công | `role = 'technical'` only, by push |
| Chưa check out / quá giờ | `role = 'technical'` only, by push |
| Ca được tạo dành cho bạn | **Nobody, on any channel** — the feature does not exist |

The two cron detectors already return the offending staff member's `profile_id`
and `full_name`, then discard them and send only an aggregate digest to
technical.

**And a long tail emits nothing at all:** a shift assigned to you being edited or
deleted, a manager editing your attendance by hand, your correction being
reverted or deleted, your role or branch changing, your account being
deactivated.

### Why push alone will not fix this

Push is a manual, per-device opt-in whose only entry point is the last item
inside the notification bell's dropdown. There is no prompt, onboarding step or
nag anywhere, and the component hides itself entirely on browsers without
`serviceWorker` + `PushManager`. Realistic adoption among non-technical staff is
near zero.

So adding "also push to the staff member" would satisfy the letter of the
request and change nothing in practice. **The bell is what people actually
look at** — and the bell cannot express these events, because
`buildNotifications()` derives its output from four request tables and never
receives `shifts` or `attendance` at all.

## Decision

**Introduce a real `notifications` table.** Chosen over feeding two more tables
into the derived builder, because derivation structurally cannot represent an
event whose evidence is gone: a deleted shift, a reverted correction, a role
change. Those leave nothing behind to derive from. A stored row also gives
per-notification read state and durable history, instead of the current
three-day window computed from `resolved_at`.

## Phase A — the table, and the three requested gaps

### Schema (migration `0077`)

`notifications`:

- `id`, `profile_id` (not null → `profiles`, the recipient), `created_at`
- `kind` — a text discriminator (`shift_assigned`, `shift_updated`,
  `shift_deleted`, `missed_check_in`, `stale_check_out`, …)
- `title` / `body` — Vietnamese, composed at write time. Stored rather than
  derived so a notification still reads correctly after the thing it describes
  is gone.
- `url` — where clicking navigates
- `related_id` — the shift/attendance/request row it concerns, for navigation
  and de-duplication
- `read_at` — nullable

RLS: a staff member may select and mark-read **only their own rows**
(`profile_id = auth.uid()`). No client insert path — rows are written by
`security definer` RPCs or the service-role client, the pattern
`push_subscriptions` already uses.

Index on `(profile_id, created_at desc)` — the only access pattern.

### Emission points

| Event | Recipient | Source |
|---|---|---|
| Ca được tạo dành cho bạn | assignee | `createShiftAction` |
| Ca của bạn bị đổi giờ / cơ sở | assignee — **and the previous assignee** when reassigned | `updateShiftAction` |
| Ca của bạn bị xoá | assignee | `deleteShiftAction` |
| Quên chấm công | the staff member | `attendance-reminders` cron |
| Chưa chấm công ra | the staff member | `attendance-reminders` cron |

The cron keeps its aggregate digest to technical — that is oversight, and
removing it would take away a working tool. It gains a per-person notification
alongside.

**De-duplication is already solved** for the two cron events:
`find_late_checkin_shifts` and `find_stale_checkout_sessions` filter on
`late_checkin_notified_at is null` / `stale_checkout_notified_at is null`, and
the route stamps those columns after sending, so each shift or session fires
once. Reuse that; do not add a second mechanism.

Each emission also sends a push, so the minority who did subscribe get both.

### The bell

`buildNotifications()` keeps working exactly as it does. The layout also reads
the recipient's own `notifications` rows and merges them into the same
`AppNotification[]` shape before the existing sort-and-take-10. Two sources
briefly, one shape.

Badge counting is unchanged — `notifications_seen_at` compared against each
item's timestamp works for both sources, so Phase A does not touch it.

### One small fix worth folding in

`hr` is excluded from the pending-leave and pending-correction branches of
`buildNotifications()` because they gate on `isManagerRole`, which covers only
ceo/coo/training_director/technical. But HR *is* a real approver for both. The
bell and the approval rights disagree; align them.

## Phase B — later

Move the four derived kinds into the table and retire `buildNotifications()`,
then add per-notification read state and the long tail (attendance edited by a
manager, correction reverted, role changed, deactivated). Deferred so Phase A
ships without touching notifications that work today.

## Out of scope

- Prompting or nagging staff to enable push. Worth doing, but a separate UX
  question.
- Email or Zalo delivery.
- Any change to who may *approve* anything. This is delivery only.

## Verification

No test suite; verified with `tsc --noEmit`, `eslint`, and manual exercise
against the deployed app — local browser automation cannot reach this app.

1. As a manager, create a shift for a staff member; sign in as that person and
   confirm the bell shows it.
2. Edit that shift's time, then reassign it to someone else; confirm both the
   old and new assignee are told.
3. Delete it; confirm the assignee is told.
4. Confirm a staff member who forgot to clock in receives a bell entry after the
   hourly cron, and that technical still receives its digest.
5. Confirm the cron does not re-notify the same shift on its next run.
6. Confirm a staff member sees **only their own** notifications — check directly
   against the database, not just the UI.
7. Confirm the five existing notification kinds still behave exactly as before.

Migrations are applied with `supabase db push`, which reaches the live database
directly — there is no staging copy.
