# Shift Duty Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, inline in this session (no worktree — this project doesn't use them). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a manager (or a dual-role staff member self-registering) mark which of their two roles a specific shift is for, and route the 3 request types tied to that shift (đăng ký ca, đổi ca, giải trình công) to the manager who owns that duty — not always the manager who owns the person's primary role.

**Architecture:** Two new nullable `duty_role` columns (`shifts`, `shift_requests`), each guarded by a self-healing/required-enforcing `BEFORE INSERT OR UPDATE` trigger. Existing TS approval predicates (`canApproveShiftRequestFor`/`canApproveSwapRequestFor`/`canApproveLeaveFor`) keep their exact signatures — only the *value* passed as `targetRole`/`requesterRole` changes at shift-tied call sites, via a new `effectiveRole(dutyRole, primaryRole)` helper. Their SQL mirrors gain one new *optional, defaulted* parameter each, so every existing caller that doesn't pass it keeps working unchanged.

**Tech Stack:** Next.js 16 Server Components/Actions, Supabase Postgres (RLS + `security definer` RPCs), Zod, react-hook-form.

## Global Constraints

- Only 3 request types change behavior: đăng ký ca (`shift_requests`), đổi ca (`shift_swap_requests`), giải trình công (`attendance_corrections`). Đơn nghỉ phép (`leave_requests`) is untouched — it has no shift reference.
- The duty-role picker is **required** whenever the assignee/requester currently has `secondary_role` set, enforced by a DB trigger (the real boundary) plus an earlier, friendlier Server Action check.
- Field only appears in UI for people with `secondary_role` set — single-role people see no behavior change at all.
- Do not touch `can_view_profile()`, `can_manage_attendance_for()`, or any leave-request call site — out of scope per the approved spec.
- Every migration/RPC change must keep old callers working (new SQL params are trailing + `default null`).
- No test suite exists — verify with `npx tsc --noEmit`, `npm run lint`, and live Supabase checks via disposable `auth.admin.createUser` accounts through the **anon** client, cleaned up after each task.
- Spec: `docs/superpowers/specs/2026-08-10-shift-duty-role-design.md` — consult it for the full rationale behind any decision below.

---

### Task 1: Database — migration `0052_shift_duty_role.sql`

**Files:**
- Create: `supabase/migrations/0052_shift_duty_role.sql`

**Interfaces:**
- Produces: columns `shifts.duty_role public.staff_role` (nullable), `shift_requests.duty_role public.staff_role` (nullable); triggers `shifts_validate_duty_role`, `shift_requests_validate_duty_role`; updated functions `can_approve_shift_request(p_target_id uuid, p_duty_role public.staff_role default null)`, `can_approve_swap_request(p_requester_id uuid, p_target_id uuid, p_requester_duty_role public.staff_role default null, p_target_duty_role public.staff_role default null)`, `respond_to_shift_request(p_id uuid, p_approve boolean)`, `respond_to_swap_request(p_request_id uuid, p_accept boolean)`, `respond_to_attendance_correction(p_id uuid, p_approve boolean)`; updated policies `shift_requests_select`, `shift_requests_delete_manager`, `shift_swap_requests_delete_manager`.

- [ ] **Step 1: Write the migration file**

