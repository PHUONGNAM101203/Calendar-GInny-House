# Khôi phục trạng thái đơn (Kỹ thuật) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `technical`-role staff revert leave/shift-request/swap/attendance-correction requests from any resolved status back to `pending`, safely undoing whatever the approval created (a real shift, a swapped assignee, an attendance write) — never silently leaving orphaned or inconsistent data.

**Architecture:** One new Postgres migration adds a traceability column (`shifts.shift_request_id`) and backfills `attendance_corrections.attendance_id` on approval for the `missed_check_in` case, then adds 4 new `revert_*` RPCs (one per entity) — each checks `role = 'technical'` itself (the real security boundary), and each refuses to revert an *approved* request if the thing it created has since been touched (chấm công, đổi ca tiếp, sửa tiếp). A thin `revert*Action` per `actions/*.ts` file calls the RPC. A new `canRevert` prop threads from `app/(app)/manager/page.tsx`'s existing `isTechnical` check → `TechnicalDashboard`/`ManagerDashboard` → `RequestsOverviewTable` → `StaffRequestsDetailDialog` → the 4 Card components, where a new "Khôi phục" button appears only when `canRevert && status !== "pending"`.

**Tech Stack:** Next.js 16 Server Actions, Supabase Postgres RPC (`plpgsql security definer`), React Server/Client Components, shadcn/ui `AlertDialog`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-13-request-status-revert-design.md` — read it once before starting; every task below implements a piece of it.
- Only `role = 'technical'` may call any `revert_*` RPC — checked **inside the RPC**, not just the TS action.
- Content of the reverted request (dates, reason, note...) is never changed — only `status`/`responder_id`/`resolved_at`.
- Revert of an **approved** request must be blocked (clear Vietnamese error, no partial mutation) whenever the downstream data it created has since been touched by anything else — never silently corrupt or cascade-delete unrelated rows.
- No test suite exists in this repo — verification is `npx tsc --noEmit` + `npm run lint` + live-Supabase checks with disposable `auth.admin.createUser` accounts driven through the **anon** client (never service role for the action under test), cleaned up in `finally`. This is the established pattern all session — see any `scratchpad/verify-*.mjs` script for the shape.
- Commit after each task directly on `main` (no worktree) — matches this project's session-long convention. No `Co-Authored-By` trailer.
- Migration number: this plan's migration is `0057_revert_request_status.sql` (last existing is `0056_teaching_assistant_free_clock_in.sql`).

---

### Task 1: Migration — traceability + 4 `revert_*` RPCs

**Files:**
- Create: `supabase/migrations/0057_revert_request_status.sql`

**Interfaces:**
- Produces: RPCs `revert_leave_request(p_id uuid)`, `revert_shift_request(p_id uuid)`, `revert_swap_request(p_id uuid)`, `revert_attendance_correction(p_id uuid)` — all `returns` the entity's own row type, all callable by any `authenticated` user (role check is inside the body), all raise a Vietnamese message and roll back on any guard failure.
- Produces: `shifts.shift_request_id` column (nullable uuid FK to `shift_requests.id`, `on delete set null`), populated by the redefined `respond_to_shift_request` on approval.
- Produces: `attendance_corrections.attendance_id` now populated for **both** `issue_type`s after approval (previously only `late_check_in`) — redefined `respond_to_attendance_correction`.
- Consumes: nothing new — reads existing tables/columns documented in the spec.

- [ ] **Step 1: Write the migration file**

```sql
-- Adds the ability for role='technical' to revert a leave/shift-request/
-- swap/attendance-correction request from any resolved status back to
-- pending, undoing whatever an approval created if that's still safe to
-- undo. See docs/superpowers/specs/2026-08-13-request-status-revert-design.md
-- for the full design and why approving isn't just a status flip for 3 of
-- the 4 entity types.

-- 1. Traceability: which shift did approving THIS shift_request create?
-- Without this, a revert of an approved shift request has no way to find
-- (let alone safely delete) the shift it produced.
alter table public.shifts
  add column if not exists shift_request_id uuid references public.shift_requests(id) on delete set null;

-- 2. respond_to_shift_request: same signature as 0055's version (CREATE OR
-- REPLACE is enough, no DROP needed) — now also stamps shift_request_id.
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

  if not public.can_approve_shift_request(v_req.profile_id) then
    raise exception 'Bạn không có quyền duyệt đăng ký ca này';
  end if;

  if p_approve then
    insert into public.shifts (assignee_id, start_at, end_at, note, created_by, shift_type, branch_id, shift_request_id)
    values (v_req.profile_id, v_req.start_at, v_req.end_at, v_req.note, v_uid, v_req.shift_type, v_req.branch_id, p_id);
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

grant execute on function public.respond_to_shift_request(uuid, boolean) to authenticated;

-- 3. respond_to_attendance_correction: same signature as 0055's version —
-- now backfills attendance_id for the missed_check_in case too (it was
-- only ever populated for late_check_in, at request time).
create or replace function public.respond_to_attendance_correction(p_id uuid, p_approve boolean)
returns public.attendance_corrections
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.attendance_corrections%rowtype;
  v_new_attendance_id uuid;
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
      from public.shifts s where s.id = v_row.shift_id
      returning id into v_new_attendance_id;

      update public.attendance_corrections
      set attendance_id = v_new_attendance_id
      where id = p_id;
      v_row.attendance_id := v_new_attendance_id;
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

-- 4. revert_leave_request: no side effects to undo, ever — trivial.
create or replace function public.revert_leave_request(p_id uuid)
returns public.leave_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.leave_requests%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if (select role from public.profiles where id = v_uid) <> 'technical' then
    raise exception 'Chỉ Kỹ thuật mới có thể khôi phục đơn';
  end if;

  update public.leave_requests
  set status = 'pending', responder_id = null, resolved_at = null
  where id = p_id and status <> 'pending'
  returning * into v_row;

  if not found then
    raise exception 'Đơn không hợp lệ hoặc đang chờ duyệt';
  end if;

  return v_row;
end;
$$;

grant execute on function public.revert_leave_request(uuid) to authenticated;

