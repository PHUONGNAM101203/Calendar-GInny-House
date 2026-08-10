# Student-Affairs Same-Start-Only Rule — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, inline in this session (no worktree — this project doesn't use them). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relax the "1 quản sinh per shift/branch" rule from *any time overlap* to *exact same start time*, and make it respect a shift's `duty_role` instead of only the person's primary role.

**Architecture:** The rule lives entirely in one Postgres function (`student_affairs_slot_taken`) with exactly two enforcement points (a BEFORE trigger on `shifts`, and an inline check in the `request_shift` RPC). One migration replaces all three function bodies; no TypeScript logic mirrors this rule — only three error-message allowlist entries need updating.

**Tech Stack:** Supabase Postgres (`security definer` functions + triggers), Next.js 16 Server Actions.

## Global Constraints

- New rule: block only when an existing quản sinh shift/pending request at the **same branch** has the **exact same `start_at`**. Every other overlap shape is allowed.
- "Is this a quản sinh shift" is decided by `coalesce(duty_role, profiles.role) = 'student_affairs'` — a dual-role person working a `teaching_assistant`-duty shift does not occupy the slot.
- Keep `student_affairs_slot_taken`'s existing 5-arg signature (`p_end_at` stays, unused) — dropping a param would force re-copying `request_shift`'s body an extra time, and that function has a documented history of drift bugs (see `0027_fix_shift_request_status_cast.sql`).
- Do NOT rename or recreate the triggers `shifts_validate_duty_role` / `trg_student_affairs_single_slot` — their alphabetical firing order (`s` before `t`) is load-bearing, so duty-role self-healing runs before the quản sinh gate reads `new.duty_role`.
- Error message becomes `"Đã có quản sinh khác trực ca bắt đầu cùng giờ này"` in all three raise sites and all three TS allowlists.
- No test suite — verify with `npx tsc --noEmit`, `npm run lint`, `npm run build`, and live Supabase checks using disposable `auth.admin.createUser` accounts driven through the **anon** client, cleaned up afterwards.
- Spec: `docs/superpowers/specs/2026-08-10-student-affairs-same-start-only-design.md`.

---

### Task 1: Migration `0053_student_affairs_same_start_only.sql`

**Files:**
- Create: `supabase/migrations/0053_student_affairs_same_start_only.sql`

**Interfaces:**
- Consumes: `shifts.duty_role`, `shift_requests.duty_role` (both added in `0052_shift_duty_role.sql`); `request_shift(timestamptz, timestamptz, uuid, text, public.shift_type, public.staff_role)` — the 6-arg signature `0052` established.
- Produces: replaced bodies for `student_affairs_slot_taken`, `enforce_student_affairs_single_slot`, `request_shift` — all keeping their current signatures, so no caller anywhere changes.

- [ ] **Step 1: Read the two functions being replaced, verbatim**

Run: `sed -n '9,57p' supabase/migrations/0037_student_affairs_single_slot.sql`
Then find the live `request_shift` body: `grep -n "create or replace function public.request_shift" -A 45 supabase/migrations/0052_shift_duty_role.sql`

Expected: `student_affairs_slot_taken` (5 args, two `exists` branches using `tstzrange && tstzrange`), `enforce_student_affairs_single_slot` (gates on `v_role = 'student_affairs'`), and `request_shift` (6 args incl. `p_duty_role`, gates on `v_role = 'student_affairs'`). Copy these bodies exactly — the migration changes only the lines called out below.

- [ ] **Step 2: Write the migration**