```sql
-- Shift duty role: which of their 2 roles a dual-role staff member (see
-- 0051_staff_secondary_role.sql) is covering for a SPECIFIC shift/request —
-- vs. secondary_role, which is a person-level label with no effect on
-- approval routing. This column DOES drive approval routing for the 3
-- request types tied to an actual shift (đăng ký ca, đổi ca, giải trình
-- công); leave_requests has no shift reference and is untouched.
alter table public.shifts add column duty_role public.staff_role;
alter table public.shift_requests add column duty_role public.staff_role;

-- Self-healing + required-enforcing, same spirit as protect_profile_
-- privileges() (0001/0040): a duty_role that no longer matches the current
-- assignee's role/secondary_role (e.g. assignee_id was reassigned) is
-- silently cleared rather than blocking the whole UPDATE; but a person who
-- IS currently dual-role must have a duty_role picked, or the request
-- would have no way to know which manager should approve it.
create or replace function public.validate_shift_duty_role()
returns trigger language plpgsql as $$
declare
  v_role public.staff_role;
  v_secondary public.staff_role;
begin
  select role, secondary_role into v_role, v_secondary
  from public.profiles where id = new.assignee_id;

  if new.duty_role is not null and new.duty_role not in (v_role, v_secondary) then
    new.duty_role := null;
  end if;

  if v_secondary is not null and new.duty_role is null then
    raise exception 'Vui lòng chọn nhiệm vụ trong ca cho nhân viên kiêm nhiệm này';
  end if;

  return new;
end;
$$;

drop trigger if exists shifts_validate_duty_role on public.shifts;
create trigger shifts_validate_duty_role
  before insert or update on public.shifts
  for each row execute function public.validate_shift_duty_role();

-- Same logic, but keyed off shift_requests.profile_id (the requester) —
-- separate function because the column name differs (profile_id vs.
-- assignee_id) and a shared one would need dynamic SQL for no real benefit.
create or replace function public.validate_shift_request_duty_role()
returns trigger language plpgsql as $$
declare
  v_role public.staff_role;
  v_secondary public.staff_role;
begin
  select role, secondary_role into v_role, v_secondary
  from public.profiles where id = new.profile_id;

  if new.duty_role is not null and new.duty_role not in (v_role, v_secondary) then
    new.duty_role := null;
  end if;

  if v_secondary is not null and new.duty_role is null then
    raise exception 'Vui lòng chọn nhiệm vụ trong ca cho nhân viên kiêm nhiệm này';
  end if;

  return new;
end;
$$;

drop trigger if exists shift_requests_validate_duty_role on public.shift_requests;
create trigger shift_requests_validate_duty_role
  before insert or update on public.shift_requests
  for each row execute function public.validate_shift_request_duty_role();

-- can_approve_shift_request/can_approve_swap_request: add a trailing,
-- defaulted duty-role override param each. Every existing caller that
-- doesn't pass it keeps resolving to the target's plain profiles.role,
-- identical to today's behavior — this is purely additive.
create or replace function public.can_approve_shift_request(
  p_target_id uuid,
  p_duty_role public.staff_role default null
)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_ceo() then true
    else exists (
      select 1 from public.group_permissions gp
      where gp.manager_role = (select role from public.profiles where id = auth.uid())
        and gp.target_role = coalesce(p_duty_role, (select role from public.profiles where id = p_target_id))
        and gp.permission = 'approve_shift_request'
    )
  end;
$$;

grant execute on function public.can_approve_shift_request(uuid, public.staff_role) to authenticated;

create or replace function public.can_approve_swap_request(
  p_requester_id uuid,
  p_target_id uuid,
  p_requester_duty_role public.staff_role default null,
  p_target_duty_role public.staff_role default null
)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_ceo() then true
    else
      exists (
        select 1 from public.group_permissions gp
        where gp.manager_role = (select role from public.profiles where id = auth.uid())
          and gp.target_role = coalesce(p_requester_duty_role, (select role from public.profiles where id = p_requester_id))
          and gp.permission = 'approve_swap'
      )
      and exists (
        select 1 from public.group_permissions gp
        where gp.manager_role = (select role from public.profiles where id = auth.uid())
          and gp.target_role = coalesce(p_target_duty_role, (select role from public.profiles where id = p_target_id))
          and gp.permission = 'approve_swap'
      )
  end;
$$;

grant execute on function public.can_approve_swap_request(uuid, uuid, public.staff_role, public.staff_role) to authenticated;

-- respond_to_shift_request(): pass the request's own duty_role into the
-- approval check, and copy it forward onto the shift created on approval —
-- otherwise a shift born from an approved dual-role request would silently
-- lose its duty_role and any later swap/correction on it would fall back
-- to the requester's primary role.
create or replace function public.respond_to_shift_request(p_id uuid, p_approve boolean)
returns public.shift_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.shift_requests%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  select * into v_req from public.shift_requests where id = p_id for update;
  if not found or v_req.status <> 'pending' then
    raise exception 'Đơn đăng ký không còn hiệu lực';
  end if;

  if not public.can_approve_shift_request(v_req.profile_id, v_req.duty_role) then
    raise exception 'Bạn không có quyền duyệt đăng ký ca này';
  end if;

  if p_approve then
    insert into public.shifts (assignee_id, start_at, end_at, note, created_by, shift_type, branch_id, duty_role)
    values (v_req.profile_id, v_req.start_at, v_req.end_at, v_req.note, v_uid, v_req.shift_type, v_req.branch_id, v_req.duty_role);
  end if;

  update public.shift_requests
  set status = (case when p_approve then 'approved' else 'rejected' end)::public.shift_request_status,
      responder_id = v_uid,
      resolved_at = now()
  where id = p_id
  returning * into v_req;

  return v_req;
end;
$$;

-- respond_to_swap_request(): look up each side's shift duty_role (via
-- requester_shift_id/target_shift_id) and pass both into
-- can_approve_swap_request — body otherwise identical to 0044's version.
create or replace function public.respond_to_swap_request(
  p_request_id uuid,
  p_accept boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.shift_swap_requests%rowtype;
  v_taker uuid;
  v_requester_duty public.staff_role;
  v_target_duty public.staff_role;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  select * into v_req from public.shift_swap_requests where id = p_request_id for update;
  if not found or v_req.status <> 'pending' then
    raise exception 'Yêu cầu không còn hiệu lực';
  end if;

  select duty_role into v_requester_duty from public.shifts where id = v_req.requester_shift_id;
  if v_req.target_shift_id is not null then
    select duty_role into v_target_duty from public.shifts where id = v_req.target_shift_id;
  end if;

  if not public.is_manager()
     and not public.is_branch_member(v_uid, v_req.branch_id)
     and not (v_req.target_id is not null and public.can_approve_swap_request(v_req.requester_id, v_req.target_id, v_requester_duty, v_target_duty)) then
    raise exception 'Yêu cầu không thuộc cơ sở của bạn';
  end if;

  if v_req.target_id is not null then
    if v_uid <> v_req.target_id and not public.can_approve_swap_request(v_req.requester_id, v_req.target_id, v_requester_duty, v_target_duty) then
      raise exception 'Bạn không phải người được yêu cầu';
    end if;
  else
    if v_uid = v_req.requester_id then raise exception 'Không thể tự nhận ca của mình'; end if;
  end if;

  if not p_accept then
    update public.shift_swap_requests
       set status = 'rejected', responder_id = v_uid, resolved_at = now()
     where id = p_request_id;
    return;
  end if;

  if v_req.target_id is not null then
    v_taker := v_req.target_id;
  else
    v_taker := v_uid;
  end if;

  if not exists (select 1 from public.shifts
    where id = v_req.target_shift_id and assignee_id = v_taker) then
    if v_req.target_shift_id is not null then
      raise exception 'Ca đối ứng đã thay đổi, yêu cầu không còn hợp lệ';
    end if;
  end if;

  if not exists (select 1 from public.shifts where id = v_req.requester_shift_id and assignee_id = v_req.requester_id) then
    raise exception 'Ca gốc đã thay đổi, yêu cầu không còn hợp lệ';
  end if;

  if v_req.target_shift_id is not null then
    update public.shifts set assignee_id = v_req.requester_id where id = v_req.target_shift_id;
    update public.shifts set assignee_id = v_taker where id = v_req.requester_shift_id;
  else
    update public.shifts set assignee_id = v_taker where id = v_req.requester_shift_id;
  end if;

  update public.shift_swap_requests
     set status = 'approved', responder_id = v_uid, resolved_at = now()
   where id = p_request_id;
end;
$$;

grant execute on function public.respond_to_swap_request(uuid, boolean) to authenticated;

-- request_shift(): add a trailing, defaulted p_duty_role param and persist
-- it — otherwise a dual-role requester's INSERT always lands with
-- duty_role null, and validate_shift_request_duty_role() (above) rejects
-- it outright. Body is 0037_student_affairs_single_slot.sql's version
-- verbatim except the signature (+1 param) and the INSERT (+1 column/value).
create or replace function public.request_shift(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_branch_id uuid,
  p_note text default null,
  p_shift_type public.shift_type default 'morning',
  p_duty_role public.staff_role default null
) returns public.shift_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role public.staff_role;
  v_row public.shift_requests%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if p_end_at <= p_start_at then
    raise exception 'Giờ kết thúc phải sau giờ bắt đầu' using errcode = '23514';
  end if;
  if p_branch_id is null then
    raise exception 'Vui lòng chọn cơ sở' using errcode = '23514';
  end if;
  if not public.is_manager() and not public.is_branch_member(v_uid, p_branch_id) then
    raise exception 'Bạn không thuộc cơ sở này' using errcode = '23514';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role = 'student_affairs' and public.student_affairs_slot_taken(
    p_branch_id, p_start_at, p_end_at, null, null
  ) then
    raise exception 'Ca này đã có đăng ký quản sinh' using errcode = '23505';
  end if;

  insert into public.shift_requests (profile_id, branch_id, start_at, end_at, note, shift_type, duty_role)
  values (v_uid, p_branch_id, p_start_at, p_end_at, nullif(p_note, ''), p_shift_type, p_duty_role)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.request_shift(timestamptz, timestamptz, uuid, text, public.shift_type, public.staff_role) to authenticated;

-- respond_to_attendance_correction(): replace the can_view_profile() gate
-- (shared, primary-role-only, used by many other RLS policies — must NOT
-- change) with an inline duty-aware check scoped to this function alone.
-- Same 'approve_leave' permission literal as before (attendance-correction
-- approval has always shared the leave-approver group).
create or replace function public.respond_to_attendance_correction(p_id uuid, p_approve boolean)
returns public.attendance_corrections
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.attendance_corrections%rowtype;
  v_duty_role public.staff_role;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if not public.is_leave_approver() then
    raise exception 'Chỉ quản lý mới được duyệt đơn giải trình công';
  end if;

  select * into v_row from public.attendance_corrections where id = p_id;
  if v_row is null then
    raise exception 'Bạn không có quyền duyệt đơn của nhân viên này';
  end if;

  select duty_role into v_duty_role from public.shifts where id = v_row.shift_id;

  if not (
    (select role from public.profiles where id = auth.uid()) = 'ceo'
    or exists (
      select 1 from public.group_permissions gp
      where gp.manager_role = (select role from public.profiles where id = auth.uid())
        and gp.target_role = coalesce(v_duty_role, (select role from public.profiles where id = v_row.profile_id))
        and gp.permission = 'approve_leave'
    )
  ) then
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

grant execute on function public.respond_to_attendance_correction(uuid, boolean) to authenticated;

-- shift_requests visibility RLS: duty_role lives on this same table, so it
-- can be read directly in the USING clause without a join.
drop policy if exists shift_requests_select on public.shift_requests;
create policy shift_requests_select on public.shift_requests
  for select to authenticated
  using (
    profile_id = auth.uid()
    or public.can_approve_shift_request(profile_id, duty_role)
  );

drop policy if exists shift_requests_delete_manager on public.shift_requests;
create policy shift_requests_delete_manager on public.shift_requests
  for delete to authenticated
  using (status = 'pending' and public.can_approve_shift_request(profile_id, duty_role));

drop policy if exists shift_swap_requests_delete_manager on public.shift_swap_requests;
create policy shift_swap_requests_delete_manager on public.shift_swap_requests
  for delete to authenticated
  using (
    status = 'pending'
    and target_id is not null
    and public.can_approve_swap_request(
      requester_id,
      target_id,
      (select duty_role from public.shifts where id = requester_shift_id),
      (select duty_role from public.shifts where id = target_shift_id)
    )
  );
```