-- 5. revert_shift_request: if approved, delete the shift it created — but
-- only if nothing has touched that shift since (chấm công, đổi ca, giải
-- trình công đều CASCADE-xoá nếu ta xoá ca mà không kiểm tra trước — xem
-- 0001/0026 cho các ràng buộc FK on delete cascade liên quan). Also refuses
-- to revert data approved BEFORE this migration, since shift_request_id
-- didn't exist yet to link it — silently reverting the request's status
-- while leaving an untracked shift behind would be worse than refusing.
create or replace function public.revert_shift_request(p_id uuid)
returns public.shift_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.shift_requests%rowtype;
  v_shift public.shifts%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if (select role from public.profiles where id = v_uid) <> 'technical' then
    raise exception 'Chỉ Kỹ thuật mới có thể khôi phục đơn';
  end if;

  select * into v_req from public.shift_requests where id = p_id for update;
  if not found or v_req.status = 'pending' then
    raise exception 'Đơn không hợp lệ hoặc đang chờ duyệt';
  end if;

  if v_req.status = 'approved' then
    select * into v_shift from public.shifts where shift_request_id = p_id;
    if not found then
      raise exception 'Đơn duyệt trước khi có tính năng khôi phục — không thể khôi phục tự động' using errcode = '23514';
    end if;

    if v_shift.assignee_id <> v_req.profile_id then
      raise exception 'Ca đã bị đổi cho người khác — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if exists (select 1 from public.attendance where shift_id = v_shift.id) then
      raise exception 'Ca đã có chấm công — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if exists (select 1 from public.shift_swap_requests
               where requester_shift_id = v_shift.id or target_shift_id = v_shift.id) then
      raise exception 'Ca đã liên quan đến yêu cầu đổi ca — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if exists (select 1 from public.attendance_corrections where shift_id = v_shift.id) then
      raise exception 'Ca đã liên quan đến giải trình công — không thể khôi phục tự động' using errcode = '23514';
    end if;

    delete from public.shifts where id = v_shift.id;
  end if;

  update public.shift_requests
  set status = 'pending', responder_id = null, resolved_at = null
  where id = p_id
  returning * into v_req;

  return v_req;
end;
$$;

grant execute on function public.revert_shift_request(uuid) to authenticated;

-- 6. revert_swap_request: if accepted, swap assignee_id back. requester_id/
-- target_id on the row itself already tell us the "before" state — no new
-- column needed. Auto-cancelled sibling swaps (from the original accept's
-- cascade) are deliberately left cancelled — see spec §Phạm vi.
create or replace function public.revert_swap_request(p_request_id uuid)
returns public.shift_swap_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.shift_swap_requests%rowtype;
  v_taker uuid;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if (select role from public.profiles where id = v_uid) <> 'technical' then
    raise exception 'Chỉ Kỹ thuật mới có thể khôi phục đơn';
  end if;

  select * into v_req from public.shift_swap_requests where id = p_request_id for update;
  if not found or v_req.status = 'pending' then
    raise exception 'Đơn không hợp lệ hoặc đang chờ duyệt';
  end if;

  if v_req.status = 'accepted' then
    v_taker := coalesce(v_req.target_id, v_req.responder_id);
    if v_taker is null then
      raise exception 'Không xác định được người đã nhận ca — không thể khôi phục tự động' using errcode = '23514';
    end if;

    if not exists (select 1 from public.shifts where id = v_req.requester_shift_id and assignee_id = v_taker) then
      raise exception 'Ca đã bị thay đổi tiếp — không thể khôi phục tự động' using errcode = '23514';
    end if;

    if v_req.target_shift_id is not null then
      if not exists (select 1 from public.shifts where id = v_req.target_shift_id and assignee_id = v_req.requester_id) then
        raise exception 'Ca đã bị thay đổi tiếp — không thể khôi phục tự động' using errcode = '23514';
      end if;
      update public.shifts set assignee_id = v_req.requester_id where id = v_req.requester_shift_id;
      update public.shifts set assignee_id = v_taker where id = v_req.target_shift_id;
    else
      update public.shifts set assignee_id = v_req.requester_id where id = v_req.requester_shift_id;
    end if;
  end if;

  update public.shift_swap_requests
  set status = 'pending', responder_id = null, resolved_at = null
  where id = p_request_id
  returning * into v_req;

  return v_req;
end;
$$;

grant execute on function public.revert_swap_request(uuid) to authenticated;

-- 7. revert_attendance_correction: if approved, undo the attendance write
-- — delete the inserted row (missed_check_in) or restore the prior
-- check_in_at (late_check_in, using actual_check_in_at already stored at
-- request time). Refuses on data approved before this migration (see
-- respond_to_attendance_correction's backfill above) and whenever the
-- attendance row has since been checked out or touched by another
-- approved correction.
create or replace function public.revert_attendance_correction(p_id uuid)
returns public.attendance_corrections
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.attendance_corrections%rowtype;
  v_att public.attendance%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if (select role from public.profiles where id = v_uid) <> 'technical' then
    raise exception 'Chỉ Kỹ thuật mới có thể khôi phục đơn';
  end if;

  select * into v_row from public.attendance_corrections where id = p_id for update;
  if not found or v_row.status = 'pending' then
    raise exception 'Đơn không hợp lệ hoặc đang chờ duyệt';
  end if;

  if v_row.status = 'approved' then
    if v_row.attendance_id is null then
      raise exception 'Đơn duyệt trước khi có tính năng khôi phục — không thể khôi phục tự động' using errcode = '23514';
    end if;

    select * into v_att from public.attendance where id = v_row.attendance_id;
    if not found then
      raise exception 'Không tìm thấy bản ghi chấm công liên quan — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if v_att.check_out_at is not null then
      raise exception 'Bản ghi chấm công đã có giờ ra — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.attendance_corrections
      where attendance_id = v_row.attendance_id and id <> p_id and status = 'approved'
    ) then
      raise exception 'Bản ghi chấm công đã bị sửa bởi đơn giải trình khác — không thể khôi phục tự động' using errcode = '23514';
    end if;

    if v_row.issue_type = 'missed_check_in' then
      delete from public.attendance where id = v_row.attendance_id;
    else
      update public.attendance set check_in_at = v_row.actual_check_in_at where id = v_row.attendance_id;
    end if;
  end if;

  update public.attendance_corrections
  set status = 'pending', responder_id = null, resolved_at = null
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.revert_attendance_correction(uuid) to authenticated;
```

- [ ] **Step 2: Push the migration to the linked Supabase project**

Run: `npx supabase db push`
Expected: `0057_revert_request_status.sql` applied cleanly, no errors. If it fails partway, Postgres rolls the whole file back automatically (single transaction) — fix and re-run, do not hand-edit remote state.

- [ ] **Step 3: Sanity-check the new column and functions exist**

Run:
```bash
npx supabase db execute --sql "select column_name from information_schema.columns where table_name = 'shifts' and column_name = 'shift_request_id';"
npx supabase db execute --sql "select proname from pg_proc where proname like 'revert_%request%';"
```
Expected: first query returns one row (`shift_request_id`); second returns `revert_leave_request`, `revert_shift_request`, `revert_swap_request`, `revert_attendance_correction`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0057_revert_request_status.sql
git commit -m "feat: add technical-only request status revert RPCs"
```

---

### Task 2: `actions/leave.ts` — `revertLeaveRequestAction`

**Files:**
- Modify: `actions/leave.ts`

**Interfaces:**
- Consumes: RPC `revert_leave_request(p_id uuid)` from Task 1.
- Produces: `revertLeaveRequestAction(requestId: string): Promise<ActionResult>` — consumed by Task 6 (`LeaveRequestCard.tsx`).

- [ ] **Step 1: Add the two new RPC error messages to `mapLeaveError`'s known list**