```sql
-- Nới luật "1 quản sinh / ca" (0037_student_affairs_single_slot.sql): đổi từ
-- "chồng lấn bất kỳ" sang "trùng khít giờ bắt đầu".
--
-- Luật cũ chặn theo tstzrange overlap, nên ca sáng 04:00–07:30 và ca chiều
-- 07:00–10:00 (bàn giao 30 phút — lịch hoàn toàn bình thường) không tạo được.
-- Luật mới chỉ chặn khi 2 ca quản sinh cùng cơ sở có CÙNG giờ bắt đầu, tức
-- đúng trường hợp xếp nhầm 2 người vào cùng một suất trực.
--
-- Đồng thời tính theo NHIỆM VỤ CA (duty_role, 0052_shift_duty_role.sql) thay
-- vì chỉ vai trò chính: người kiêm nhiệm Quản sinh + Trợ giảng khi làm ca với
-- nhiệm vụ 'teaching_assistant' thì không chiếm suất quản sinh nữa.
--
-- p_end_at giữ lại dù không còn dùng: bỏ tham số buộc phải DROP FUNCTION rồi
-- chép lại toàn bộ thân request_shift thêm một lần nữa, mà hàm đó đã có tiền
-- sử lỗi tái phát đúng vì bị chép tay qua nhiều migration (xem ghi chú trong
-- 0027_fix_shift_request_status_cast.sql).
create or replace function public.student_affairs_slot_taken(
  p_branch_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_exclude_shift_id uuid default null,
  p_exclude_request_id uuid default null
) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.shifts s
    join public.profiles p on p.id = s.assignee_id
    where coalesce(s.duty_role, p.role) = 'student_affairs'
      and s.branch_id = p_branch_id
      and s.start_at = p_start_at
      and (p_exclude_shift_id is null or s.id <> p_exclude_shift_id)
  ) or exists (
    select 1 from public.shift_requests r
    join public.profiles p on p.id = r.profile_id
    where coalesce(r.duty_role, p.role) = 'student_affairs'
      and r.status = 'pending'
      and r.branch_id = p_branch_id
      and r.start_at = p_start_at
      and (p_exclude_request_id is null or r.id <> p_exclude_request_id)
  );
$$;

grant execute on function public.student_affairs_slot_taken(uuid, timestamptz, timestamptz, uuid, uuid) to authenticated;

-- Cổng chặn cũng phải đọc nhiệm vụ ca, không chỉ vai trò chính.
--
-- Thứ tự trigger là phụ thuộc thật: trên bảng shifts có 2 trigger BEFORE
-- INSERT/UPDATE — shifts_validate_duty_role (0052) và
-- trg_student_affairs_single_slot (0037). Postgres chạy chúng theo thứ tự chữ
-- cái của TÊN TRIGGER, nên 's' chạy trước 't'. Đúng như cần: hàm 0052 có thể
-- tự dọn new.duty_role := null khi giá trị không khớp vai trò người được xếp,
-- và cổng chặn dưới đây phải đọc giá trị SAU khi đã dọn. Đừng đổi tên 2
-- trigger này.
create or replace function public.enforce_student_affairs_single_slot()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.staff_role;
begin
  select role into v_role from public.profiles where id = new.assignee_id;
  if coalesce(new.duty_role, v_role) = 'student_affairs' and public.student_affairs_slot_taken(
    new.branch_id, new.start_at, new.end_at, new.id, null
  ) then
    raise exception 'Đã có quản sinh khác trực ca bắt đầu cùng giờ này' using errcode = '23505';
  end if;
  return new;
end;
$$;

-- request_shift(): cùng cách xử lý cho đường tự đăng ký. Không sửa chỗ này thì
-- người kiêm nhiệm gửi đơn với nhiệm vụ 'teaching_assistant' vẫn bị chặn oan
-- ngay từ lúc gửi, dù trigger phía shifts đã đúng.
--
-- Thân hàm chép nguyên bản 0052 (bản có p_duty_role), chỉ đổi đúng dòng cổng
-- chặn quản sinh và câu thông báo.
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
  if coalesce(p_duty_role, v_role) = 'student_affairs' and public.student_affairs_slot_taken(
    p_branch_id, p_start_at, p_end_at, null, null
  ) then
    raise exception 'Đã có quản sinh khác trực ca bắt đầu cùng giờ này' using errcode = '23505';
  end if;

  insert into public.shift_requests (profile_id, branch_id, start_at, end_at, note, shift_type, duty_role)
  values (v_uid, p_branch_id, p_start_at, p_end_at, nullif(p_note, ''), p_shift_type, p_duty_role)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.request_shift(timestamptz, timestamptz, uuid, text, public.shift_type, public.staff_role) to authenticated;
```

- [ ] **Step 3: Deploy the migration**

Run: `npx supabase db push --linked`
Expected: `Applying migration 0053_student_affairs_same_start_only.sql...` then `Finished supabase db push.` with no error.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0053_student_affairs_same_start_only.sql
git commit -m "feat: relax student-affairs slot rule to same-start-time only"
```

---

### Task 2: Error-message allowlists

**Files:**
- Modify: `actions/shifts.ts` (`mapShiftError`)
- Modify: `actions/shift-requests.ts` (`mapShiftRequestError` and the `SHIFT_RPC_MESSAGES` array)

**Interfaces:**
- Consumes: the exact exception string raised by Task 1's three functions — `Đã có quản sinh khác trực ca bắt đầu cùng giờ này`.
- Produces: nothing consumed elsewhere; these are leaf translation tables.

- [ ] **Step 1: Update `actions/shifts.ts`**

Replace the existing quản sinh case inside `mapShiftError`:

```ts
  if (message.includes("Đã có quản sinh khác trực ca bắt đầu cùng giờ này")) {
    return "Đã có quản sinh khác trực ca bắt đầu cùng giờ này";
  }