Note on `shift_requests_select`: check the exact current `using` clause of
this policy before writing the `create policy` line above — search
`supabase/migrations/*.sql` for `shift_requests_select` and take the LATEST
definition's full `using` expression as the base (0019 was the last one seen
during design, but confirm no later migration touched it), replacing only
the `public.can_approve_shift_request(profile_id)` call with
`public.can_approve_shift_request(profile_id, duty_role)`. Do not guess —
grep and copy the real current text.

- [ ] **Step 2: Deploy to remote Supabase**

Run: `npx supabase db push`
Expected: migration `0052_shift_duty_role.sql` applies cleanly, no errors.

- [ ] **Step 3: Live-verify the trigger and 3 approval-routing SQL changes**

Write a one-off Node script (delete after use) in the scratchpad directory
using `@supabase/supabase-js` with the service-role key to create 2
disposable accounts via `auth.admin.createUser` — one `role: 'teacher',
secondary_role: 'teaching_assistant'` (call them DUAL), one `role: 'hr'`
(call them MGR_HR) and one `role: 'training_director'` (MGR_TD). Then, using
the **anon key client** signed in as each account (not service role — must
exercise real RLS/RPC), exercise:

1. As DUAL: insert a `shifts` row (`assignee_id` = DUAL, no `duty_role`) via
   direct table insert (as a manager would, but skip the app layer here) —
   expect it to succeed if DUAL is not itself the assignee-setter... instead,
   simplest: call `request_shift` RPC as DUAL with no way to set duty_role
   (older RPC signature) — this will go through `shift_requests` with
   `duty_role` null. Confirm the trigger raises `Vui lòng chọn nhiệm vụ
   trong ca cho nhân viên kiêm nhiệm này` when you `insert` directly into
   `shift_requests` (as service role, simulating what the future Server
   Action will do) with `profile_id = DUAL.id`, `duty_role = null`.
