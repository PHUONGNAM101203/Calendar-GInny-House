# Giải trình công (attendance correction request) — design

Date: 2026-08-06
Status: approved for planning

## 1. Context

Employees clock in via `ClockWidget` (`components/attendance/ClockWidget.tsx`), which calls
`clock_in()`/`clock_out()` RPCs. There is no way today to fix a missed or late check-in after
the fact — the `attendance` row is either created correctly at clock-in time or not at all.

This feature lets an employee submit a "Giải trình công" (attendance explanation) request when
they forgot to check in, or checked in later than their assigned shift's start time. The request
goes to whoever is allowed to approve their leave requests today (their group manager, or CEO);
whoever acts on it first wins. On approval, the system automatically corrects the check-in time
— the employee never gets to type an arbitrary correction time, only the shift's own start time.

## 2. Non-goals

- **Check-out corrections.** Per the user: check-out is planned to be handled by a separate,
  not-yet-built "auto checkout at registered shift end time" mechanism. This feature only ever
  touches `check_in_at`.
- **A lateness grace threshold.** Any check-in after the shift's `start_at`, even by one minute,
  is eligible — no minimum-lateness cutoff.
- **A notifications table, email, or push.** Follows the exact existing pattern in
  `lib/notifications.ts`: computed fresh from live rows on every page load, no persistence, no
  delivery channel beyond the in-app bell. A user who doesn't open the app within 3 days of
  resolution simply never sees that particular notification — this is how leave/swap/shift-request
  notifications already behave, and this feature inherits the same limitation deliberately (not a
  gap to fix here).
- **Changing `attendance.shift_id` wiring.** `ClockWidget` still never passes a `shift_id` at
  clock-in time; this feature works around that by matching shift ↔ attendance by calendar date
  (Asia/Ho_Chi_Minh) instead of by foreign key, and does not change clock-in behavior.
- **Custom approver rules.** Reuses `is_leave_approver()` / `can_view_profile()` /
  `canApproveLeaveFor()` exactly as they exist today for leave requests. COO / GĐ Đào Tạo / HR can
  submit their own correction requests same as anyone else; since none of the three group-approval
  branches in `canApproveLeaveFor` match when the *target* role is `coo`/`training_director`/`hr`,
  only `ceo` can approve those — this falls out of the existing function unchanged, no special-casing
  needed.

## 3. Data model

New table, new enums, migration numbered after the current head (`0025` — confirm actual next
number at implementation time, since another in-progress branch may have claimed a number since
this spec was written; see the collision note left in commit `aeee686`).

```sql
create type public.attendance_correction_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.attendance_correction_issue as enum ('missed_check_in', 'late_check_in');

create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  attendance_id uuid references public.attendance(id) on delete set null,
  issue_type public.attendance_correction_issue not null,
  actual_check_in_at timestamptz,           -- snapshot of the wrong check-in time; null for missed_check_in
  requested_check_in_at timestamptz not null, -- always shift.start_at at submission time, never user-entered
  reason text not null,
  status public.attendance_correction_status not null default 'pending',
  responder_id uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index attendance_corrections_profile_idx on public.attendance_corrections (profile_id, created_at desc);
create unique index attendance_corrections_one_pending_per_shift
  on public.attendance_corrections (shift_id) where status = 'pending';

alter table public.attendance_corrections enable row level security;
```

**RLS (mirrors `leave_requests` exactly — see `0004_leave_requests.sql`/`0013_group_scoped_visibility.sql`):**

```sql
create policy attendance_corrections_select on public.attendance_corrections
  for select to authenticated
  using (profile_id = auth.uid() or public.can_view_profile(profile_id));
```
No insert/update/delete policies — all writes go through the `security definer` RPCs below, same as
`attendance` and `leave_requests` today.

## 4. RPCs

### `request_attendance_correction(p_shift_id uuid, p_reason text) returns attendance_corrections`

