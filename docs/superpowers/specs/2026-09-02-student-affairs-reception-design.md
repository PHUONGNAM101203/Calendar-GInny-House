# Quản sinh kiêm lễ tân — Design

**Date:** 2026-09-02
**Status:** Approved

## Context

Quản sinh (`student_affairs`) must be able to cover the front desk as well.
Someone who is already quản sinh + trợ giảng then holds **three** roles, and
today's schema cannot express that: `profiles.secondary_role` is a single
column with exactly one valid value per primary role, and
`student_affairs → teaching_assistant` already occupies it.

Owner's rules, verbatim across three messages:

- *"lễ tân mà có role quản sinh thì sẽ phải chấm công theo ca đã đăng ký"*
- *"còn lại các trường hợp lễ tân gắn với role khác thì để ko chấm công như thường"*
- *"nếu ai có 3 role thì vẫn cho thả tự do chấm công nhưng nếu chấm công đúng
  lúc có ca thì sẽ đc chọn theo ca tùy là quản sinh hay lễ tân, còn trợ giảng
  thì nếu chấm công không có ca nào thì tự hiểu là đang chấm công trợ giảng"*
- *"kiểu quản sinh thì 1 người 1 ca 1 cơ sở, còn lễ tân thì vẫn đky được nữa"*

Production today: 20 profiles — 10 quản sinh (5 of them already kiêm trợ
giảng, the group that gains the third role) and 3 people with
`secondary_role = 'receptionist'` (2 CSKH, 1 HR).

## The history this design has to respect

`lib/roles.ts` carries an explicit warning: a per-shift duty model was built
for teaching assistants in `0052` and **reverted in `0055`** for being too
fragile around swaps. `0055`'s own comment reads *"a shift is always the
assignee's own role now."* Receptionist exemption has been person-level ever
since, deliberately.

This design re-introduces a per-shift role read, but narrowly: one nullable
column that a CHECK constraint permits to hold only `'receptionist'`, plus an
explicit rule for the swap case that broke `0052`. It is not a general
duty-role system, and must not become one.

## Decisions

| Question | Decision |
|---|---|
| How to hold 3 roles | Separate `covers_reception` boolean, not a third role column and not a join table |
| Attendance scope | Person-level. A quản sinh who covers reception clocks in for their shifts; free clock-in outside a shift stays trợ giảng |
| Missed-clock-in reminders | Yes, same as every other role — the receptionist exemption narrows to non-quản-sinh |
| Reception shift vs quản sinh slot | A reception shift does **not** consume the branch's quản sinh slot |
| Swapping a reception shift to someone who cannot cover reception | **Blocked**, with a plain-Vietnamese reason |

## Data model

### `profiles.covers_reception boolean not null default false`

Replaces `secondary_role = 'receptionist'` so there is exactly one way to say
"kiêm lễ tân". Migration sets the flag for the 3 existing rows and nulls their
`secondary_role`; the `profiles_secondary_role_valid_pair` CHECK drops its
customer_care/hr → receptionist arms and keeps teacher/student_affairs →
teaching_assistant.

A CHECK limits the flag to `student_affairs`, `customer_care`, `hr`. Teachers
and everyone else are out of scope.

`secondary_role` keeps its original meaning: kiêm nhiệm *chuyên môn*. Reception
is a duty, not a rung on the hierarchy, which is why it reads better as its own
capability — and why the codebase already treats it as an exception everywhere.

### `covering_role` on `shifts`, `shift_requests`, `shift_series`, `shift_slots`

- `null` — the shift belongs to the assignee's own primary role. Unchanged
  behaviour for everyone who does not cover reception.
- `'receptionist'` — a reception shift.

CHECK: `covering_role is null or covering_role = 'receptionist'`. The column is
nullable-role rather than boolean so `computeShiftKind` can read it directly,
and the CHECK is what stops it growing into the system `0055` removed.

`shift_series` / `shift_slots` are included so a recurring reception shift is
possible; leaving them out would ship half the feature.

## Rules

| Where | Change |
|---|---|
| `student_affairs_slot_taken` | Ignore rows whose `covering_role = 'receptionist'`, in both the shifts and shift_requests arms |
| `enforce_student_affairs_single_slot` | Skip when the new row is a reception shift |
| `respond_to_swap_request` | Reject when a reception shift would move to someone without `covers_reception` |
| Shift edit / reassign / slot assign | Same guard |
| `find_late_checkin_shifts`, `find_stale_checkout_sessions` | Exemption becomes `covers_reception AND role <> 'student_affairs'` |

`lib/roles.ts`: `isReceptionistExempt` reads the new flag and the primary role;
`SECONDARY_ROLE_BY_PRIMARY` loses its customer_care/hr entries; a new
`RECEPTION_ELIGIBLE_ROLES` set mirrors the CHECK; `getRoleLabel` renders
"Quản sinh · Trợ giảng · Lễ tân".

## UI

- **StaffTable** — a "Kiêm lễ tân" toggle independent of the existing kiêm
  nhiệm control, so a quản sinh can hold both.
- **Shift create / shift request / shift series forms** — a "Vai trò của ca"
  dropdown, rendered **only** when the chosen assignee covers reception, with
  the two options *Ca quản sinh* and *Ca lễ tân*.
- `computeShiftKind` reads the shift's `covering_role` first and falls back to
  today's derivation from the assignee.

## Attendance

Unchanged. A clock-in binds to an active shift if there is one, and is
shiftless (trợ giảng) otherwise — both already implemented. The role of an
attendance is read from its shift's `covering_role`; nothing new is stored on
`attendance`.

## Out of scope

- Reception for teacher or any role beyond the three named.
- A general per-shift duty-role system.
- Any change to who approves what.

## Verification

No test suite. Each step is checked with `tsc --noEmit`, `eslint`,
`npm run build`, and — because the risk here is in SQL — by exercising the RPCs
against production with disposable rows that are deleted afterwards, the way
migrations `0083` and `0084` were verified. Specifically:

1. A reception shift and another person's quản sinh shift in the same
   branch/slot both persist.
2. Two quản sinh shifts in the same branch/slot are still rejected.
3. Swapping a reception shift to someone without `covers_reception` is
   rejected with the intended message.
4. The missed-clock-in cron flags a quản sinh kiêm lễ tân and still skips a
   CSKH kiêm lễ tân.
5. The 3 migrated profiles keep their reception behaviour.

`supabase db push` reaches the live database directly; there is no staging copy.