2. Insert again with `duty_role = 'teaching_assistant'` → succeeds.
3. Insert a `shift_requests` row for DUAL with `duty_role = 'hr'` (invalid —
   not one of DUAL's 2 roles) → row saves but trigger has silently reset
   `duty_role` to `null` on the row you just tried to insert with a bad
   value... re-check: the mandatory check runs AFTER the self-heal in the
   same trigger invocation, so this actually raises the same "vui lòng chọn"
   exception (self-heal sets it null before the mandatory check evaluates
   it) — confirm this exact behavior and treat it as correct, not a bug.
4. Approve that pending `teaching_assistant`-duty request as MGR_HR (call
   `respond_to_shift_request` via MGR_HR's anon client) → succeeds; as
   MGR_TD → fails with `Bạn không có quyền duyệt đăng ký ca này`.
5. Confirm the resulting `shifts` row has `duty_role = 'teaching_assistant'`.
6. Create a `shift_swap_requests` row referencing 2 shifts with different
   `duty_role` values (one `teacher`, one `teaching_assistant`, same DUAL
   person on both, different `id`s) and confirm `can_approve_swap_request`
   returns different results for MGR_HR vs MGR_TD depending on which shift
   pair you test.
7. Create an `attendance_corrections` row against a shift with
   `duty_role = 'teaching_assistant'` and confirm `respond_to_attendance_
   correction` succeeds for MGR_HR, fails for MGR_TD.
8. Delete both test profiles via `auth.admin.deleteUser`.

Expected: every check above passes exactly as described. If step 3's
"self-heal-then-raise" ordering surprises you, re-read the trigger body —
the self-heal `if` runs first and unconditionally, so a bad value is
already `null` by the time the mandatory-pick `if` runs.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0052_shift_duty_role.sql
git commit -m "feat: add shift duty_role for dual-role approval routing"
```

---

### Task 2: Types, Supabase select strings, and approval-routing call sites

**Files:**
- Modify: `types/index.ts`
- Modify: `app/(app)/calendar/page.tsx` (`SWAP_SELECT` and the attendance_corrections `.select()`)
- Modify: `app/(app)/swaps/page.tsx` (its own swap select string)
- Modify: `app/(app)/manager/page.tsx` (swap select, attendance_corrections select, `SHIFTS_OVERVIEW_SELECT`, and 6 `canApprove*For` call sites)
- Modify: `components/manager/ShiftsOverviewTable.tsx` (`ShiftOverviewRow` type)
- Modify: `lib/roles.ts` (new `effectiveRole` helper)
- Modify: `lib/calendar.ts` (swap-approvable calc + shift event title)
- Modify: `components/calendar/ShiftCalendar.tsx` (4 call sites + the manually-built `Shift` object)
- Modify: `components/calendar/AttendanceDetailDialog.tsx` (1 call site)
- Modify: `lib/notifications.ts` (1 call site)

**Interfaces:**
- Consumes: nothing new from Task 1 beyond the DB columns already existing.
- Produces: `effectiveRole(dutyRole: Role | null, primaryRole: Role): Role` in `lib/roles.ts`, importable by Task 3's actions.

- [ ] **Step 1: Add `duty_role` to base types**

In `types/index.ts`, add one field to `Shift` (auto-flows into
`ShiftWithAssignee`) and to `ShiftRequest` (auto-flows into
`ShiftRequestDetailed`):

```ts
export type Shift = {
  id: string;
  branch_id: string;
  assignee_id: string;
  start_at: string;
  end_at: string;
  note: string | null;
  created_by: string | null;
  shift_type: ShiftType;
  duty_role: Role | null;
};
```

```ts
export type ShiftRequest = {
  id: string;
  profile_id: string;
  branch_id: string | null;
  start_at: string;
  end_at: string;
  note: string | null;
  status: ShiftRequestStatus;
  responder_id: string | null;
  resolved_at: string | null;
  created_at: string;
  shift_type: ShiftType;
  duty_role: Role | null;
};
```

Add `"duty_role"` to the 2 join Picks that reference `Shift` but don't use
the full type:

```ts
export type SwapRequestDetailed = SwapRequest & {
  requester: Pick<Profile, "id" | "full_name" | "role">;
  target: Pick<Profile, "id" | "full_name" | "role"> | null;
  requester_shift: Pick<Shift, "id" | "start_at" | "end_at" | "duty_role">;
  target_shift: Pick<Shift, "id" | "start_at" | "end_at" | "duty_role"> | null;
};
```

```ts
export type AttendanceCorrectionDetailed = AttendanceCorrection & {
  profile: Pick<Profile, "id" | "full_name" | "role">;
  shift: Pick<Shift, "id" | "start_at" | "end_at" | "duty_role">;
};
```

- [ ] **Step 2: Add `duty_role` to the 4 explicit nested-join select strings**

In `app/(app)/calendar/page.tsx`, change `SWAP_SELECT` (around line 30):

```ts
const SWAP_SELECT = `
  *,
  requester:profiles!requester_id(id, full_name, role),
  target:profiles!target_id(id, full_name, role),
  requester_shift:shifts!requester_shift_id(id, start_at, end_at, duty_role),
  target_shift:shifts!target_shift_id(id, start_at, end_at, duty_role)
`;
```

Same file, the attendance_corrections `.select()` (around line 150):

```ts
.select("*, profile:profiles!profile_id(id, full_name, role), shift:shifts!shift_id(id, start_at, end_at, duty_role)")
```

In `app/(app)/swaps/page.tsx`, apply the identical `requester_shift`/
`target_shift` change to its own select string (same shape as `SWAP_SELECT`
above — grep the file for `requester_shift:shifts!requester_shift_id` to
find it).

In `app/(app)/manager/page.tsx`: apply the same swap-select and
attendance_corrections-select changes (grep for
`requester_shift:shifts!requester_shift_id` and
`shift:shifts!shift_id(id, start_at, end_at)` in this file — 2 occurrences),
and change `SHIFTS_OVERVIEW_SELECT` (around line 49-50):

```ts
const SHIFTS_OVERVIEW_SELECT =
  "id, start_at, end_at, shift_type, duty_role, assignee:profiles!assignee_id(id, full_name, role), branch:branches!branch_id(id, name)";
```

- [ ] **Step 3: Add `duty_role` to `ShiftOverviewRow`**

In `components/manager/ShiftsOverviewTable.tsx`:

```ts
export type ShiftOverviewRow = {
  id: string;
  start_at: string;
  end_at: string;
  shift_type: keyof typeof SHIFT_TYPE_LABELS;
  duty_role: Role | null;
  assignee: { id: string; full_name: string; role: Role };
  branch: { id: string; name: string } | null;
};
```

(Displaying it is Task 6 — this step only makes the type accurate.)

- [ ] **Step 4: Add `effectiveRole` helper**

In `lib/roles.ts`, immediately after `getRoleLabel` (which ends around line
59):

```ts
// Ca có nhiệm vụ riêng (người kiêm nhiệm) thì tính quyền duyệt theo nhiệm vụ
// đó; ca thường (hoặc chưa chọn) rơi về vai trò chính — y hệt hành vi trước
// khi có duty_role. Chỉ dùng ở 3 luồng gắn với 1 ca cụ thể: đăng ký ca, đổi
// ca, giải trình công. Đơn nghỉ phép không có shift liên quan, không dùng
// hàm này.
export function effectiveRole(dutyRole: Role | null, primaryRole: Role): Role {
  return dutyRole ?? primaryRole;
}
```

- [ ] **Step 5: Rewire `lib/calendar.ts`'s swap-approvable check and shift title**

Line ~567 inside `approvableFor`, change:

```ts
canApproveSwapRequestFor(currentUserRole, swap.requester.role, swap.target.role, permissions)
```

to:

```ts
canApproveSwapRequestFor(
  currentUserRole,
  effectiveRole(swap.requester_shift.duty_role, swap.requester.role),
  effectiveRole(swap.target_shift?.duty_role ?? null, swap.target.role),
  permissions
)
```

Add `effectiveRole` to the existing `canApproveSwapRequestFor` import at the
top of the file.

Line ~583, change the event title:

```ts
title: shift.duty_role
  ? `${shift.assignee.full_name} · ${ROLE_LABELS[shift.duty_role]}`
  : shift.assignee.full_name,
```

Add `ROLE_LABELS` to the imports from `@/lib/roles` at the top of the file.

- [ ] **Step 6: Rewire `components/calendar/ShiftCalendar.tsx`'s 4 call sites**

Line ~412 (`openSwapDetail`'s `canApproveAsManager`):

```ts
canApproveSwapRequestFor(
  currentUserRole,
  effectiveRole(request.requester_shift.duty_role, request.requester.role),
  effectiveRole(request.target_shift?.duty_role ?? null, request.target.role),
  permissions
);
```

Same function, the manually-built `Shift` object (~line 422-437) needs the
new required field or `tsc` will fail:

```ts
const shift: ShiftWithAssignee = {
  id: request.requester_shift.id,
  branch_id: request.branch_id,
  assignee_id: request.requester_id,
  start_at: request.requester_shift.start_at,
  end_at: request.requester_shift.end_at,
  note: null,
  created_by: null,
  shift_type: "morning",
  duty_role: request.requester_shift.duty_role,
  assignee: {
    id: request.requester_id,
    full_name: request.requester.full_name,
    color: null,
    role: request.requester.role,
  },
};
```

Line ~615 (`pendingSwapsForApproval`'s filter predicate):

```ts
(r.target_id !== null &&
  r.target !== null &&
  canApproveSwapRequestFor(
    currentUserRole,
    effectiveRole(r.requester_shift.duty_role, r.requester.role),
    effectiveRole(r.target_shift?.duty_role ?? null, r.target.role),
    permissions
  )) ||
```

Line ~627 (`attendanceCorrectionsForApproval`'s filter predicate) — this one
is currently gated by `isLeaveApprover(currentUserRole) &&
canApproveLeaveFor(currentUserRole, r.profile.role, permissions)`; change
the second argument only:

```ts
(isLeaveApprover(currentUserRole) &&
  canApproveLeaveFor(currentUserRole, effectiveRole(r.shift.duty_role, r.profile.role), permissions)) ||
```

Line ~865 (`ShiftRequestDetailDialog`'s `canRespond` prop):

```ts
canRespond={canApproveShiftRequestFor(
  currentUserRole,
  effectiveRole(shiftRequestDetail.resource.request.duty_role, shiftRequestDetail.resource.request.profile.role),
  permissions
)}
```

Line ~855 (`LeaveDetailDialog`'s `canRespond`, using `canApproveLeaveFor`
for actual leave) — **leave this one exactly as-is**, it's the leave-request
call site, out of scope.

Add `effectiveRole` to the existing `@/lib/roles` import at the top of the
file.

- [ ] **Step 7: Rewire `components/calendar/AttendanceDetailDialog.tsx`'s 1 call site**

Line ~169:

```ts
const canRespond =
  correction !== null &&
  isLeaveApprover(currentUserRole) &&
  canApproveLeaveFor(currentUserRole, effectiveRole(correction.shift.duty_role, correction.profile.role), permissions);
```

Add `effectiveRole` to the `@/lib/roles` import at the top of the file.

- [ ] **Step 8: Rewire `components/manager/page.tsx`'s 6 call sites**

Đăng ký ca (lines ~334, ~336) — both instances of:

```ts
canApproveShiftRequestFor(manager.role, r.profile.role, permissions)
```

become:

```ts
canApproveShiftRequestFor(manager.role, effectiveRole(r.duty_role, r.profile.role), permissions)
```

Đổi ca (lines ~358, ~365) — both instances of:

```ts
canApproveSwapRequestFor(manager.role, r.requester.role, r.target.role, permissions)
```

become:

```ts
canApproveSwapRequestFor(
  manager.role,
  effectiveRole(r.requester_shift.duty_role, r.requester.role),
  effectiveRole(r.target_shift?.duty_role ?? null, r.target.role),
  permissions
)
```

Giải trình công section (lines ~412, ~418 — inside the `"attendance-
corrections"` Section, **not** the `"leave"` Section at ~385/391, which
stays untouched) — both instances of:

```ts
canApproveLeaveFor(manager.role, r.profile.role, permissions)
```

become:

```ts
canApproveLeaveFor(manager.role, effectiveRole(r.shift.duty_role, r.profile.role), permissions)
```

Add `effectiveRole` to the existing `@/lib/roles` import at the top of the
file.

- [ ] **Step 9: Rewire `lib/notifications.ts`'s 1 call site**

Line ~99:

```ts
if (r.status === "pending" && canApproveShiftRequestFor(profile.role, effectiveRole(r.duty_role, r.profile.role), permissions)) {
```

Add `effectiveRole` to the `@/lib/roles` import at the top of the file.

- [ ] **Step 10: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors. If errors remain about `duty_role` missing on an object
literal, it means a call site building a `Shift`/`ShiftWithAssignee`/
`SwapRequestDetailed`/`AttendanceCorrectionDetailed` by hand was missed —
find it and add the field.

- [ ] **Step 11: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add types/index.ts "app/(app)/calendar/page.tsx" "app/(app)/swaps/page.tsx" "app/(app)/manager/page.tsx" components/manager/ShiftsOverviewTable.tsx lib/roles.ts lib/calendar.ts components/calendar/ShiftCalendar.tsx components/calendar/AttendanceDetailDialog.tsx lib/notifications.ts
git commit -m "feat: route shift-tied approvals through duty_role, not just primary role"
```

---

### Task 3: Validation schemas and Server Actions

**Files:**
- Modify: `lib/validations/shift.ts`
- Modify: `lib/validations/shift-request.ts`
- Modify: `actions/shifts.ts`
- Modify: `actions/shift-requests.ts`

**Interfaces:**
- Consumes: `effectiveRole` from `lib/roles.ts` (Task 2).
- Produces: `shiftSchema`/`shiftRequestSchema` now accept an optional
  `duty_role`; `createShiftAction`/`updateShiftAction`/`requestShiftAction`
  reject a missing `duty_role` for a dual-role assignee/requester with a
  friendly Vietnamese message before hitting Postgres.

- [ ] **Step 1: Add `duty_role` to `shiftSchema`**

In `lib/validations/shift.ts`:

```ts
import { z } from "zod";

export const SHIFT_TYPES = ["morning", "afternoon", "evening", "remote"] as const;
export const DUTY_ROLES = ["teacher", "student_affairs", "teaching_assistant"] as const;

export const shiftSchema = z
  .object({
    assignee_id: z.uuid("Vui lòng chọn nhân viên"),
    branch_id: z.uuid("Vui lòng chọn cơ sở"),
    start_at: z.string().min(1, "Vui lòng chọn giờ bắt đầu"),
    end_at: z.string().min(1, "Vui lòng chọn giờ kết thúc"),
    shift_type: z.enum(SHIFT_TYPES, "Vui lòng chọn loại ca"),
    duty_role: z.enum(DUTY_ROLES).nullish(),
    note: z.string().max(280, "Ghi chú tối đa 280 ký tự").optional(),
  })
  .refine((v) => new Date(v.end_at) > new Date(v.start_at), {
    message: "Giờ kết thúc phải sau giờ bắt đầu",
    path: ["end_at"],
  });
export type ShiftInput = z.infer<typeof shiftSchema>;
```

- [ ] **Step 2: Add `duty_role` to `shiftRequestSchema`**

In `lib/validations/shift-request.ts`:

```ts
import { z } from "zod";
import { SHIFT_TYPES, DUTY_ROLES } from "@/lib/validations/shift";

export const shiftRequestSchema = z
  .object({
    branch_id: z.uuid("Vui lòng chọn cơ sở"),
    start_at: z.string().min(1, "Vui lòng chọn giờ bắt đầu"),
    end_at: z.string().min(1, "Vui lòng chọn giờ kết thúc"),
    shift_type: z.enum(SHIFT_TYPES, "Vui lòng chọn loại ca"),
    duty_role: z.enum(DUTY_ROLES).nullish(),
    note: z.string().max(280, "Ghi chú tối đa 280 ký tự").optional(),
  })
  .refine((v) => new Date(v.end_at) > new Date(v.start_at), {
    message: "Giờ kết thúc phải sau giờ bắt đầu",
    path: ["end_at"],
  });
export type ShiftRequestInput = z.infer<typeof shiftRequestSchema>;
```

- [ ] **Step 3: Enforce "required for dual-role" + copy `duty_role` in `actions/shifts.ts`**

`assertAssigneeAllowed` already does one `profiles` lookup by
`assignee_id` — extend it to also return the assignee's `secondary_role` so
both call sites can check it without a second query. Change its signature
and body (around line 18-37):

```ts
async function assertAssigneeAllowed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  callerRole: Role,
  assigneeId: string,
  branchId: string,
  dutyRole: Role | null | undefined
): Promise<string | null> {
  const { data: assignee } = await supabase
    .from("profiles")
    .select("role, secondary_role")
    .eq("id", assigneeId)
    .single();
  if (!assignee) return "Không tìm thấy nhân viên này";
  const permissions = await getGroupPermissions();
  if (!canCreateShiftFor(callerRole, assignee.role, permissions)) {
    return "Bạn không có quyền xếp ca cho nhân viên này";
  }
  if (assignee.secondary_role && !dutyRole) {
    return "Vui lòng chọn nhiệm vụ trong ca cho nhân viên kiêm nhiệm này";
  }
  if (isManagerRole(assignee.role)) return null;

  const { data: isMember } = await supabase.rpc("is_branch_member", {
    p_profile_id: assigneeId,
    p_branch_id: branchId,
  });
  return isMember ? null : "Nhân viên này không thuộc cơ sở đã chọn";
}
```

Update both call sites (`createShiftAction`, `updateShiftAction`) to pass
`parsed.data.duty_role`, and both `.insert(...)`/`.update(...)` calls to
include `duty_role: parsed.data.duty_role ?? null`:

```ts
const assigneeError = await assertAssigneeAllowed(
  supabase,
  manager.role,
  parsed.data.assignee_id,
  parsed.data.branch_id,
  parsed.data.duty_role
);
if (assigneeError) return { ok: false, error: assigneeError };