```sql
create or replace function public.request_attendance_correction(p_shift_id uuid, p_reason text)
returns public.attendance_corrections
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_shift_date date;
  v_attendance public.attendance%rowtype;
  v_issue public.attendance_correction_issue;
  v_row public.attendance_corrections%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'Vui lòng nhập lý do giải trình' using errcode = '23514';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id;
  if v_shift is null or v_shift.assignee_id <> v_uid then
    raise exception 'Không tìm thấy ca làm việc này';
  end if;

  v_shift_date := (v_shift.start_at at time zone 'Asia/Ho_Chi_Minh')::date;
  if (now() at time zone 'Asia/Ho_Chi_Minh')::date - v_shift_date > 2 then
    raise exception 'Đã quá hạn 2 ngày để giải trình ca này';
  end if;

  -- Match by calendar date, not attendance.shift_id (see spec §2 non-goals) — most
  -- recent check-in on the same local day as the shift.
  select * into v_attendance from public.attendance
  where profile_id = v_uid
    and (check_in_at at time zone 'Asia/Ho_Chi_Minh')::date = v_shift_date
  order by check_in_at desc
  limit 1;

  if v_attendance is null then
    v_issue := 'missed_check_in';
  elsif v_attendance.check_in_at > v_shift.start_at then
    v_issue := 'late_check_in';
  else
    raise exception 'Ca này không có sai lệch cần giải trình';
  end if;

  insert into public.attendance_corrections
    (profile_id, shift_id, attendance_id, issue_type, actual_check_in_at, requested_check_in_at, reason)
  values (
    v_uid, p_shift_id,
    case when v_issue = 'late_check_in' then v_attendance.id else null end,
    v_issue,
    case when v_issue = 'late_check_in' then v_attendance.check_in_at else null end,
    v_shift.start_at,
    p_reason
  )
  returning * into v_row;

  return v_row;
exception
  when unique_violation then
    raise exception 'Ca này đã có đơn giải trình đang chờ duyệt';
end;
$$;
```

### `respond_to_attendance_correction(p_id uuid, p_approve boolean) returns attendance_corrections`

Same shape as `respond_to_leave_request` (`0013_group_scoped_visibility.sql`): auth check,
`is_leave_approver()` guard, `can_view_profile(profile_id)` per-row authorization, atomic
`update ... where status = 'pending'` for the race (whoever's UPDATE lands first wins, the other
gets `not found` → "đã được xử lý"). On approval, applies the correction:

```sql
create or replace function public.respond_to_attendance_correction(p_id uuid, p_approve boolean)
returns public.attendance_corrections
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.attendance_corrections%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if not public.is_leave_approver() then
    raise exception 'Chỉ quản lý mới được duyệt đơn giải trình công';
  end if;

  select * into v_row from public.attendance_corrections where id = p_id;
  if v_row is null or not public.can_view_profile(v_row.profile_id) then
    raise exception 'Bạn không có quyền duyệt đơn của nhân viên này';
  end if;

  update public.attendance_corrections
  set status = (case when p_approve then 'approved' else 'rejected' end)::attendance_correction_status,
      responder_id = v_uid,
      resolved_at = now()
  where id = p_id and status = 'pending'
  returning * into v_row;

  if not found then
    raise exception 'Đơn giải trình công không hợp lệ hoặc đã được xử lý';
  end if;

  if p_approve then
    if v_row.issue_type = 'missed_check_in' then
      insert into public.attendance (profile_id, branch_id, shift_id, check_in_at)
      select v_row.profile_id, s.branch_id, s.id, v_row.requested_check_in_at
      from public.shifts s where s.id = v_row.shift_id;
    else
      update public.attendance
      set check_in_at = v_row.requested_check_in_at
      where id = v_row.attendance_id;
    end if;
  end if;

  return v_row;
end;
$$;
```

### `cancel_attendance_correction(p_id uuid) returns void`

Mirrors `cancel_leave_request`: `where id = p_id and status = 'pending' and (profile_id = v_uid or is_leave_approver())`.

## 5. Actions (`actions/attendance-corrections.ts`, new file)

Follows `actions/leave.ts` exactly:

- `requestAttendanceCorrectionAction(input: unknown)` — Zod-validated (`shift_id`, `reason`), `requireProfile()`, `supabase.rpc("request_attendance_correction", ...)`, `mapAttendanceCorrectionError`, `revalidatePath("/attendance/explain")` + `revalidatePath("/manager")`.
- `respondToAttendanceCorrectionAction(id, approve)` — same pattern.
- `cancelAttendanceCorrectionAction(id)` — same pattern.
- `getAttendanceCorrectionPreviewAction(dateStr: string)` — **the one deliberate exception to
  "actions only mutate."** A client-triggered read: given a date picked in the submit form, looks
  up (a) the caller's shift on that local date, (b) their attendance row on that date, and returns
  a discriminated preview: `{ ok: true, data: { kind: "no_shift" } }` /
  `{ kind: "no_discrepancy" }` / `{ kind: "missed_check_in", shift }` /
  `{ kind: "late_check_in", shift, actualCheckInAt } }`. Needed because the "hệ thống tự hiện giờ
  cần sửa" preview must react to an arbitrary client-picked date with no page navigation — there is
  no other established idiom in this codebase for a client-driven ad hoc read (no API routes, no
  client-side Supabase query pattern for this kind of lookup), so a read-only Server Action is the
  narrowest fit. Still validates the date with Zod and calls `requireProfile()` like every other
  action.

`mapAttendanceCorrectionError`: substring-matches the Vietnamese RPC messages above
(`"Không tìm thấy ca làm việc"`, `"Đã quá hạn 2 ngày"`, `"không có sai lệch"`, `"đã có đơn giải
trình"`, `"đã được xử lý"`, `"Chỉ quản lý mới"`, `"không có quyền duyệt"`), Vietnamese fallback.