In `actions/leave.ts`, edit the `known` array inside `mapLeaveError` (currently ends `"Không thể huỷ đơn này",`):

```ts
function mapLeaveError(message: string): string {
  const known = [
    "Bạn chưa được gán cơ sở làm việc",
    "Ngày kết thúc phải sau ngày bắt đầu",
    "Đến muộn / về sớm / nghỉ theo giờ chỉ áp dụng cho 1 ngày",
    "Vui lòng chọn giờ có mặt",
    "Vui lòng chọn giờ rời đi",
    "Vui lòng chọn giờ bắt đầu và kết thúc",
    "Chỉ quản lý mới được duyệt đơn nghỉ phép",
    "Bạn không có quyền duyệt đơn của nhân viên này",
    "Đơn nghỉ phép không hợp lệ hoặc đã được xử lý",
    "Không thể huỷ đơn này",
    "Chỉ Kỹ thuật mới có thể khôi phục đơn",
    "Đơn không hợp lệ hoặc đang chờ duyệt",
  ];
  return known.find((m) => message.includes(m)) ?? "Không thể xử lý đơn nghỉ phép";
}
```

- [ ] **Step 2: Add `revertLeaveRequestAction`**

Append at the end of `actions/leave.ts`, after `deleteLeaveRequestAction`:

```ts
// Technical-only: undoes an accidental Từ chối/Huỷ/Duyệt click, back to
// pending, content unchanged. The real gate is inside revert_leave_request
// itself (role = 'technical') — requireProfile() here is just the minimal
// "must be logged in" guard, same as respondToLeaveRequestAction.
export async function revertLeaveRequestAction(requestId: string): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revert_leave_request", { p_id: requestId });

  if (error) return { ok: false, error: mapLeaveError(error.message) };

  revalidateLeavePaths();
  return { ok: true, data: undefined };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add actions/leave.ts
git commit -m "feat: add revertLeaveRequestAction"
```

---

### Task 3: `actions/shift-requests.ts` — `revertShiftRequestAction`

**Files:**
- Modify: `actions/shift-requests.ts`

**Interfaces:**
- Consumes: RPC `revert_shift_request(p_id uuid)` from Task 1.
- Produces: `revertShiftRequestAction(id: string): Promise<ActionResult>` — consumed by Task 6 (`ShiftRequestCard.tsx`).

- [ ] **Step 1: Add the new RPC error messages to `SHIFT_RPC_MESSAGES`**

In `actions/shift-requests.ts`, edit `SHIFT_RPC_MESSAGES` (currently ends `"Đã có quản sinh khác trực ca bắt đầu cùng giờ này",`):

```ts
const SHIFT_RPC_MESSAGES = [
  "Chưa đăng nhập",
  "Đơn đăng ký không còn hiệu lực",
  "Bạn không có quyền duyệt đăng ký ca này",
  "Không thể huỷ đơn này",
  "Nhân viên chưa được gán cơ sở",
  "Giờ kết thúc phải sau giờ bắt đầu",
  "Vui lòng chọn cơ sở",
  "Đã có quản sinh khác trực ca bắt đầu cùng giờ này",
  "Chỉ Kỹ thuật mới có thể khôi phục đơn",
  "Đơn không hợp lệ hoặc đang chờ duyệt",
  "Ca đã có chấm công — không thể khôi phục tự động",
  "Ca đã bị đổi cho người khác — không thể khôi phục tự động",
  "Ca đã liên quan đến yêu cầu đổi ca — không thể khôi phục tự động",
  "Ca đã liên quan đến giải trình công — không thể khôi phục tự động",
  "Đơn duyệt trước khi có tính năng khôi phục — không thể khôi phục tự động",
];
```

- [ ] **Step 2: Add `revertShiftRequestAction`**

Append at the end of `actions/shift-requests.ts`, after `deleteShiftRequestAction`:

```ts
// Technical-only: undoes an accidental Từ chối/Huỷ/Duyệt click. If the
// request was approved, revert_shift_request also deletes the shift it
// created — but only if nothing has touched that shift since (see the RPC
// for the exact guards). requireProfile() is the minimal guard; the real
// role check lives in the RPC.
export async function revertShiftRequestAction(id: string): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revert_shift_request", { p_id: id });

  if (error) {
    return { ok: false, error: mapShiftRpcError(error.message, "Không thể khôi phục đăng ký ca này") };
  }

  revalidateShiftRequestPaths();
  return { ok: true, data: undefined };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add actions/shift-requests.ts
git commit -m "feat: add revertShiftRequestAction"
```

---

### Task 4: `actions/swaps.ts` — `revertSwapRequestAction`

**Files:**
- Modify: `actions/swaps.ts`

**Interfaces:**
- Consumes: RPC `revert_swap_request(p_request_id uuid)` from Task 1.
- Produces: `revertSwapRequestAction(requestId: string): Promise<ActionResult>` — consumed by Task 6 (`SwapRequestCard.tsx`).

- [ ] **Step 1: Add the new RPC error messages to `mapSwapError`'s known list**

In `actions/swaps.ts`, edit the `known` array inside `mapSwapError` (currently ends `"Không có quyền huỷ yêu cầu này",`):

```ts
function mapSwapError(message: string): string {
  const known = [
    "Bạn chỉ có thể yêu cầu đổi ca của chính mình",
    "Không thể đổi ca đã bắt đầu",
    "Ca này đã có yêu cầu đổi đang chờ",
    "Đồng nghiệp không thuộc cơ sở của bạn",
    "Ca được chọn không hợp lệ",
    "Không thể đổi ca với chính mình",
    "Yêu cầu không còn hiệu lực",
    "Yêu cầu không thuộc cơ sở của bạn",
    "Bạn không phải người được yêu cầu",
    "Không thể tự nhận ca của mình",
    "Ca gốc đã thay đổi, yêu cầu không còn hợp lệ",
    "Ca đối ứng đã thay đổi, yêu cầu không còn hợp lệ",
    "Không có quyền huỷ yêu cầu này",
    "Chỉ Kỹ thuật mới có thể khôi phục đơn",
    "Đơn không hợp lệ hoặc đang chờ duyệt",
    "Không xác định được người đã nhận ca — không thể khôi phục tự động",
    "Ca đã bị thay đổi tiếp — không thể khôi phục tự động",
  ];
  return known.find((m) => message.includes(m)) ?? "Không thể thực hiện yêu cầu đổi ca";
}
```

- [ ] **Step 2: Add `revertSwapRequestAction`**

Append at the end of `actions/swaps.ts`, after `deleteSwapRequestAction`:

```ts
// Technical-only: undoes an accidental Từ chối/Huỷ/Đồng ý click. If the
// swap was accepted, revert_swap_request also swaps assignee_id back on
// the shift(s) involved — but only if neither shift has been reassigned
// again since. Auto-cancelled sibling swaps from the original accept's
// cascade are deliberately left cancelled (see design spec §Phạm vi).
export async function revertSwapRequestAction(requestId: string): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revert_swap_request", { p_request_id: requestId });

  if (error) return { ok: false, error: mapSwapError(error.message) };

  revalidateSwapPaths();
  return { ok: true, data: undefined };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add actions/swaps.ts
git commit -m "feat: add revertSwapRequestAction"
```