const { error } = await supabase.from("shifts").insert({
  assignee_id: parsed.data.assignee_id,
  branch_id: parsed.data.branch_id,
  start_at: parsed.data.start_at,
  end_at: parsed.data.end_at,
  shift_type: parsed.data.shift_type,
  duty_role: parsed.data.duty_role ?? null,
  created_by: manager.id,
});
```

(Same 2 additions — `dutyRole` param passthrough and `duty_role:` in the
update payload — in `updateShiftAction`.)

In `mapShiftError`, add a case for the trigger's message before the
generic fallback:

```ts
if (message.includes("Vui lòng chọn nhiệm vụ trong ca")) {
  return "Vui lòng chọn nhiệm vụ trong ca cho nhân viên kiêm nhiệm này";
}
```

- [ ] **Step 4: Enforce "required for dual-role" + duty-aware push in `actions/shift-requests.ts`**

In `requestShiftAction`, look up the requester's `secondary_role` (already
have `profile` from `requireProfile()` — check whether `requireProfile()`'s
return type already includes `secondary_role`; it does, per
`lib/auth.ts`'s `PROFILE_COLUMNS`/`toProfile()` from the secondary_role
feature) and reject before calling the RPC:

```ts
export async function requestShiftAction(input: unknown): Promise<ActionResult> {
  const profile = await requireProfile();
  const parsed = shiftRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  if (profile.secondary_role && !parsed.data.duty_role) {
    return { ok: false, error: "Vui lòng chọn nhiệm vụ trong ca cho nhân viên kiêm nhiệm này" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_shift", {
    p_start_at: new Date(parsed.data.start_at).toISOString(),
    p_end_at: new Date(parsed.data.end_at).toISOString(),
    p_branch_id: parsed.data.branch_id,
    p_note: parsed.data.note || null,
    p_shift_type: parsed.data.shift_type,
  });

  if (error) return { ok: false, error: mapShiftRequestError(error.message) };
```

`request_shift`'s RPC signature already gained a trailing `p_duty_role`
param in Task 1 — finish this action by passing it through and using it for
push targeting:

```ts
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_shift", {
    p_start_at: new Date(parsed.data.start_at).toISOString(),
    p_end_at: new Date(parsed.data.end_at).toISOString(),
    p_branch_id: parsed.data.branch_id,
    p_note: parsed.data.note || null,
    p_shift_type: parsed.data.shift_type,
    p_duty_role: parsed.data.duty_role ?? null,
  });

  if (error) return { ok: false, error: mapShiftRequestError(error.message) };

  revalidateShiftRequestPaths();
  after(() =>
    sendPushToShiftRequestApprovers(effectiveRole(parsed.data.duty_role ?? null, profile.role), {
      title: "Đăng ký ca làm mới",
      body: `${profile.full_name} vừa gửi đăng ký ca làm`,
      url: "/manager",
      tag: "shift-request",
    })
  );
  return { ok: true, data: undefined };
}
```

Add `effectiveRole` to the `@/lib/roles` import in this file (new import —
currently only imports `isShiftRequestApprover`).

In `mapShiftRequestError`, add the same trigger-message case as Task 3
Step 3.

- [ ] **Step 5: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Live-verify the full đăng ký ca flow end-to-end**

Using the DUAL/MGR_HR/MGR_TD pattern from Task 1 Step 3 (fresh accounts,
anon client, cleaned up after): call `requestShiftAction` as DUAL with
`duty_role: undefined` → expect `{ ok: false, error: "Vui lòng chọn nhiệm
vụ trong ca cho nhân viên kiêm nhiệm này" }` (the Server Action's own
check, never reaching Postgres). Call again with `duty_role:
"teaching_assistant"` → `{ ok: true }`. Confirm `respondToShiftRequestAction`
succeeds for MGR_HR and fails for MGR_TD on that request.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0052_shift_duty_role.sql lib/validations/shift.ts lib/validations/shift-request.ts actions/shifts.ts actions/shift-requests.ts
git commit -m "feat: enforce and persist duty_role in shift create/request actions"
```

---

### Task 4: `ShiftFormDialog.tsx` — manager-side duty-role picker

**Files:**
- Modify: `components/shifts/ShiftFormDialog.tsx`

**Interfaces:**
- Consumes: `shiftSchema`/`DUTY_ROLES` (Task 3), `ROLE_LABELS`,
  `SECONDARY_ROLE_ELIGIBLE_ROLES` (already exist in `lib/roles.ts`).
- Produces: nothing new consumed elsewhere — this is a leaf UI component.

- [ ] **Step 1: Widen the `branchMembers` prop and `formSchema`**

```ts
branchMembers: Pick<Profile, "id" | "full_name" | "role" | "secondary_role" | "branch_ids">[];
```

```ts
const formSchema = z.object({
  assignee_id: z.uuid("Vui lòng chọn nhân viên"),
  branch_id: z.uuid("Vui lòng chọn cơ sở"),
  note: z.string().max(280, "Ghi chú tối đa 280 ký tự").optional(),
});
```

(`formSchema` itself doesn't need `duty_role` — it's tracked as separate
component state, same pattern already used for `shiftType`/`date`/
`startTime`/`endTime` in this file, since it depends on `selectedAssignee`
which isn't known until render.)

- [ ] **Step 2: Add `dutyRole` state and reset-on-assignee-change**

Add near the other `useState` calls (~line 83):

```ts
const [dutyRole, setDutyRole] = useState<DutyRole | "">("");
```

Import the type: `import type { ..., Role } from "@/types";` already
exists — add a local alias where `SHIFT_TYPES` is imported:

```ts
import { SHIFT_TYPES, DUTY_ROLES } from "@/lib/validations/shift";
import { ROLE_LABELS, SECONDARY_ROLE_ELIGIBLE_ROLES, isManagerRole } from "@/lib/roles";