```

- [ ] **Step 2: Update `actions/shift-requests.ts` — `mapShiftRequestError`**

```ts
  if (message.includes("Đã có quản sinh khác trực ca bắt đầu cùng giờ này")) {
    return "Đã có quản sinh khác trực ca bắt đầu cùng giờ này";
  }
```

- [ ] **Step 3: Update `actions/shift-requests.ts` — `SHIFT_RPC_MESSAGES`**

Replace the array entry `"Ca này đã có đăng ký quản sinh"` with:

```ts
  "Đã có quản sinh khác trực ca bắt đầu cùng giờ này",
```

- [ ] **Step 4: Confirm the old string is fully gone**

Run: `grep -rn "Ca này đã có đăng ký quản sinh" --include="*.ts" --include="*.tsx" --include="*.sql" .`
Expected: matches ONLY inside `supabase/migrations/0037_*.sql`, `0021_*.sql`, `0023_*.sql`, `0052_*.sql` (historical migrations, which must never be edited). Zero matches under `actions/`, `components/`, `lib/`, `app/`.

- [ ] **Step 5: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 errors. (3 pre-existing `react-hooks/incompatible-library` warnings about react-hook-form's `watch()` are expected and unrelated.)

- [ ] **Step 6: Commit**

```bash
git add actions/shifts.ts actions/shift-requests.ts
git commit -m "feat: update quan-sinh slot error message to match new rule"
```

---

### Task 3: Live verification and deploy

**Files:** none (verification + deploy only).

- [ ] **Step 1: Write and run the live verification script**

Create a throwaway script at the repo root (deleted in Step 3) using `@supabase/supabase-js` + `dotenv` (both already installed; run it from the repo root so they resolve). Create disposable accounts with `auth.admin.createUser`, set roles by updating `profiles`, add `profile_branches` rows, and drive the anon client for every RPC so real RLS/RPC paths are exercised.

**Critical setup note:** the linked Supabase project holds real staff data, including existing `student_affairs` shifts. Pick test windows far in the future (e.g. `now() + 60 days`) so a pre-existing real quản sinh shift can't produce a false failure — this exact trap already bit the `0052` verification run.

Accounts needed: `SA_A` and `SA_B` (both `role: 'student_affairs'`), `DUAL` (`role: 'student_affairs', secondary_role: 'teaching_assistant'`), `TEACHER` (`role: 'teacher'`), and one manager `CEO` (`role: 'ceo'`) to approve requests.

Checks (each must print PASS):

1. **Ca lỗi gốc** — insert shift for `SA_A` at `T+60d 04:00–07:30`, then for `SA_B` at `T+60d 07:00–10:00`, same branch → both succeed.
2. **Trùng giờ bắt đầu** — insert shift for `SA_B` at exactly `SA_A`'s `start_at` → rejected with `Đã có quản sinh khác trực ca bắt đầu cùng giờ này`.
3. **Nằm trọn bên trong** — `SA_A` at `T+61d 08:00–12:00`, `SA_B` at `T+61d 09:00–11:00` → both succeed.
4. **Kiêm nhiệm làm Trợ giảng** — `DUAL` shift with `duty_role: 'teaching_assistant'` at the exact same `start_at` as an `SA_A` shift → succeeds.
5. **Kiêm nhiệm làm Quản sinh** — `DUAL` shift with `duty_role: 'student_affairs'` at that same `start_at` → rejected.
6. **UPDATE giữ nguyên giờ bắt đầu** — update `SA_A`'s shift (change `end_at` only) → succeeds, does not block itself.
7. **Đơn chờ duyệt vẫn chiếm chỗ** — `SA_A` calls `request_shift` for a fresh slot, leave it `pending`; then insert a shift for `SA_B` at that same `start_at` → rejected.
8. **Đường tự đăng ký** — `SA_B` calls `request_shift` at a `start_at` already taken by an `SA_A` shift → rejected with the same message; at a different `start_at` overlapping it → succeeds.
9. **Hồi quy vai trò khác** — two `TEACHER` shifts at the exact same `start_at`, same branch → both succeed (rule never applied to teachers).

Every check must PASS. A failure means returning to Task 1 and fixing the SQL, not adjusting the assertion to match.

- [ ] **Step 2: Full build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all three clean.

- [ ] **Step 3: Clean up and confirm no leftovers**

Delete the verification script. Then confirm zero leftover test rows:

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
admin.from('profiles').select('id, full_name').ilike('full_name', 'verify-%').then(({data}) => console.log('leftover:', JSON.stringify(data)));
"
```
Expected: `leftover: []`

- [ ] **Step 4: Deploy**

```bash
npx vercel deploy --prod
```
Expected: `readyState: "READY"`. If it fails with a transient `"Not authorized"`, retry once (established pattern this session).

- [ ] **Step 5: Report completion**

Summarize in Vietnamese what changed and confirm every verification check passed.