---

### Task 5: `actions/attendance-corrections.ts` — `revertAttendanceCorrectionAction`

**Files:**
- Modify: `actions/attendance-corrections.ts`

**Interfaces:**
- Consumes: RPC `revert_attendance_correction(p_id uuid)` from Task 1.
- Produces: `revertAttendanceCorrectionAction(id: string): Promise<ActionResult>` — consumed by Task 6 (`AttendanceCorrectionCard.tsx`).

- [ ] **Step 1: Add the new RPC error messages to `mapAttendanceCorrectionError`'s known list**

In `actions/attendance-corrections.ts`, edit the `known` array (currently ends `"Không thể huỷ đơn này",`):

```ts
function mapAttendanceCorrectionError(message: string): string {
  const known = [
    "Không tìm thấy ca làm việc này",
    "Đã quá hạn 1 tuần để giải trình ca này",
    "Ca này không có sai lệch cần giải trình",
    "Ca này đã có đơn giải trình đang chờ duyệt",
    "Vui lòng nhập lý do giải trình",
    "Chỉ quản lý mới được duyệt đơn giải trình công",
    "Bạn không có quyền duyệt đơn của nhân viên này",
    "Đơn giải trình công không hợp lệ hoặc đã được xử lý",
    "Không thể huỷ đơn này",
    "Chỉ Kỹ thuật mới có thể khôi phục đơn",
    "Đơn không hợp lệ hoặc đang chờ duyệt",
    "Đơn duyệt trước khi có tính năng khôi phục — không thể khôi phục tự động",
    "Không tìm thấy bản ghi chấm công liên quan — không thể khôi phục tự động",
    "Bản ghi chấm công đã có giờ ra — không thể khôi phục tự động",
    "Bản ghi chấm công đã bị sửa bởi đơn giải trình khác — không thể khôi phục tự động",
  ];
  return known.find((m) => message.includes(m)) ?? "Không thể xử lý đơn giải trình công";
}
```

- [ ] **Step 2: Add `revertAttendanceCorrectionAction`**

Append after `cancelAttendanceCorrectionAction` (before `getAttendanceCorrectionPreviewAction`):

```ts
// Technical-only: undoes an accidental Từ chối/Huỷ/Duyệt click. If the
// correction was approved, revert_attendance_correction also undoes the
// attendance write it made — deleting the inserted row (missed_check_in)
// or restoring the prior check_in_at (late_check_in) — but only if that
// attendance row hasn't since been checked out or touched by another
// approved correction.
export async function revertAttendanceCorrectionAction(id: string): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revert_attendance_correction", { p_id: id });

  if (error) return { ok: false, error: mapAttendanceCorrectionError(error.message) };

  revalidateAttendanceCorrectionPaths();
  return { ok: true, data: undefined };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add actions/attendance-corrections.ts
git commit -m "feat: add revertAttendanceCorrectionAction"
```

---

### Task 6: `canRevert` button on all 4 Card components

**Files:**
- Modify: `components/leave/LeaveRequestCard.tsx`
- Modify: `components/shifts/ShiftRequestCard.tsx`
- Modify: `components/swaps/SwapRequestCard.tsx`
- Modify: `components/attendance/AttendanceCorrectionCard.tsx`