type DutyRole = (typeof DUTY_ROLES)[number];
```

In the `useEffect` that resets `branch_id` when `selectedAssigneeId`
changes (~line 111-124), also reset `dutyRole` — extend the existing
effect body:

```ts
const previousAssigneeIdRef = useRef<string | undefined>(undefined);
useEffect(() => {
  if (
    previousAssigneeIdRef.current !== undefined &&
    previousAssigneeIdRef.current !== selectedAssigneeId
  ) {
    const currentBranchId = getValues("branch_id");
    if (currentBranchId && !allowedBranches.some((b) => b.id === currentBranchId)) {
      setValue("branch_id", "");
    }
    setDutyRole("");
  }
  previousAssigneeIdRef.current = selectedAssigneeId;
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [selectedAssigneeId]);
```

In the `if (open !== wasOpen)` block (~line 126-146), initialize `dutyRole`
for both branches:

```ts
if (shift) {
  reset({ assignee_id: shift.assignee_id, branch_id: shift.branch_id, note: shift.note ?? "" });
  setDate(startOfDay(new Date(shift.start_at)));
  setStartTime(format(new Date(shift.start_at), TIME_FORMAT));
  setEndTime(format(new Date(shift.end_at), TIME_FORMAT));
  setShiftType(shift.shift_type);
  setDutyRole((shift.duty_role as DutyRole | null) ?? "");
} else {
  reset({ assignee_id: undefined, branch_id: undefined, note: "" });
  const base = initialRange?.start ?? new Date();
  const initialStart = initialRange ? format(initialRange.start, TIME_FORMAT) : "09:00";
  setDate(startOfDay(base));
  setStartTime(initialStart);
  setEndTime(initialRange ? format(initialRange.end, TIME_FORMAT) : "11:00");
  setShiftType(detectShiftType(initialStart));
  setDutyRole("");
}
```

- [ ] **Step 3: Block submit + send `duty_role` when the assignee is dual-role**

At the top of `onSubmit`, before building `payload`:

```ts
async function onSubmit(values: FormValues) {
  setServerError("");

  if (selectedAssignee?.secondary_role && !dutyRole) {
    setServerError("Vui lòng chọn nhiệm vụ trong ca cho nhân viên kiêm nhiệm này");
    return;
  }

  const startDateTime = parse(startTime, TIME_FORMAT, date);
  const endDateTime = parse(endTime, TIME_FORMAT, date);
  if (endDateTime <= startDateTime) {
    endDateTime.setDate(endDateTime.getDate() + 1);
  }

  const payload = {
    assignee_id: values.assignee_id,
    branch_id: values.branch_id,
    start_at: startDateTime.toISOString(),
    end_at: endDateTime.toISOString(),
    shift_type: shiftType,
    duty_role: dutyRole || undefined,
    note: values.note || undefined,
  };
```

- [ ] **Step 4: Add the Select, shown only for a dual-role assignee**

Immediately after the "Cơ sở" `<Select>` block (after line ~252, before the
date/time block):

```tsx
{selectedAssignee?.secondary_role && (
  <div className="space-y-1.5">
    <Label htmlFor="duty_role">Nhiệm vụ trong ca</Label>
    <Select value={dutyRole} onValueChange={(v) => setDutyRole(v as DutyRole)}>
      <SelectTrigger id="duty_role" className="w-full">
        <SelectValue placeholder="Chọn nhiệm vụ" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={selectedAssignee.role}>{ROLE_LABELS[selectedAssignee.role]}</SelectItem>
        <SelectItem value={selectedAssignee.secondary_role}>
          {ROLE_LABELS[selectedAssignee.secondary_role]}
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
)}
```

- [ ] **Step 5: Verify types, lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Manual browser check**

Start the dev server (`npm run dev`), log in as a manager, open "Tạo ca làm
việc", pick a dual-role staff member (from Task 1's test setup — create one
via the DUAL pattern and keep it around for this step only, delete after):
confirm the "Nhiệm vụ trong ca" select appears with exactly 2 options
(their primary + secondary role labels), submitting without picking one
shows the inline error, picking one and submitting saves and closes.
Switch the assignee to a single-role person: field disappears, submit
works with no duty_role required. Delete the test account when done.

- [ ] **Step 7: Commit**

```bash
git add components/shifts/ShiftFormDialog.tsx
git commit -m "feat: add duty-role picker to manager shift form"
```

---

### Task 5: `ShiftRequestDialog.tsx` — self-service duty-role picker

**Files:**
- Modify: `components/shifts/ShiftRequestDialog.tsx`
- Modify: `components/calendar/ShiftCalendar.tsx` (derive + pass down the 2 new values)
- Modify: `components/calendar/CalendarSidebar.tsx` (`SidebarProps` type + pass-through)

**Interfaces:**
- Consumes: `DUTY_ROLES` from `lib/validations/shift.ts` (Task 3),
  `ROLE_LABELS` from `lib/roles.ts`.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Derive the current user's own `secondary_role` in `ShiftCalendar.tsx`**

`branchMembers` (already includes `secondary_role` per Task 2) contains the
viewer's own row. Add this right after the `requestableBranches` `useMemo`
(~line 562):

```ts
const currentUserSecondaryRole = useMemo(
  () => branchMembers.find((m) => m.id === currentUserId)?.secondary_role ?? null,
  [branchMembers, currentUserId]
);
```

Add it to the `sidebarProps` object (~line 667-702), alongside
`currentUserName`:

```ts
currentUserName,
currentUserSecondaryRole,
```

- [ ] **Step 2: Thread it through `CalendarSidebar.tsx`**

Add `Role` to the existing type-only import (~line 39):

```ts
import type { ActionResult, Branch, CustomCalendar, Role } from "@/types";
```

Add to `SidebarProps` (~line 69, right after `currentUserName: string;`):

```ts
currentUserSecondaryRole: Role | null;
```

Add to the destructured props list in `CalendarSidebar` (~line 611, next to
`currentUserName`) and pass it into `ShiftRequestDialog` at its render site
(~line 638):

```tsx
<ShiftRequestDialog
  branches={requestableBranches}
  currentUserRole={currentUserRole}
  currentUserSecondaryRole={currentUserSecondaryRole}
/>
```

Wait — `currentUserRole` isn't currently part of `SidebarProps` at all
(only `currentUserName` is). Add it too, same treatment as
`currentUserSecondaryRole` above (`ShiftCalendar.tsx`'s `sidebarProps`
object, `SidebarProps` type, destructure list) — `ShiftRequestDialog` needs
to know which 2 roles to offer, not just whether the viewer is dual-role.

`CalendarMobileMenu` (same file, ~line 791) takes `props: SidebarProps`
already and is expected to forward to `CalendarSidebar` internally — no
separate edit needed there beyond the type change already covering it;
confirm by reading its body that it does render `<CalendarSidebar
{...props} />` (or equivalent) and doesn't duplicate the `ShiftRequestDialog`
render itself.

- [ ] **Step 3: Add the picker to `ShiftRequestDialog.tsx`**

Widen props and add state:

```ts
import { SHIFT_TYPE_LABELS, detectShiftType } from "@/lib/constants";
import { SHIFT_TYPES, DUTY_ROLES } from "@/lib/validations/shift";
import { ROLE_LABELS } from "@/lib/roles";
import type { Branch, Role, ShiftType } from "@/types";

type DutyRole = (typeof DUTY_ROLES)[number];

export default function ShiftRequestDialog({
  trigger,
  initialRange,
  branches,
  currentUserRole,
  currentUserSecondaryRole,
}: {
  trigger?: React.ReactNode;
  initialRange?: { start: Date; end: Date } | null;
  branches: Branch[];
  currentUserRole: Role;
  currentUserSecondaryRole: Role | null;
}) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [dutyRole, setDutyRole] = useState<DutyRole | "">("");
```

In `handleOpenChange`, reset it alongside the other fields (~line 66-79):

```ts
function handleOpenChange(next: boolean) {
  setOpen(next);
  if (next) {
    setServerError("");
    const base = initialRange?.start ?? new Date();
    const initialStart = initialRange ? format(initialRange.start, TIME_FORMAT) : "09:00";
    setDate(startOfDay(base));
    setStartTime(initialStart);
    setEndTime(initialRange ? format(initialRange.end, TIME_FORMAT) : "11:00");
    setShiftType(detectShiftType(initialStart));
    setBranchId("");
    setDutyRole("");
    setNote("");
  }
}
```

In `onSubmit`, block and send it (~line 81-104):

```ts
async function onSubmit(e: React.FormEvent) {
  e.preventDefault();
  setServerError("");

  if (!branchId) {
    setServerError("Vui lòng chọn cơ sở");
    return;
  }
  if (currentUserSecondaryRole && !dutyRole) {
    setServerError("Vui lòng chọn nhiệm vụ trong ca cho nhân viên kiêm nhiệm này");
    return;
  }

  const startDateTime = parse(startTime, TIME_FORMAT, date);
  const endDateTime = parse(endTime, TIME_FORMAT, date);
  if (endDateTime <= startDateTime) {
    endDateTime.setDate(endDateTime.getDate() + 1);
  }

  setIsSubmitting(true);
  const result = await requestShiftAction({
    start_at: startDateTime.toISOString(),
    end_at: endDateTime.toISOString(),
    branch_id: branchId,
    shift_type: shiftType,
    duty_role: dutyRole || undefined,
    note: note || undefined,
  });
  setIsSubmitting(false);
```

Add the Select, shown only when dual-role, right after the "Cơ sở" block
(~after line 165):

```tsx
{currentUserSecondaryRole && (
  <div className="space-y-1.5">
    <Label htmlFor="request_duty_role">Nhiệm vụ trong ca</Label>
    <Select value={dutyRole} onValueChange={(v) => setDutyRole(v as DutyRole)}>
      <SelectTrigger id="request_duty_role" className="w-full">
        <SelectValue placeholder="Chọn nhiệm vụ" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={currentUserRole}>{ROLE_LABELS[currentUserRole]}</SelectItem>
        <SelectItem value={currentUserSecondaryRole}>{ROLE_LABELS[currentUserSecondaryRole]}</SelectItem>
      </SelectContent>
    </Select>
  </div>
)}
```

- [ ] **Step 4: Verify types, lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Manual browser check**

Log in as the DUAL-pattern test account (create fresh, delete after), open
"Đăng ký ca làm" from the calendar sidebar: confirm the duty-role select
appears with the account's 2 roles, blocks submit when empty, submits fine
when picked. Log in as a single-role account: field doesn't appear, submit
works unchanged.

- [ ] **Step 6: Commit**

```bash
git add components/shifts/ShiftRequestDialog.tsx components/calendar/ShiftCalendar.tsx components/calendar/CalendarSidebar.tsx
git commit -m "feat: add duty-role picker to self-service shift request dialog"
```

---

### Task 6: Display — `ShiftDetailDialog.tsx` and `ShiftsOverviewTable.tsx`

**Files:**
- Modify: `components/shifts/ShiftDetailDialog.tsx`
- Modify: `components/manager/ShiftsOverviewTable.tsx`

**Interfaces:**
- Consumes: `ROLE_LABELS` from `lib/roles.ts`, `shift.duty_role` /
  `row.duty_role` (Task 2's type additions).

- [ ] **Step 1: Show the duty label in `ShiftDetailDialog.tsx`**

In the `DialogHeader` block, right after the existing time-range `<p>`
(~line 93-97):

```tsx
<p className="font-heading text-lg font-semibold tabular-nums">
  {format(new Date(shift.start_at), "h:mm a")}
  <span className="mx-1.5 text-muted-foreground">–</span>
  {format(new Date(shift.end_at), "h:mm a")}
</p>
{shift.duty_role && (
  <p className="text-sm text-muted-foreground">Nhiệm vụ: {ROLE_LABELS[shift.duty_role]}</p>
)}
```

Add `ROLE_LABELS` to the imports from `@/lib/roles` (new import — this file
currently imports from `@/lib/calendar` only for `resolveColor`).

- [ ] **Step 2: Show the duty label in `ShiftsOverviewTable.tsx`**

Find the row-rendering section (per-row assignee name display, both the
mobile card and desktop table row variants documented in the file's own
comment "Same period-tabs-and-search shell as RequestsOverviewTable"), and
append the duty label using the same `· <nhãn>` convention as
`getRoleLabel` elsewhere in this codebase:

```tsx
{row.assignee.full_name}
{row.duty_role && <span className="text-muted-foreground"> · {ROLE_LABELS[row.duty_role]}</span>}
```

Add `ROLE_LABELS` to the existing `@/lib/roles` import (currently only
imports `canCreateShiftFor`).

- [ ] **Step 3: Verify types, lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual browser check**

Open a shift detail for a dual-role person's shift with `duty_role` set —
confirm the label shows. Open the manager dashboard's "Ca làm việc" table —
confirm the same shift's row shows the label too. A shift with no
`duty_role` shows neither line — confirm no empty `·` artifact.

- [ ] **Step 5: Commit**

```bash
git add components/shifts/ShiftDetailDialog.tsx components/manager/ShiftsOverviewTable.tsx
git commit -m "feat: display duty role in shift detail and manager overview"
```

---

### Task 7: Full regression, live verification, deploy

**Files:** none (verification + deploy only).

- [ ] **Step 1: Full regression build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all 3 clean.

- [ ] **Step 2: End-to-end live verification (fresh accounts, anon client, cleaned up after)**

Create: DUAL_TEACHER (`role: 'teacher', secondary_role: 'teaching_assistant'`),
DUAL_SA (`role: 'student_affairs', secondary_role: 'teaching_assistant'`),
MGR_TD (`training_director`), MGR_HR (`hr`), PLAIN_TEACHER (`role: 'teacher'`,
no secondary_role).

1. **Đăng ký ca**: DUAL_TEACHER registers with `duty_role: 'teacher'` →
   MGR_TD approves (succeeds), MGR_HR blocked. DUAL_TEACHER registers again
   with `duty_role: 'teaching_assistant'` → MGR_HR approves (succeeds),
   MGR_TD blocked.
2. **Đổi ca**: create 2 shifts for DUAL_SA, one `duty_role: 'student_affairs'`
   one `duty_role: 'teaching_assistant'` (both routed through HR — expected,
   since both of DUAL_SA's roles are HR-group; use DUAL_TEACHER's
   `teacher`/`teaching_assistant` pair instead to actually see the
   TD-vs-HR split on swap approval). Confirm the swap on the `teacher`-duty
   shift is approvable by MGR_TD, blocked for MGR_HR, and vice versa for
   the `teaching_assistant`-duty shift.
3. **Giải trình công**: submit a correction against a `teaching_assistant`-
   duty shift → MGR_HR approves, MGR_TD blocked.
4. **Đơn nghỉ phép regression**: DUAL_TEACHER submits a leave request →
   confirm MGR_TD can approve it regardless of any `duty_role` anywhere
   (leave has no shift reference) — this must behave byte-for-byte like it
   did before this feature.
5. **Legacy-null regression**: create a shift for PLAIN_TEACHER (no
   `duty_role`, never will be set) → confirm every request type tied to it
   still approves exactly as before (routes by `role`, unaffected by any
   `coalesce`).
6. **ceo/technical regression**: confirm both bypass every check above
   unconditionally, as before.
7. Delete all 5 test profiles via `auth.admin.deleteUser`.

Expected: every check passes exactly as described; any failure means
returning to the relevant task, not patching around it here.

- [ ] **Step 3: Deploy**

```bash
npx supabase db push
npx vercel deploy --prod
```

Expected: migration already applied in Task 1 (this is a no-op confirm —
run anyway in case Task 3's `request_shift` addendum wasn't pushed yet),
Vercel deploy reaches `READY`. If `npx vercel deploy --prod` fails with a
transient `"Not authorized"` error, retry once (established pattern this
session).

- [ ] **Step 4: Report completion**

Summarize what changed and confirm all regression checks passed.