## 6. Validation schema (`lib/validations/attendance-correction.ts`, new file)

```ts
export const attendanceCorrectionSchema = z.object({
  shift_id: z.uuid("Vui lòng chọn ca cần giải trình"),
  reason: z.string().trim().min(1, "Vui lòng nhập lý do giải trình").max(500, "Lý do tối đa 500 ký tự"),
});
export type AttendanceCorrectionInput = z.infer<typeof attendanceCorrectionSchema>;
```

## 7. Types (`types/index.ts` additions)

```ts
export type AttendanceCorrectionStatus = "pending" | "approved" | "rejected" | "cancelled";
export type AttendanceCorrectionIssue = "missed_check_in" | "late_check_in";

export type AttendanceCorrection = {
  id: string;
  profile_id: string;
  shift_id: string;
  attendance_id: string | null;
  issue_type: AttendanceCorrectionIssue;
  actual_check_in_at: string | null;
  requested_check_in_at: string;
  reason: string;
  status: AttendanceCorrectionStatus;
  responder_id: string | null;
  resolved_at: string | null;
  created_at: string;
};

export type AttendanceCorrectionDetailed = AttendanceCorrection & {
  profile: Pick<Profile, "id" | "full_name" | "role">;
  shift: Pick<Shift, "id" | "start_at" | "end_at">;
};
```

## 8. UI

### `app/(app)/attendance/explain/page.tsx` (new route, server component)

Mirrors `app/(app)/attendance/page.tsx` and `app/(app)/leave/page.tsx`'s shape: `requireProfile()`,
fetch the caller's own `attendance_corrections` history (`profile_id = auth.uid()`, newest first,
joined with `shift`), render:
1. A short intro paragraph (what this page is for).
2. `AttendanceCorrectionDialog` (or an inline form — small enough to not need a modal; final call
   left to the implementer following whichever of `LeaveRequestDialog`'s modal pattern vs. an
   inline card reads better once the date-preview interaction is actually built) — date picker →
   calls `getAttendanceCorrectionPreviewAction` on change → renders the preview state (no shift /
   no discrepancy / "Ca 8h–11h, bạn chấm công lúc 9h00" / "Bạn chưa chấm công ngày này") → reason
   textarea → submit, disabled until a correctable preview is loaded.
3. `Section "Lịch sử giải trình của tôi"` — list of `AttendanceCorrectionCard` (new component,
   mirrors `LeaveRequestCard`: status badge, shift date/time, issue type label, reason, cancel
   button while pending).

Add a link to `/attendance/explain` from `app/(app)/attendance/page.tsx`'s header (small text
link, e.g. "Quên chấm công hoặc chấm công trễ? Gửi giải trình →") — the two pages stay separate
routes per your choice, but need to be discoverable from each other.

### `app/(app)/manager/page.tsx` — new Section

```tsx
<Section title="Giải trình công" count={scopedAttendanceCorrections.length}>
  {/* same empty-state / grid-of-cards / canRespond shape as the "Nghỉ phép" section,
      canRespond = status === "pending" && isLeaveApprover(manager.role) && canApproveLeaveFor(manager.role, r.profile.role) */}
</Section>
```

Fetched and scoped in the same `Promise.all` + `groupRoles` filter this page already uses (added
by the manager-dashboard-group-scope work just shipped) — one more list alongside
`leavesList`/`scopedLeaves`, filtered the same way.

### Notifications (`lib/notifications.ts`)

`buildNotifications()` gains one more input array (`attendanceCorrections`), classified with the
same "pending → needs your action" / "resolved within 3 days → FYI" logic already applied to
`leaves`. `app/(app)/layout.tsx` fetches this array alongside the existing three, same `.limit(15)`
pattern.

## 9. Testing / verification plan

No test suite exists in this repo. Manual verification:
- `tsc --noEmit` / `npm run lint` clean.
- Apply migration locally, seed a shift + a late/missing check-in for a test profile, submit a
  correction, approve it as the appropriate group manager and separately as CEO to confirm the
  race guard (`status = 'pending'` atomic update) — second responder gets the "đã được xử lý"
  error.
- Confirm the 2-day window rejects a correction request for a shift older than 2 days.
- Confirm `missed_check_in` approval creates a new `attendance` row with `check_in_at =
  shift.start_at` and `check_out_at` left null (checkout remains someone else's problem per §2).
- Confirm `late_check_in` approval updates the existing `attendance.check_in_at` in place.
- Confirm COO/GĐ Đào Tạo/HR submitting their own correction is only actionable by `ceo` (matches
  `canApproveLeaveFor` today), not by a peer in the same role.