**Interfaces:**
- Consumes: `revertLeaveRequestAction`/`revertShiftRequestAction`/`revertSwapRequestAction`/`revertAttendanceCorrectionAction` from Tasks 2–5.
- Produces: each Card gains a required `canRevert: boolean` prop. Button renders when `canRevert && request.status !== "pending"`. Consumed by Task 7 (`StaffRequestsDetailDialog.tsx`) and Task 8 (`app/(app)/manager/page.tsx`'s other 3 call sites of each card, which will pass `canRevert={false}`).

- [ ] **Step 1: `LeaveRequestCard.tsx`**

Edit the import line:
```tsx
import { cancelLeaveRequestAction, respondToLeaveRequestAction, deleteLeaveRequestAction, revertLeaveRequestAction } from "@/actions/leave";
```

Edit the props type/destructure (add `canRevert`):
```tsx
export default function LeaveRequestCard({
  request,
  canRespond,
  canCancel,
  canDelete,
  canRevert,
  showName,
}: {
  request: LeaveRequestDetailed;
  canRespond: boolean;
  canCancel: boolean;
  canDelete: boolean;
  canRevert: boolean;
  showName: boolean;
}) {
```

Add a handler, right after `handleDelete`:
```tsx
  async function handleRevert() {
    setPending(true);
    const result = await revertLeaveRequestAction(request.id);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Đã khôi phục đơn nghỉ phép về chờ duyệt");
  }
```

Add the button JSX, right after the `canDelete` block's closing `)}`:
```tsx
          {canRevert && request.status !== "pending" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={pending}>
                  Khôi phục
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Khôi phục đơn nghỉ phép?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Đơn sẽ quay lại trạng thái Chờ duyệt, nội dung giữ nguyên.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Huỷ</AlertDialogCancel>
                  <AlertDialogAction onClick={handleRevert}>Khôi phục</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
```

- [ ] **Step 2: `ShiftRequestCard.tsx`**

Edit the import:
```tsx
import {
  cancelShiftRequestAction,
  respondToShiftRequestAction,
  deleteShiftRequestAction,
  revertShiftRequestAction,
} from "@/actions/shift-requests";
```

Edit props (add `canRevert: boolean;` to both the destructure and the type, same position as Task 6 Step 1).

Add handler after `handleDelete`:
```tsx
  async function handleRevert() {
    setPending(true);
    const result = await revertShiftRequestAction(request.id);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Đã khôi phục đăng ký ca làm về chờ duyệt");
  }
```

Add button after the `canDelete` block:
```tsx
          {canRevert && request.status !== "pending" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={pending}>
                  Khôi phục
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Khôi phục đăng ký ca làm?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Đơn sẽ quay lại trạng thái Chờ duyệt. Nếu đơn đang Đã duyệt, ca đã tạo sẽ bị
                    xoá — trừ khi ca đó đã có chấm công hoặc đã bị đổi ca, thì thao tác sẽ bị chặn.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Huỷ</AlertDialogCancel>
                  <AlertDialogAction onClick={handleRevert}>Khôi phục</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
```

- [ ] **Step 3: `SwapRequestCard.tsx`**

Edit the import:
```tsx
import {
  cancelSwapRequestAction,
  respondToSwapRequestAction,
  deleteSwapRequestAction,
  revertSwapRequestAction,
} from "@/actions/swaps";
```

Edit props (add `canRevert: boolean;` — note this component has no `showName` prop, don't add one):
```tsx
export default function SwapRequestCard({
  request,
  canRespond,
  canCancel,
  canDelete,
  canRevert,
}: {
  request: SwapRequestDetailed;
  canRespond: boolean;
  canCancel: boolean;
  canDelete: boolean;
  canRevert: boolean;
}) {
```

Add handler after `handleDelete`:
```tsx
  async function handleRevert() {
    setPending(true);
    const result = await revertSwapRequestAction(request.id);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Đã khôi phục yêu cầu đổi ca về chờ duyệt");
  }
```

Add button after the `canDelete` block:
```tsx
          {canRevert && request.status !== "pending" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={pending}>
                  Khôi phục
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Khôi phục yêu cầu đổi ca?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Yêu cầu sẽ quay lại trạng thái Chờ duyệt. Nếu đã chấp nhận, ca sẽ được trả lại
                    đúng người cũ — trừ khi ca đó đã bị thay đổi tiếp, thì thao tác sẽ bị chặn.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Huỷ</AlertDialogCancel>
                  <AlertDialogAction onClick={handleRevert}>Khôi phục</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
```

- [ ] **Step 4: `AttendanceCorrectionCard.tsx`**

Edit the import:
```tsx
import {
  cancelAttendanceCorrectionAction,
  respondToAttendanceCorrectionAction,
  deleteAttendanceCorrectionAction,
  revertAttendanceCorrectionAction,
} from "@/actions/attendance-corrections";
```

Edit props (add `canRevert: boolean;`, same position/pattern as Step 1).

Add handler after `handleDelete`:
```tsx
  async function handleRevert() {
    setPending(true);
    const result = await revertAttendanceCorrectionAction(request.id);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Đã khôi phục đơn giải trình công về chờ duyệt");
  }
```

Add button after the `canDelete` block:
```tsx
          {canRevert && request.status !== "pending" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={pending}>
                  Khôi phục
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Khôi phục đơn giải trình công?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Đơn sẽ quay lại trạng thái Chờ duyệt. Nếu đã duyệt, bản ghi chấm công liên
                    quan sẽ được hoàn tác — trừ khi đã chấm ra hoặc bị sửa tiếp, thì thao tác sẽ
                    bị chặn.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Huỷ</AlertDialogCancel>
                  <AlertDialogAction onClick={handleRevert}>Khôi phục</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
```

- [ ] **Step 5: Typecheck (expect errors — call sites not updated yet)**

Run: `npx tsc --noEmit`
Expected: errors in `components/manager/StaffRequestsDetailDialog.tsx` and `app/(app)/manager/page.tsx` ("Property 'canRevert' is missing") — these are fixed in Tasks 7–8. This step is just to confirm the 4 Cards themselves compile with no *other* errors.

- [ ] **Step 6: Commit**

```bash
git add components/leave/LeaveRequestCard.tsx components/shifts/ShiftRequestCard.tsx components/swaps/SwapRequestCard.tsx components/attendance/AttendanceCorrectionCard.tsx
git commit -m "feat: add Khôi phục button to all 4 request cards"
```

---

### Task 7: Thread `canRevert` through `StaffRequestsDetailDialog` and `RequestsOverviewTable`

**Files:**
- Modify: `components/manager/StaffRequestsDetailDialog.tsx`
- Modify: `components/manager/RequestsOverviewTable.tsx`

**Interfaces:**
- Consumes: `canRevert` prop on the 4 Cards from Task 6.
- Produces: `StaffRequestsDetailDialog` gains a required `canRevert: boolean` prop, passed to all 4 Cards it renders. `RequestsOverviewTable` gains a required `canRevert: boolean` prop, passed straight through to `StaffRequestsDetailDialog`. Consumed by Task 8 (`TechnicalDashboard.tsx` passes `true`, `ManagerDashboard.tsx` passes `false`).

- [ ] **Step 1: `StaffRequestsDetailDialog.tsx` — add the prop and wire it into all 4 Cards**

Edit the props type/destructure:
```tsx
export default function StaffRequestsDetailDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  period,
  leaveRequests,
  swapRequests,
  shiftRequests,
  attendanceCorrections,
  canRevert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  employeeName: string;
  period: OverviewPeriod;
  leaveRequests: LeaveRequestDetailed[];
  swapRequests: SwapRequestDetailed[];
  shiftRequests: ShiftRequestDetailed[];
  attendanceCorrections: AttendanceCorrectionDetailed[];
  canRevert: boolean;
}) {
```

Change each of the 4 Card renders from `canDelete={false}` to add `canRevert={canRevert}` right after it — e.g. for `LeaveRequestCard`:
```tsx
          <LeaveRequestCard
            key={r.id}
            request={r}
            canRespond={false}
            canCancel={false}
            canDelete={false}
            canRevert={canRevert}
            showName={false}
          />
```
Apply the same `canRevert={canRevert}` addition (right after `canDelete={false}`) to the `SwapRequestCard`, `ShiftRequestCard`, and `AttendanceCorrectionCard` renders in this file.

- [ ] **Step 2: `RequestsOverviewTable.tsx` — add the prop and pass it through**

Edit the props type/destructure:
```tsx
export default function RequestsOverviewTable({
  title = "Tổng hợp đơn đã gửi",
  staff,
  leaveRequests,
  swapRequests,
  shiftRequests,
  attendanceCorrections,
  canRevert,
}: {
  title?: string;
  staff: Pick<Profile, "id" | "full_name" | "role" | "secondary_role">[];
  leaveRequests: LeaveRequestDetailed[];
  swapRequests: SwapRequestDetailed[];
  shiftRequests: ShiftRequestDetailed[];
  attendanceCorrections: AttendanceCorrectionDetailed[];
  canRevert: boolean;
}) {
```

Edit the `<StaffRequestsDetailDialog>` render to pass it through:
```tsx
        <StaffRequestsDetailDialog
          key={`${selectedEmployee.id}-${period}`}
          open={Boolean(selectedEmployee)}
          onOpenChange={(next) => {
            if (!next) setSelectedEmployee(null);
          }}
          employeeId={selectedEmployee.id}
          employeeName={selectedEmployee.fullName}
          period={period}
          leaveRequests={leaveRequests}
          swapRequests={swapRequests}
          shiftRequests={shiftRequests}
          attendanceCorrections={attendanceCorrections}
          canRevert={canRevert}
        />
```

- [ ] **Step 3: Typecheck (expect errors — the 2 dashboard call sites not updated yet)**

Run: `npx tsc --noEmit`
Expected: errors in `components/manager/TechnicalDashboard.tsx` and `components/manager/ManagerDashboard.tsx` ("Property 'canRevert' is missing" on their `<RequestsOverviewTable>` calls) — fixed in Task 8.

- [ ] **Step 4: Commit**

```bash
git add components/manager/StaffRequestsDetailDialog.tsx components/manager/RequestsOverviewTable.tsx
git commit -m "feat: thread canRevert through StaffRequestsDetailDialog"
```

---

### Task 8: Wire `canRevert` at the two dashboard call sites

**Files:**
- Modify: `components/manager/TechnicalDashboard.tsx`
- Modify: `components/manager/ManagerDashboard.tsx`
- Modify: `app/(app)/manager/page.tsx`

**Interfaces:**
- Consumes: `canRevert` prop on `RequestsOverviewTable` from Task 7; `canRevert` prop on the 4 Cards from Task 6.
- Produces: fully working end-to-end feature — `technical` sees the button everywhere requests are shown, no one else does.

- [ ] **Step 1: `TechnicalDashboard.tsx` — pass `canRevert={true}`**

This component only ever renders when `isTechnical` (gated in `app/(app)/manager/page.tsx`), so this is a hardcoded `true`, not a new prop on `TechnicalDashboard` itself. Edit its `<RequestsOverviewTable>` call:
```tsx
          <RequestsOverviewTable
            title="Tổng hợp đơn đã gửi — Toàn hệ thống"
            staff={staff}
            leaveRequests={leaveRequests}
            swapRequests={swapRequests}
            shiftRequests={shiftRequests}
            attendanceCorrections={attendanceCorrections}
            canRevert={true}
          />
```

- [ ] **Step 2: `ManagerDashboard.tsx` — pass `canRevert={false}`**

This component renders for every non-technical manager tier — explicit `false`, not a prop, since non-technical managers must never see the button. Edit its `<RequestsOverviewTable>` call:
```tsx
          <RequestsOverviewTable
            staff={staff}
            leaveRequests={leaveRequests}
            swapRequests={swapRequests}
            shiftRequests={shiftRequests}
            attendanceCorrections={attendanceCorrections}
            canRevert={false}
          />
```

- [ ] **Step 3: `app/(app)/manager/page.tsx` — pass `canRevert={false}` at the other 4 Card render sites**

The page renders `ShiftRequestCard`, `SwapRequestCard`, `LeaveRequestCard`, `AttendanceCorrectionCard` directly (not through the dialog) in the "Đăng ký ca"/"Yêu cầu đổi ca"/"Nghỉ phép"/"Giải trình công" sections — these already only show `canCancel={r.status === "pending"}` etc. and must keep NOT offering revert (revert only lives inside the technical-only detail dialog, per the approved design). Add `canRevert={false}` to each of the 4 Card renders in this file:

- `ShiftRequestCard` (currently ends `canDelete={... }` then `showName`): add `canRevert={false}` right after the `canDelete` line.
- `SwapRequestCard` (currently ends `canDelete={...}`): add `canRevert={false}` right after.
- `LeaveRequestCard` (currently ends `canDelete={...}` then `showName`): add `canRevert={false}` right after the `canDelete` line.
- `AttendanceCorrectionCard` (currently ends `canDelete={...}` then `showName`): add `canRevert={false}` right after the `canDelete` line.

- [ ] **Step 4: Typecheck — must be clean now**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: 0 errors, 0 new warnings.

- [ ] **Step 6: Commit**

```bash
git add components/manager/TechnicalDashboard.tsx components/manager/ManagerDashboard.tsx "app/(app)/manager/page.tsx"
git commit -m "feat: wire canRevert=technical-only at all Card render sites"
```

---

### Task 9: End-to-end verification against live Supabase + deploy

**Files:**
- Create (scratch, not committed): `/private/tmp/claude-501/-Users-phuongnam-Documents-Calendar-GInny-House/08b56aa0-845e-4b40-bc28-2976704760d0/scratchpad/verify-revert.mjs`

**Interfaces:**
- Consumes: all 4 `revert_*` RPCs (Task 1), all 4 `revert*Action`s (Tasks 2–5).
- Produces: nothing new — this is the verification gate before deploy.

- [ ] **Step 1: Write the verification script**

```js
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PW = "Test1234!verify";
const failures = [];
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name}  ${detail}`); failures.push(name); }
}

const created = [];
async function makeUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (error) throw error;
  created.push(data.user.id);
  await admin.from("profiles").update({ role, full_name: email.split("@")[0] }).eq("id", data.user.id);
  return data.user.id;
}
function anonClientAs(userId) {
  // Sign in via a fresh client so RLS/RPC runs as this user, not service role.
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
async function signedIn(email) {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { error } = await client.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
  return client;
}

const ts = Date.now();
const techEmail = `revert-tech-${ts}@example.com`;
const nonTechEmail = `revert-mgr-${ts}@example.com`;
const staffEmail = `revert-staff-${ts}@example.com`;

try {
  const { data: branches } = await admin.from("branches").select("id, name").limit(1);
  const branchId = branches[0].id;

  const techId = await makeUser(techEmail, "technical");
  const mgrId = await makeUser(nonTechEmail, "training_director");
  const staffId = await makeUser(staffEmail, "teacher");
  for (const id of [techId, mgrId, staffId]) {
    await admin.from("profile_branches").insert({ profile_id: id, branch_id: branchId });
  }

  const techClient = await signedIn(techEmail);
  const mgrClient = await signedIn(nonTechEmail);

  console.log("\n=== 1. Role gate: non-technical cannot call revert RPCs ===");
  {
    const { data: leave } = await admin
      .from("leave_requests")
      .insert({ profile_id: staffId, branch_id: branchId, start_date: "2026-09-01", end_date: "2026-09-01", request_type: "full_day", status: "rejected" })
      .select()
      .single();
    const { error } = await mgrClient.rpc("revert_leave_request", { p_id: leave.id });
    check("non-technical blocked from revert_leave_request", !!error && error.message.includes("Chỉ Kỹ thuật"), error?.message);
    await admin.from("leave_requests").delete().eq("id", leave.id);
  }

  console.log("\n=== 2. Leave request: rejected -> revert -> pending, content unchanged ===");
  {
    const { data: leave } = await admin
      .from("leave_requests")
      .insert({ profile_id: staffId, branch_id: branchId, start_date: "2026-09-02", end_date: "2026-09-02", request_type: "full_day", status: "rejected", reason: "kiểm tra" })
      .select()
      .single();
    const { data, error } = await techClient.rpc("revert_leave_request", { p_id: leave.id });
    check("leave revert succeeds", !error, error?.message);
    check("leave status back to pending", data?.status === "pending");
    check("leave content unchanged", data?.reason === "kiểm tra" && data?.start_date === "2026-09-02");
    await admin.from("leave_requests").delete().eq("id", leave.id);
  }

  console.log("\n=== 3. Shift request: approved -> revert -> shift deleted, request pending ===");
  {
    const { data: req } = await admin
      .from("shift_requests")
      .insert({ profile_id: staffId, branch_id: branchId, start_at: "2026-09-03T01:00:00Z", end_at: "2026-09-03T04:00:00Z", shift_type: "morning", status: "pending" })
      .select()
      .single();
    // Approving via the real RPC requires a caller whose group_permissions
    // grant approve_shift_request for this staff role, which varies by org
    // config — set up the "approved with a linked shift" fixture directly
    // via admin instead, matching exactly what respond_to_shift_request
    // itself would have produced (same columns, same shift_request_id link).
    await admin.from("shift_requests").update({ status: "approved" }).eq("id", req.id);
    await admin.from("shifts").insert({
      assignee_id: staffId, branch_id: branchId, start_at: "2026-09-03T01:00:00Z", end_at: "2026-09-03T04:00:00Z",
      shift_type: "morning", shift_request_id: req.id,
    });
    const { data: revertData, error: revertError } = await techClient.rpc("revert_shift_request", { p_id: req.id });
    check("shift request revert succeeds", !revertError, revertError?.message);
    check("shift request back to pending", revertData?.status === "pending");
    const { data: shiftAfter } = await admin.from("shifts").select("id").eq("shift_request_id", req.id).maybeSingle();
    check("created shift was deleted", !shiftAfter);
    await admin.from("shift_requests").delete().eq("id", req.id);
  }

  console.log("\n=== 4. Shift request: approved + already has attendance -> revert blocked ===");
  {
    const { data: req } = await admin
      .from("shift_requests")
      .insert({ profile_id: staffId, branch_id: branchId, start_at: "2026-09-04T01:00:00Z", end_at: "2026-09-04T04:00:00Z", shift_type: "morning", status: "approved" })
      .select()
      .single();
    const { data: shift } = await admin
      .from("shifts")
      .insert({ assignee_id: staffId, branch_id: branchId, start_at: "2026-09-04T01:00:00Z", end_at: "2026-09-04T04:00:00Z", shift_type: "morning", shift_request_id: req.id })
      .select()
      .single();
    await admin.from("attendance").insert({ profile_id: staffId, branch_id: branchId, shift_id: shift.id, check_in_at: "2026-09-04T01:05:00Z" });
    const { error } = await techClient.rpc("revert_shift_request", { p_id: req.id });
    check("blocked when shift has attendance", !!error && error.message.includes("đã có chấm công"), error?.message);
    await admin.from("attendance").delete().eq("shift_id", shift.id);
    await admin.from("shifts").delete().eq("id", shift.id);
    await admin.from("shift_requests").delete().eq("id", req.id);
  }

  console.log("\n=== 5. Attendance correction: missed_check_in approved -> revert -> attendance row deleted ===");
  {
    const { data: shift } = await admin
      .from("shifts")
      .insert({ assignee_id: staffId, branch_id: branchId, start_at: "2026-09-05T01:00:00Z", end_at: "2026-09-05T04:00:00Z", shift_type: "morning" })
      .select()
      .single();
    const { data: corr } = await admin
      .from("attendance_corrections")
      .insert({ profile_id: staffId, shift_id: shift.id, issue_type: "missed_check_in", requested_check_in_at: "2026-09-05T01:00:00Z", reason: "kiểm tra", status: "pending" })
      .select()
      .single();
    // training_director is a valid is_leave_approver() role — approve through
    // the real RPC as that user so attendance_id gets backfilled exactly as
    // production would.
    const { error: approveError } = await mgrClient.rpc("respond_to_attendance_correction", { p_id: corr.id, p_approve: true });
    check("correction approved", !approveError, approveError?.message);
    const { data: corrAfterApprove } = await admin.from("attendance_corrections").select("attendance_id").eq("id", corr.id).single();
    check("attendance_id backfilled on approve", !!corrAfterApprove.attendance_id);

    const { data: revertData, error: revertError } = await techClient.rpc("revert_attendance_correction", { p_id: corr.id });
    check("correction revert succeeds", !revertError, revertError?.message);
    check("correction back to pending", revertData?.status === "pending");
    const { data: attAfter } = await admin.from("attendance").select("id").eq("id", corrAfterApprove.attendance_id).maybeSingle();
    check("inserted attendance row was deleted", !attAfter);

    await admin.from("attendance_corrections").delete().eq("id", corr.id);
    await admin.from("shifts").delete().eq("id", shift.id);
  }

  console.log("\n=== 6. Attendance correction: attendance already checked out -> revert blocked ===");
  {
    const { data: shift } = await admin
      .from("shifts")
      .insert({ assignee_id: staffId, branch_id: branchId, start_at: "2026-09-06T01:00:00Z", end_at: "2026-09-06T04:00:00Z", shift_type: "morning" })
      .select()
      .single();
    const { data: att } = await admin
      .from("attendance")
      .insert({ profile_id: staffId, branch_id: branchId, shift_id: shift.id, check_in_at: "2026-09-06T01:30:00Z", check_out_at: "2026-09-06T04:00:00Z" })
      .select()
      .single();
    const { data: corr } = await admin
      .from("attendance_corrections")
      .insert({
        profile_id: staffId, shift_id: shift.id, attendance_id: att.id, issue_type: "late_check_in",
        actual_check_in_at: "2026-09-06T01:30:00Z", requested_check_in_at: "2026-09-06T01:00:00Z",
        reason: "kiểm tra", status: "approved",
      })
      .select()
      .single();
    const { error } = await techClient.rpc("revert_attendance_correction", { p_id: corr.id });
    check("blocked when attendance already checked out", !!error && error.message.includes("đã có giờ ra"), error?.message);
    await admin.from("attendance_corrections").delete().eq("id", corr.id);
    await admin.from("attendance").delete().eq("id", att.id);
    await admin.from("shifts").delete().eq("id", shift.id);
  }

  console.log("\n=== 7. Attendance correction: late_check_in approved -> revert -> check_in_at restored ===");
  {
    const { data: shift } = await admin
      .from("shifts")
      .insert({ assignee_id: staffId, branch_id: branchId, start_at: "2026-09-07T01:00:00Z", end_at: "2026-09-07T04:00:00Z", shift_type: "morning" })
      .select()
      .single();
    const { data: att } = await admin
      .from("attendance")
      .insert({ profile_id: staffId, branch_id: branchId, shift_id: shift.id, check_in_at: "2026-09-07T01:30:00Z" })
      .select()
      .single();
    const { data: corr } = await admin
      .from("attendance_corrections")
      .insert({
        profile_id: staffId, shift_id: shift.id, attendance_id: att.id, issue_type: "late_check_in",
        actual_check_in_at: "2026-09-07T01:30:00Z", requested_check_in_at: "2026-09-07T01:00:00Z",
        reason: "kiểm tra", status: "pending",
      })
      .select()
      .single();
    const { error: approveError } = await mgrClient.rpc("respond_to_attendance_correction", { p_id: corr.id, p_approve: true });
    check("late_check_in correction approved", !approveError, approveError?.message);
    const { data: attAfterApprove } = await admin.from("attendance").select("check_in_at").eq("id", att.id).single();
    check("check_in_at moved to requested value on approve", attAfterApprove.check_in_at.startsWith("2026-09-07T01:00:00"));

    const { data: revertData, error: revertError } = await techClient.rpc("revert_attendance_correction", { p_id: corr.id });
    check("late_check_in correction revert succeeds", !revertError, revertError?.message);
    check("correction back to pending", revertData?.status === "pending");
    const { data: attAfterRevert } = await admin.from("attendance").select("check_in_at").eq("id", att.id).single();
    check("check_in_at restored to actual_check_in_at", attAfterRevert.check_in_at.startsWith("2026-09-07T01:30:00"));

    await admin.from("attendance_corrections").delete().eq("id", corr.id);
    await admin.from("attendance").delete().eq("id", att.id);
    await admin.from("shifts").delete().eq("id", shift.id);
  }

  console.log("\n=== 8. Swap request: one-way (nhường ca) accepted -> revert -> assignee back ===");
  {
    const takerId = await makeUser(`revert-taker1-${ts}@example.com`, "teacher");
    await admin.from("profile_branches").insert({ profile_id: takerId, branch_id: branchId });
    const { data: shift } = await admin
      .from("shifts")
      .insert({ assignee_id: staffId, branch_id: branchId, start_at: "2026-09-08T01:00:00Z", end_at: "2026-09-08T04:00:00Z", shift_type: "morning" })
      .select()
      .single();
    const { data: swap } = await admin
      .from("shift_swap_requests")
      .insert({ branch_id: branchId, requester_id: staffId, requester_shift_id: shift.id, status: "pending" })
      .select()
      .single();
    const takerClient = await signedIn(`revert-taker1-${ts}@example.com`);
    const { error: acceptError } = await takerClient.rpc("respond_to_swap_request", { p_request_id: swap.id, p_accept: true });
    check("one-way swap accepted", !acceptError, acceptError?.message);
    const { data: shiftAfterAccept } = await admin.from("shifts").select("assignee_id").eq("id", shift.id).single();
    check("shift assigned to taker after accept", shiftAfterAccept.assignee_id === takerId);

    const { data: revertData, error: revertError } = await techClient.rpc("revert_swap_request", { p_request_id: swap.id });
    check("one-way swap revert succeeds", !revertError, revertError?.message);
    check("swap back to pending", revertData?.status === "pending");
    const { data: shiftAfterRevert } = await admin.from("shifts").select("assignee_id").eq("id", shift.id).single();
    check("shift reassigned back to original requester", shiftAfterRevert.assignee_id === staffId);

    await admin.from("shift_swap_requests").delete().eq("id", swap.id);
    await admin.from("shifts").delete().eq("id", shift.id);
  }

  console.log("\n=== 9. Swap request: mutual (đổi 2 chiều) accepted -> revert -> both assignees back ===");
  {
    const targetId = await makeUser(`revert-target1-${ts}@example.com`, "teacher");
    await admin.from("profile_branches").insert({ profile_id: targetId, branch_id: branchId });
    const { data: reqShift } = await admin
      .from("shifts")
      .insert({ assignee_id: staffId, branch_id: branchId, start_at: "2026-09-09T01:00:00Z", end_at: "2026-09-09T04:00:00Z", shift_type: "morning" })
      .select()
      .single();
    const { data: targetShift } = await admin
      .from("shifts")
      .insert({ assignee_id: targetId, branch_id: branchId, start_at: "2026-09-09T05:00:00Z", end_at: "2026-09-09T08:00:00Z", shift_type: "afternoon" })
      .select()
      .single();
    const { data: swap } = await admin
      .from("shift_swap_requests")
      .insert({
        branch_id: branchId, requester_id: staffId, requester_shift_id: reqShift.id,
        target_id: targetId, target_shift_id: targetShift.id, status: "pending",
      })
      .select()
      .single();
    const targetClient = await signedIn(`revert-target1-${ts}@example.com`);
    const { error: acceptError } = await targetClient.rpc("respond_to_swap_request", { p_request_id: swap.id, p_accept: true });
    check("mutual swap accepted", !acceptError, acceptError?.message);
    const { data: reqShiftAfterAccept } = await admin.from("shifts").select("assignee_id").eq("id", reqShift.id).single();
    const { data: targetShiftAfterAccept } = await admin.from("shifts").select("assignee_id").eq("id", targetShift.id).single();
    check("shifts swapped after accept", reqShiftAfterAccept.assignee_id === targetId && targetShiftAfterAccept.assignee_id === staffId);

    const { data: revertData, error: revertError } = await techClient.rpc("revert_swap_request", { p_request_id: swap.id });
    check("mutual swap revert succeeds", !revertError, revertError?.message);
    check("swap back to pending", revertData?.status === "pending");
    const { data: reqShiftAfterRevert } = await admin.from("shifts").select("assignee_id").eq("id", reqShift.id).single();
    const { data: targetShiftAfterRevert } = await admin.from("shifts").select("assignee_id").eq("id", targetShift.id).single();
    check("both shifts reassigned back", reqShiftAfterRevert.assignee_id === staffId && targetShiftAfterRevert.assignee_id === targetId);

    await admin.from("shift_swap_requests").delete().eq("id", swap.id);
    await admin.from("shifts").delete().eq("id", reqShift.id);
    await admin.from("shifts").delete().eq("id", targetShift.id);
  }

  console.log(failures.length ? `\n*** ${failures.length} FAILURES: ${failures.join(", ")}` : "\n*** ALL CHECKS PASSED");
} finally {
  console.log("\n=== db cleanup ===");
  for (const id of created) {
    await admin.from("profile_branches").delete().eq("profile_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log("cleaned up", created.length, "test profiles");
}
process.exit(failures.length ? 1 : 0);
```

- [ ] **Step 2: Run it against local/linked Supabase**

Run: `node --env-file=.env.local /private/tmp/claude-501/-Users-phuongnam-Documents-Calendar-GInny-House/08b56aa0-845e-4b40-bc28-2976704760d0/scratchpad/verify-revert.mjs`
Expected: `*** ALL CHECKS PASSED`, exit code 0. If any check fails, fix the migration (Task 1) or action (Tasks 2–5) — do not weaken the test to pass.

- [ ] **Step 3: Manual UI check (dev server)**

Run: `npm run dev` (background), then in a browser: sign in as a `technical` account, go to `/manager`, click a staff row in "Tổng hợp đơn đã gửi" to open the detail dialog, confirm a resolved (non-pending) request shows the "Khôi phục" button and clicking it (with confirm) flips the request back to "Chờ duyệt" and the badge updates. Then sign in as a non-technical manager (e.g. `training_director`) and confirm the same dialog shows **no** "Khôi phục" button anywhere. Stop the dev server after (`lsof -ti:3000 | xargs kill`).

- [ ] **Step 4: Full regression build**

Run: `npm run build`
Expected: clean build, 0 TypeScript errors, no new route/warning surprises.

- [ ] **Step 5: Deploy to production**

Run: `npx vercel deploy --prod`
Expected: `readyState: READY`. Confirm the production URL still returns 200 (`curl -sI https://calendar-ginny-house.vercel.app | head -1`).

- [ ] **Step 6: Refresh the knowledge graph**

Run:
```bash
graphify update .
git add -A
git commit -m "chore: refresh knowledge graph after request status revert feature"
```
