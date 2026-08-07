# Multi-Branch Staff Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a staff member belong to multiple cơ sở (branches) instead of exactly one — multi-select in the register form and the manager Staff Table, with shift creation, self-service shift requests, and every branch-scoped visibility rule respecting the full membership set.

**Architecture:** Complete the cutover migration `0024_profile_branches.sql` started (schema only, never wired up): make `profile_branches` (M:N) the live source of truth, rewrite the handful of RLS policies/RPCs that still compare a single `branch_id = current_branch_id()` to membership checks via the already-existing `is_branch_member()`, and update every UI surface that reads/writes a profile's branch. `profiles.branch_id` (the old single column) is dropped only in the final task, after everything else is verified working.

**Tech Stack:** Next.js 16 App Router Server Components + Server Actions, Supabase Postgres/RLS, react-hook-form + zod, shadcn/ui (Popover, Badge — no new external deps).

## Global Constraints

- All Server Action inputs validated with zod `safeParse` (never `parse`) — see `actions/*.ts` convention.
- Every Server Action returns `Promise<ActionResult>` / `Promise<ActionResult<T>>`.
- Raw Postgres errors never reach the user — each action's `map<X>Error` allowlist/translate convention (see `actions/shifts.ts`, `actions/shift-requests.ts`) must be extended, not bypassed.
- SQL migrations are sequentially numbered in `supabase/migrations/`; the next free number is `0032`.
- All user-facing copy is Vietnamese. Code identifiers/comments are English.
- Management-tier roles (`ceo`, `coo`, `training_director`, `technical` — `isManagerRole()` in `lib/roles.ts`) get **zero** `profile_branches` rows and are treated as "all branches" everywhere a branch check happens — this is unchanged, existing behavior, not a new rule.
- After each SQL migration task, apply it to the live Supabase project via the `supabase` CLI (already authenticated in this environment via `SUPABASE_ACCESS_TOKEN` in `.env.local`) and verify with a direct read query — do not trust migration-apply output alone. Use a throwaway test profile/shift/etc. for any write-path check and delete it in the same session, mirroring the verification pattern already used for this project's recent migrations (`0027`–`0031`).
- This repo has no automated test suite (confirmed, no test runner configured) — every task's "test" step is a manual `tsc`/`eslint`/direct-DB-query verification, not a unit test file.

---

## Current-state ground truth (re-verified directly against the live database on 2026-08-07 — do not re-derive from migration file history, which is misleading here since several policies were superseded multiple times)

Only **4 RLS policies** currently compare `branch_id = current_branch_id()`:

| Table | Policy | Live `qual` |
|---|---|---|
| `attendance` | `attendance_select_branch` | `(branch_id = current_branch_id()) OR can_view_profile_calendar(profile_id)` |
| `profiles` | `profiles_select_branch` | `(id = auth.uid()) OR (branch_id = current_branch_id()) OR can_view_profile_calendar(id) OR is_visible_via_roster(id)` |
| `shift_swap_requests` | `swaps_select_branch` | `(branch_id = current_branch_id()) OR can_view_profile_calendar(requester_id) OR can_view_profile_calendar(target_id)` |
| `shifts` | `shifts_select_branch` | `(branch_id = current_branch_id()) OR can_view_profile_calendar(assignee_id)` |

Plus **one function body**: `is_visible_via_roster(p_target_id)` calls `current_branch_id()` three times (shifts/attendance/swap sub-selects).

Plus **`request_shift()`**, which accepts any non-null `p_branch_id` with zero membership check today.

`shifts_insert_manager`/`shifts_update_manager`/`shifts_delete_manager` already use `is_shift_manager()` (role-based, not branch-based) — **no change needed**. `cancel_swap_request()` and `cancel_leave_request()` already use `is_manager()` (role-based) — **no change needed**. `leave_select_own_or_manager` and `respond_to_leave_request()` already use `can_view_profile()`/`can_view_profile_calendar()` (role/group-based) — **no change needed**; `leave_requests.branch_id` is confirmed vestigial (column is already nullable, not read by any RLS policy, RPC authorization check, or app code for filtering/display).

`request_leave()` currently has **two live overloads** (a dead 3-param one from `0004`/`0006` and the real 6-param one from `0012` that the app actually calls) — the same overload-duplication bug already fixed once this session for `clock_in()`. Task 3 fixes this too since it's touching this exact function anyway.

`profile_branches` currently has **0 rows** in production despite 8 of 12 profiles having a non-null `branch_id` — the one-time backfill from `0024` predates these real accounts. Task 1's backfill is not a formality; skipping it would make every one of those 8 people lose their own branch's visibility the moment Task 2's RLS rewrite ships.

---

### Task 1: Backfill `profile_branches` from the current `profiles.branch_id`

**Files:**
- Create: `supabase/migrations/0032_backfill_profile_branches.sql`

**Interfaces:**
- Produces: every profile with a non-null `branch_id` today has a matching `profile_branches` row before Task 2 ships.

- [ ] **Step 1: Write the migration**

```sql
-- Reconciles profile_branches with the current single-branch reality.
-- 0024's one-time backfill ran before any of today's real accounts existed
-- (confirmed via direct query: profile_branches has 0 rows while 8 of 12
-- live profiles have a non-null branch_id) — this catches that drift up.
-- Idempotent: safe to re-run, on conflict does nothing.
insert into public.profile_branches (profile_id, branch_id)
select id, branch_id from public.profiles where branch_id is not null
on conflict (profile_id, branch_id) do nothing;
```

- [ ] **Step 2: Apply and verify**

Run: `supabase db push` (via the authenticated CLI wrapper already set up in this environment).
Verify with a direct query:
```sql
select
  (select count(*) from public.profile_branches) as branch_rows,
  (select count(*) from public.profiles where branch_id is not null) as profiles_with_branch;
```
Expected: both numbers equal (currently 8 and 8).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0032_backfill_profile_branches.sql
git commit -m "feat: backfill profile_branches from current profiles.branch_id"
```

---

### Task 2: Rewrite branch-visibility RLS to membership-based checks

**Files:**
- Create: `supabase/migrations/0033_branch_membership_visibility.sql`

**Interfaces:**
- Consumes: `public.is_branch_member(p_profile_id uuid, p_branch_id uuid) returns boolean` (already exists, `0024_profile_branches.sql`).
- Produces: the 4 policies and `is_visible_via_roster()` now check "am I a member of this branch" instead of "is this my single branch"; `request_shift()` rejects a branch the caller doesn't belong to (unless they're manager-tier).

- [ ] **Step 1: Write the migration**

```sql
-- Completes the cutover started in 0024: replaces every remaining
-- branch_id = current_branch_id() check with is_branch_member(auth.uid(),
-- branch_id) — a person now sees rows for EVERY branch they belong to, not
-- just one. Purely additive/widening: after Task 1's backfill, anyone who
-- could see a row via their old single branch still can (their branch_id
-- became their sole profile_branches row), and now they also see rows at
-- any additional branch. can_view_profile_calendar()/is_visible_via_roster()
-- OR-clauses are untouched.

drop policy if exists attendance_select_branch on public.attendance;
create policy attendance_select_branch on public.attendance
  for select to authenticated
  using (public.is_branch_member(auth.uid(), branch_id) or public.can_view_profile_calendar(profile_id));

drop policy if exists profiles_select_branch on public.profiles;
create policy profiles_select_branch on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_branch_member(auth.uid(), branch_id)
    or public.can_view_profile_calendar(id)
    or public.is_visible_via_roster(id)
  );

drop policy if exists swaps_select_branch on public.shift_swap_requests;
create policy swaps_select_branch on public.shift_swap_requests
  for select to authenticated
  using (
    public.is_branch_member(auth.uid(), branch_id)
    or public.can_view_profile_calendar(requester_id)
    or public.can_view_profile_calendar(target_id)
  );

drop policy if exists shifts_select_branch on public.shifts;
create policy shifts_select_branch on public.shifts
  for select to authenticated
  using (public.is_branch_member(auth.uid(), branch_id) or public.can_view_profile_calendar(assignee_id));

create or replace function public.is_visible_via_roster(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.shifts s
    where s.assignee_id = p_target_id
      and public.is_branch_member(auth.uid(), s.branch_id)
  ) or exists (
    select 1 from public.attendance a
    where a.profile_id = p_target_id
      and public.is_branch_member(auth.uid(), a.branch_id)
  ) or exists (
    select 1 from public.shift_swap_requests w
    where (w.requester_id = p_target_id or w.target_id = p_target_id)
      and public.is_branch_member(auth.uid(), w.branch_id)
  );
$$;

-- request_shift(): today accepts any non-null branch with zero membership
-- check. A front-line requester must now belong to the branch they're
-- requesting a shift at; manager-tier (is_manager()) is exempt, matching
-- the "all branches" convention everywhere else.
create or replace function public.request_shift(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_branch_id uuid,
  p_note text default null,
  p_shift_type public.shift_type default 'morning'
) returns public.shift_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
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

  insert into public.shift_requests (profile_id, branch_id, start_at, end_at, note, shift_type)
  values (v_uid, p_branch_id, p_start_at, p_end_at, nullif(p_note, ''), p_shift_type)
  returning * into v_row;

  return v_row;
end;
$$;
```

- [ ] **Step 2: Apply and verify against production with a real signed-in session**

Run: `supabase db push`, then verify with a script mirroring this session's established end-to-end pattern (admin-create a throwaway test user, sign in as them for a real JWT, exercise the RLS through that JWT, delete the test user in a `finally` block — see the pattern already used for `0029`'s verification):

1. Create test profile A with `role: teacher`, add it to `profile_branches` for Branch 1 only (via `admin.from("profile_branches").insert(...)`, service role bypasses the manager-only write RLS).
2. Create test profile B, role `teacher`, add to Branch 2 only, with a shift at Branch 2.
3. Sign in as A. Confirm `asA.from("shifts").select("id").eq("id", bShift.id)` returns **0 rows** (A is not a member of Branch 2 — this proves the rewrite didn't accidentally widen visibility to everyone).
4. Add A to Branch 2 as well (`profile_branches` insert). Sign in as A again (fresh client). Confirm the same query now returns the row.
5. As A, call `asA.rpc("request_shift", { p_start_at, p_end_at, p_branch_id: branch1.id, ... })` — should succeed. Call it again with `p_branch_id: branch3.id` (a branch A doesn't belong to) — should fail with `'Bạn không thuộc cơ sở này'`.
6. Delete both test profiles and any created rows.

Expected: all of the above pass exactly as described.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0033_branch_membership_visibility.sql
git commit -m "feat: rewrite branch visibility RLS to membership-based checks"
```

---

### Task 3: `set_profile_branches` RPC, multi-branch signup trigger, and leave's branch-derivation removal

**Files:**
- Create: `supabase/migrations/0034_set_profile_branches.sql`

**Interfaces:**
- Produces: `public.set_profile_branches(p_profile_id uuid, p_branch_ids uuid[]) returns void` — atomically replaces a profile's branch memberships, `is_manager()`-gated. `handle_new_user()` now reads a JSON array (`raw_user_meta_data -> 'branch_ids'`) instead of a scalar. `request_leave()` (both overloads collapsed into one) no longer requires/sets a branch.

- [ ] **Step 1: Write the migration**

```sql
-- Atomic replace-the-set write, mirroring this codebase's existing
-- convention of pushing atomic multi-row writes into a SECURITY DEFINER
-- RPC rather than doing delete+insert as two round trips from a Server
-- Action (see e.g. respond_to_shift_request's insert+update pattern).
create or replace function public.set_profile_branches(p_profile_id uuid, p_branch_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then
    raise exception 'Chỉ quản lý mới được cập nhật cơ sở' using errcode = '42501';
  end if;

  delete from public.profile_branches where profile_id = p_profile_id;

  if p_branch_ids is not null and array_length(p_branch_ids, 1) > 0 then
    insert into public.profile_branches (profile_id, branch_id)
    select p_profile_id, unnest(p_branch_ids)
    on conflict (profile_id, branch_id) do nothing;
  end if;
end;
$$;

grant execute on function public.set_profile_branches(uuid, uuid[]) to authenticated;

-- handle_new_user(): reads a JSON array of branch ids from signup metadata
-- instead of a single scalar. Empty/missing array -> zero profile_branches
-- rows, same as today's branch_id = null case (front-line, not yet
-- assigned — the existing nag banner covers this, no exception raised).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.staff_role;
  v_branch_id uuid;
begin
  begin
    v_role := nullif(new.raw_user_meta_data ->> 'role', '')::public.staff_role;
  exception when invalid_text_representation then
    v_role := null;
  end;

  if v_role is null or v_role not in (
    'teacher', 'operations_staff', 'student_affairs', 'teaching_assistant', 'collaborator', 'customer_care'
  ) then
    v_role := 'teacher';
  end if;

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    v_role
  )
  on conflict (id) do nothing;

  for v_branch_id in
    select (value #>> '{}')::uuid
    from jsonb_array_elements(coalesce(new.raw_user_meta_data -> 'branch_ids', '[]'::jsonb))
  loop
    insert into public.profile_branches (profile_id, branch_id)
    values (new.id, v_branch_id)
    on conflict (profile_id, branch_id) do nothing;
  end loop;

  return new;
end;
$$;

-- request_leave(): branch_id is confirmed vestigial (no RLS policy or
-- approval RPC reads it — see the ground-truth section at the top of this
-- plan). Drop the old 3-param dead overload (same overload-duplication bug
-- already fixed once this session for clock_in()) and stop deriving/
-- requiring a branch on the live 6-param version.
drop function if exists public.request_leave(date, date, text);

create or replace function public.request_leave(
  p_start_date date,
  p_end_date date,
  p_reason text default null,
  p_request_type public.leave_request_type default 'full_day',
  p_start_time time default null,
  p_end_time time default null
) returns public.leave_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.leave_requests%rowtype;
  v_start_time time := p_start_time;
  v_end_time time := p_end_time;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if p_end_date < p_start_date then
    raise exception 'Ngày kết thúc phải sau ngày bắt đầu' using errcode = '23514';
  end if;
  if p_request_type <> 'full_day' and p_end_date <> p_start_date then
    raise exception 'Đến muộn / về sớm / nghỉ theo giờ chỉ áp dụng cho 1 ngày' using errcode = '23514';
  end if;

  case p_request_type
    when 'full_day' then
      v_start_time := null;
      v_end_time := null;
    when 'late_arrival' then
      if p_start_time is null then
        raise exception 'Vui lòng chọn giờ có mặt' using errcode = '23514';
      end if;
      v_end_time := null;
    when 'early_leave' then
      if p_end_time is null then
        raise exception 'Vui lòng chọn giờ rời đi' using errcode = '23514';
      end if;
      v_start_time := null;
    when 'hourly' then
      if p_start_time is null or p_end_time is null then
        raise exception 'Vui lòng chọn giờ bắt đầu và kết thúc' using errcode = '23514';
      end if;
      if p_end_time <= p_start_time then
        raise exception 'Giờ kết thúc phải sau giờ bắt đầu' using errcode = '23514';
      end if;
  end case;

  insert into public.leave_requests
    (profile_id, start_date, end_date, reason, request_type, start_time, end_time)
  values
    (v_uid, p_start_date, p_end_date, nullif(p_reason, ''), p_request_type, v_start_time, v_end_time)
  returning * into v_row;

  return v_row;
end;
$$;
```

- [ ] **Step 2: Apply and verify**

Run: `supabase db push`. Verify:
```sql
select count(*) from pg_proc where proname = 'request_leave'; -- expect 1, was 2
select count(*) from pg_proc where proname = 'set_profile_branches'; -- expect 1
```
Then a real end-to-end check: admin-create a test user with `user_metadata: { branch_ids: [branch1.id, branch2.id], role: "teacher" }`, confirm `profile_branches` has exactly those 2 rows for them afterward, then delete the test user (cascades). Separately, sign in as any existing test/real-adjacent profile and call `rpc("request_leave", { p_start_date, p_end_date, p_reason: "test" })` — should still succeed with no branch-related error (cancel/clean up the created leave request row after).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0034_set_profile_branches.sql
git commit -m "feat: add set_profile_branches RPC, multi-branch signup, drop leave's branch dependency"
```

---

### Task 4: `Profile` type and `lib/auth.ts` — `branch_ids` replaces `branch_id`

**Files:**
- Modify: `types/index.ts:25-32`
- Modify: `lib/auth.ts` (whole file)

**Interfaces:**
- Produces: `Profile.branch_ids: string[]` (replaces `branch_id: string | null`). `getSessionProfile()`/`requireProfile()`/`requireManager()` return objects with this shape — every downstream consumer in later tasks relies on `profile.branch_ids`.

- [ ] **Step 1: Update the `Profile` type**

In `types/index.ts`, replace lines 25-32:

```ts
export type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  role: Role;
  branch_ids: string[];
  color: string | null;
};
```

- [ ] **Step 2: Update `lib/auth.ts` to fetch and map `branch_ids`**

Replace the full file content:

```ts
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { canAccessManagerPage } from "@/lib/roles";
import type { Profile, Role } from "@/types";

const PROFILE_COLUMNS = "id, full_name, phone, role, color, profile_branches(branch_id)";

type ProfileRow = {
  id: string;
  full_name: string;
  phone: string | null;
  role: Role;
  color: string | null;
  profile_branches: { branch_id: string }[] | null;
};

function toProfile(row: ProfileRow): Omit<Profile, "email"> {
  return {
    id: row.id,
    full_name: row.full_name,
    phone: row.phone,
    role: row.role,
    color: row.color,
    branch_ids: (row.profile_branches ?? []).map((pb) => pb.branch_id),
  };
}

// Self-heals accounts that have a Supabase auth user but no `profiles` row
// yet (e.g. created before the trigger existed, or the trigger raced with
// signup). Without this, an authenticated-but-profile-less user would bounce
// forever between requireProfile() -> /login and the proxy sending an
// authenticated user away from /login back to /calendar.
async function ensureProfile(user: { id: string; email?: string | null }) {
  const { data: created } = await supabaseAdmin
    .from("profiles")
    .upsert(
      { id: user.id, full_name: user.email?.split("@")[0] ?? "" },
      { onConflict: "id", ignoreDuplicates: true }
    )
    .select(PROFILE_COLUMNS)
    .single();

  if (created) return toProfile(created as ProfileRow);

  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .single();

  return existing ? toProfile(existing as ProfileRow) : null;
}

export const getSessionProfile = cache(async () => {
  const supabase = await createClient();
  // getUser() re-validates the token against the Auth server instead of
  // trusting the cookie payload — getSession() does not, so per Supabase's
  // own guidance it must not be used to gate access or read user data.
  // React's cache() still limits this to one network round trip per request.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .single();

  const resolved = profile ? toProfile(profile as ProfileRow) : await ensureProfile(user);
  if (!resolved) return null;

  return { ...resolved, email: user.email ?? "" };
});

export async function requireProfile() {
  const profile = await getSessionProfile();
  if (!profile) redirect("/login");
  return profile;
}

export async function requireManager() {
  const profile = await requireProfile();
  if (!canAccessManagerPage(profile.role)) redirect("/calendar");
  return profile;
}
```

- [ ] **Step 3: Type-check** (this will surface every downstream file still referencing `.branch_id` on a `Profile`-shaped value — expected, fixed in later tasks)

Run: `npx tsc --noEmit`
Expected: errors only in files this plan's later tasks will touch (`components/manager/StaffTable.tsx`, `app/(app)/manager/page.tsx`, `app/(app)/layout.tsx`, `components/auth/RegisterForm.tsx`, `lib/validations/auth.ts`, `actions/auth.ts`, `actions/staff.ts`). If an error surfaces in any OTHER file, stop and investigate before continuing — it means a `.branch_id` read this plan didn't account for.

- [ ] **Step 4: Commit**

```bash
git add types/index.ts lib/auth.ts
git commit -m "feat: Profile.branch_ids replaces branch_id"
```

---

### Task 5: `actions/staff.ts` — `updateStaffBranchesAction`

**Files:**
- Modify: `actions/staff.ts:1-39` (the `updateStaffBranchAction` function only — `updateStaffRoleAction` is untouched, but gets one addition, see Step 2)

**Interfaces:**
- Consumes: `set_profile_branches(p_profile_id uuid, p_branch_ids uuid[])` RPC (Task 3).
- Produces: `updateStaffBranchesAction(profileId: string, branchIds: string[]): Promise<ActionResult>` — replaces `updateStaffBranchAction`. Task 7 (`StaffTable.tsx`) calls this.

- [ ] **Step 1: Replace `updateStaffBranchAction`**

```ts
export async function updateStaffBranchesAction(
  profileId: string,
  branchIds: string[]
): Promise<ActionResult> {
  await requireManager();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_profile_branches", {
    p_profile_id: profileId,
    p_branch_ids: branchIds,
  });

  if (error) return { ok: false, error: "Không thể cập nhật cơ sở" };

  revalidatePath("/manager");
  revalidatePath("/calendar");
  return { ok: true, data: undefined };
}
```

(The old version's "read the row back to detect a silent RLS no-op" comment/check no longer applies — `set_profile_branches` raises its own `42501` exception via `raise exception` when the caller isn't a manager, which Supabase's client surfaces as a real `error`, not a silent no-op. The RPC call above already handles that case correctly through the `if (error)` branch.)

- [ ] **Step 2: Update the role-promotion side effect's call site** (this is inside `updateStaffRoleAction`'s caller, `StaffTable.tsx`, not this file — no change needed in `actions/staff.ts` itself for this step; noted here only so the reviewer isn't surprised `updateStaffRoleAction` in this file is otherwise untouched)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: the same pre-existing error set from Task 4 Step 3, minus nothing new introduced here (this file itself should now be clean — confirm no error reported for `actions/staff.ts`).

- [ ] **Step 4: Commit**

```bash
git add actions/staff.ts
git commit -m "feat: updateStaffBranchesAction replaces single-branch action"
```

---

### Task 6: `MultiSelectBranches` shared component

**Files:**
- Create: `components/ui/multi-select-branches.tsx`

**Interfaces:**
- Consumes: `Branch[]` (existing type, `types/index.ts`).
- Produces: `<MultiSelectBranches branches={Branch[]} value={string[]} onChange={(next: string[]) => void} disabled?={boolean} />` — used by Task 7 (`StaffTable.tsx`) and Task 8 (`RegisterForm.tsx`).

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Branch } from "@/types";

export function MultiSelectBranches({
  branches,
  value,
  onChange,
  disabled = false,
  placeholder = "Chọn cơ sở",
}: {
  branches: Branch[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const selected = branches.filter((b) => value.includes(b.id));

  function toggle(branchId: string) {
    onChange(
      value.includes(branchId) ? value.filter((id) => id !== branchId) : [...value, branchId]
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-3 py-1.5 text-left text-sm shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          {selected.length === 0 ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : (
            selected.map((b) => (
              <Badge
                key={b.id}
                variant="secondary"
                className="gap-1 pr-1"
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                {b.name}
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`Bỏ chọn ${b.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(b.id);
                  }}
                  className="rounded-full p-0.5 hover:bg-foreground/10"
                >
                  <XIcon className="size-3" />
                </span>
              </Badge>
            ))
          )}
          <ChevronDownIcon className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        <ul className="space-y-0.5">
          {branches.map((branch) => {
            const checked = value.includes(branch.id);
            return (
              <li key={branch.id}>
                <button
                  type="button"
                  onClick={() => toggle(branch.id)}
                  aria-pressed={checked}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <span
                    className="flex size-3.5 shrink-0 items-center justify-center rounded-[4px]"
                    style={{
                      backgroundColor: checked ? "var(--primary)" : "transparent",
                      boxShadow: "inset 0 0 0 1.5px var(--primary)",
                    }}
                  >
                    {checked && <CheckIcon className="size-2.5 text-primary-foreground" strokeWidth={3} />}
                  </span>
                  <span className="truncate">{branch.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add components/ui/multi-select-branches.tsx
git commit -m "feat: add MultiSelectBranches shared component"
```

---

### Task 7: `StaffTable.tsx` — multi-select branch editing

**Files:**
- Modify: `components/manager/StaffTable.tsx` (whole file)

**Interfaces:**
- Consumes: `MultiSelectBranches` (Task 6), `updateStaffBranchesAction` (Task 5), `Profile.branch_ids` (Task 4).
- Produces: manager dashboard's Staff Table now edits a multi-select set per row. Task 9 depends on `StaffRow` here matching what `app/(app)/manager/page.tsx` passes in.

- [ ] **Step 1: Replace the file**

```tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelectBranches } from "@/components/ui/multi-select-branches";
import { updateStaffBranchesAction, updateStaffRoleAction } from "@/actions/staff";
import { ROLE_HIERARCHY, ROLE_LABELS, isManagerRole } from "@/lib/roles";
import type { Branch, Profile, Role } from "@/types";

type StaffRow = Pick<Profile, "id" | "full_name" | "phone" | "role" | "branch_ids">;

export default function StaffTable({
  staff,
  branches,
  currentUserId,
}: {
  staff: StaffRow[];
  branches: Branch[];
  currentUserId: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Họ tên</th>
            <th className="px-4 py-2 font-medium">Điện thoại</th>
            <th className="px-4 py-2 font-medium">Vai trò</th>
            <th className="px-4 py-2 font-medium">Cơ sở</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((member) => (
            <tr key={member.id} className="border-t">
              <td className="px-4 py-2">
                {member.full_name}
                {member.id === currentUserId && (
                  <span className="ml-1 text-xs text-muted-foreground">(bạn)</span>
                )}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{member.phone || "—"}</td>
              <RoleAndBranchCells member={member} branches={branches} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Role and branch are edited together because they're not independent: the
// 4 manager-tier roles run every cơ sở at once, so switching a person into
// one of those roles must also clear their branch assignments — not just
// hide the picker, or a manager promoted from front-line staff would stay
// silently locked to their old branches everywhere else in the app.
function RoleAndBranchCells({
  member,
  branches,
}: {
  member: StaffRow;
  branches: Branch[];
}) {
  const [role, setRole] = useState<Role>(member.role);
  const [branchIds, setBranchIds] = useState<string[]>(member.branch_ids);
  const [isPending, startTransition] = useTransition();

  function handleRoleChange(value: string) {
    const previousRole = role;
    const next = value as Role;
    setRole(next);
    startTransition(async () => {
      const result = await updateStaffRoleAction(member.id, next);
      if (!result.ok) {
        setRole(previousRole);
        toast.error(result.error);
        return;
      }
      toast.success("Đã cập nhật vai trò");

      if (isManagerRole(next) && branchIds.length > 0) {
        const branchResult = await updateStaffBranchesAction(member.id, []);
        if (branchResult.ok) setBranchIds([]);
      }
    });
  }

  function handleBranchesChange(next: string[]) {
    const previous = branchIds;
    setBranchIds(next);
    startTransition(async () => {
      const result = await updateStaffBranchesAction(member.id, next);
      if (!result.ok) {
        setBranchIds(previous);
        toast.error(result.error);
        return;
      }
      toast.success("Đã cập nhật cơ sở");
    });
  }

  return (
    <>
      <td className="px-4 py-2">
        <Select value={role} onValueChange={handleRoleChange} disabled={isPending}>
          <SelectTrigger size="sm" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_HIERARCHY.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-4 py-2">
        {isManagerRole(role) ? (
          <span className="text-xs text-muted-foreground">Toàn hệ thống</span>
        ) : (
          <MultiSelectBranches
            branches={branches}
            value={branchIds}
            onChange={handleBranchesChange}
            disabled={isPending}
            placeholder="Chưa gán"
          />
        )}
      </td>
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: `components/manager/StaffTable.tsx` no longer in the error list. `app/(app)/manager/page.tsx` (which passes `staff` into this component) still errors until Task 9 — expected.

- [ ] **Step 3: Commit**

```bash
git add components/manager/StaffTable.tsx
git commit -m "feat: multi-select branch editing in Staff Table"
```

---

### Task 8: Register form — multi-select branches at signup

**Files:**
- Modify: `lib/validations/auth.ts:25-38`
- Modify: `components/auth/RegisterForm.tsx` (the branch field block, lines 121-144, plus the import line and submit handler are unaffected)
- Modify: `actions/auth.ts:36-65` (`signUpAction` only)

**Interfaces:**
- Consumes: `MultiSelectBranches` (Task 6).
- Produces: `RegisterInput.branch_ids: string[]` (replaces `branch_id: string`). `signUpAction` passes `branch_ids` through `signUp()`'s metadata, matching what Task 3's `handle_new_user()` reads.

- [ ] **Step 1: Update `registerSchema`**

In `lib/validations/auth.ts`, replace the `registerSchema` block (lines 25-37):

```ts
export const registerSchema = z
  .object({
    full_name: z.string().min(2, "Vui lòng nhập họ tên"),
    email: emailField,
    password: passwordField,
    confirm_password: z.string(),
    branch_ids: z.array(z.uuid()).min(1, "Vui lòng chọn ít nhất 1 cơ sở"),
    role: z.enum(SELF_SIGNUP_ROLES, "Vui lòng chọn vai trò"),
  })
  .refine((v) => v.password === v.confirm_password, {
    message: "Mật khẩu xác nhận không khớp",
    path: ["confirm_password"],
  });
export type RegisterInput = z.infer<typeof registerSchema>;
```

- [ ] **Step 2: Update `RegisterForm.tsx`'s branch field**

Add the import (alongside the existing `Select` import block):
```tsx
import { MultiSelectBranches } from "@/components/ui/multi-select-branches";
```

Replace lines 121-144 (the `branch_id` field block):

```tsx
          <div className="space-y-1.5">
            <Label htmlFor="branch_ids">Cơ sở</Label>
            <Controller
              control={control}
              name="branch_ids"
              defaultValue={[]}
              render={({ field }) => (
                <MultiSelectBranches
                  branches={branches}
                  value={field.value ?? []}
                  onChange={field.onChange}
                  placeholder="Chọn cơ sở làm việc"
                />
              )}
            />
            {errors.branch_ids && (
              <p className="text-sm text-destructive">{errors.branch_ids.message}</p>
            )}
          </div>
```

- [ ] **Step 3: Update `signUpAction`**

In `actions/auth.ts`, replace lines 42-48:

```ts
  const { full_name, email, password, branch_ids, role } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name, branch_ids, role } },
  });
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: `lib/validations/auth.ts`, `components/auth/RegisterForm.tsx`, `actions/auth.ts` clean.

- [ ] **Step 5: Manual end-to-end verification**

Using the same admin-create + sign-in test pattern as Task 2/3 (do NOT use the real `/register` page against production for this, to avoid creating a stray real-looking account — call `signUpAction` logic's equivalent directly via `supabase.auth.admin.createUser` with `user_metadata: { branch_ids: [id1, id2], role: "teacher", full_name: "..." }`, matching exactly what the real form would send): confirm the resulting profile has exactly those 2 `profile_branches` rows, then delete the test user.

- [ ] **Step 6: Commit**

```bash
git add lib/validations/auth.ts components/auth/RegisterForm.tsx actions/auth.ts
git commit -m "feat: multi-select branches on the register form"
```

---

### Task 9: Nag banner + manager dashboard KPI + Staff Table data fetch

**Files:**
- Modify: `app/(app)/layout.tsx:63-67`
- Modify: `app/(app)/manager/page.tsx` (the `staff` fetch at lines 90-93, the cast at line 125, and both `unassignedStaff` computations at lines 185 and 198)

**Interfaces:**
- Consumes: `Profile.branch_ids` (Task 4), `StaffRow` from `StaffTable.tsx` now expecting `branch_ids` (Task 7).

- [ ] **Step 1: Update the nag banner**

In `app/(app)/layout.tsx`, replace lines 59-67:

```tsx
      {/* Manager-tier roles (ceo/coo/training_director/technical) never have
          any profile_branches rows by design — they run every cơ sở at once
          (see isManagerRole in lib/roles.ts). Only front-line roles with
          zero branch memberships get the nag; a manager having none isn't a
          data problem. */}
      {profile.branch_ids.length === 0 && !isManager && (
        <div className="border-b bg-destructive/10 px-4 py-2 text-center text-sm text-destructive sm:px-6">
          Bạn chưa được gán cơ sở làm việc. Vui lòng liên hệ quản lý.
        </div>
      )}
```

- [ ] **Step 2: Update the manager dashboard's staff fetch**

In `app/(app)/manager/page.tsx`, replace line 92:

```ts
      .select("id, full_name, phone, role, profile_branches(branch_id)")
```

Replace line 125:

```ts
  type StaffQueryRow = Pick<Profile, "id" | "full_name" | "phone" | "role"> & {
    profile_branches: { branch_id: string }[];
  };
  const staffList = ((staff as StaffQueryRow[] | null) ?? []).map((s) => ({
    id: s.id,
    full_name: s.full_name,
    phone: s.phone,
    role: s.role,
    branch_ids: s.profile_branches.map((pb) => pb.branch_id),
  }));
```

(This makes `staffList`'s element type exactly `Pick<Profile, "id" | "full_name" | "phone" | "role" | "branch_ids">` — matches what `StaffTable.tsx`'s `StaffRow` now expects, no separate type import needed since it's inferred.)

Replace line 185:

```ts
          unassignedStaff={scopedStaff.filter((s) => s.branch_ids.length === 0).length}
```

Replace line 198:

```ts
          unassignedStaff={staffList.filter((s) => s.branch_ids.length === 0 && !isManagerRole(s.role)).length}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean — this was the last file in the error set from Task 4 Step 3.

- [ ] **Step 4: Commit**

```bash
git add app/"(app)"/layout.tsx app/"(app)"/manager/page.tsx
git commit -m "feat: flip nag banner and unassigned-staff KPI to branch_ids"
```

---

### Task 10: Shift creation — assignee-scoped branch picker

**Files:**
- Modify: `app/(app)/calendar/page.tsx` (the `branchMembers` select at line 41 and the cast/prop at lines 112)
- Modify: `components/calendar/ShiftCalendarLoader.tsx` (the `branchMembers` prop type)
- Modify: `components/calendar/ShiftCalendar.tsx` (the `branchMembers` prop type only — no new logic needed here, `ShiftFormDialog` receives the same `branchMembers` prop unchanged and does its own filtering)
- Modify: `components/shifts/ShiftFormDialog.tsx` (whole file)
- Modify: `actions/shifts.ts` (add a shared branch-membership check, used by both `createShiftAction` and `updateShiftAction`)

**Interfaces:**
- Consumes: `Profile.branch_ids` (Task 4), `is_branch_member` RPC (already exists), `isManagerRole` (`lib/roles.ts`, already exists).
- Produces: `ShiftFormDialog`'s branch `<Select>` narrows to the selected assignee's branches (or stays unrestricted for a management-tier assignee); the server independently rejects a mismatched branch even if the client is bypassed.

- [ ] **Step 1: Widen `branchMembers` to carry `branch_ids`**

In `app/(app)/calendar/page.tsx`, line 41, change:
```ts
    supabase.from("profiles").select("id, full_name, role").order("full_name"),
```
to:
```ts
    supabase.from("profiles").select("id, full_name, role, profile_branches(branch_id)").order("full_name"),
```

Line 112, change:
```tsx
      branchMembers={(branchMembers as Pick<Profile, "id" | "full_name" | "role">[]) ?? []}
```
to:
```tsx
      branchMembers={
        (
          (branchMembers as (Pick<Profile, "id" | "full_name" | "role"> & { profile_branches: { branch_id: string }[] })[] | null) ?? []
        ).map((m) => ({ id: m.id, full_name: m.full_name, role: m.role, branch_ids: m.profile_branches.map((pb) => pb.branch_id) }))
      }
```

- [ ] **Step 2: Widen the prop type in `ShiftCalendarLoader.tsx`**

Change:
```ts
  branchMembers: Pick<Profile, "id" | "full_name" | "role">[];
```
to:
```ts
  branchMembers: Pick<Profile, "id" | "full_name" | "role" | "branch_ids">[];
```

- [ ] **Step 3: Widen the prop type in `ShiftCalendar.tsx`**

Same change as Step 2 — find the identical `branchMembers: Pick<Profile, "id" | "full_name" | "role">[];` line in `ShiftCalendar.tsx`'s prop type and update it the same way. (The `coworkers`/`followGroups` memos already built in this file don't need `branch_ids` and are unaffected — this is purely a type widening so the value can flow through to `ShiftFormDialog` unchanged.)

- [ ] **Step 4: Filter the branch picker in `ShiftFormDialog.tsx` by the selected assignee**

Add the import (alongside existing imports):
```tsx
import { isManagerRole } from "@/lib/roles";
```

Change the `branchMembers` prop type (line 71):
```tsx
  branchMembers: Pick<Profile, "id" | "full_name" | "role" | "branch_ids">[];
```

Inside the component, after the `useForm` destructure (after line 95), add:
```tsx
  const selectedAssigneeId = watch("assignee_id");
  const selectedAssignee = branchMembers.find((m) => m.id === selectedAssigneeId);
  const allowedBranches = !selectedAssignee || isManagerRole(selectedAssignee.role)
    ? branches
    : branches.filter((b) => selectedAssignee.branch_ids.includes(b.id));

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
    }
    previousAssigneeIdRef.current = selectedAssigneeId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssigneeId]);
```

Add `watch`, `getValues`, `setValue` to the existing `useForm` destructure (line 89-95), and add `useEffect`, `useRef` to the React import (line 3):
```tsx
import { useEffect, useRef, useState } from "react";
```
```tsx
  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });
```

Change the branch `<Select>`'s options (line 213, inside the `branch_id` Controller's `SelectContent`):
```tsx
                    {allowedBranches.map((branch) => (
```
(replacing `{branches.map((branch) => (` — only this one line changes inside that block, the rest of the `SelectItem`/closing tags stay identical).

- [ ] **Step 5: Server-side validation in `actions/shifts.ts`**

Add a shared helper and call it from both `createShiftAction` and `updateShiftAction`. Insert after the imports (after line 7):

```ts
import { isManagerRole } from "@/lib/roles";

async function assertBranchAllowed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  assigneeId: string,
  branchId: string
): Promise<string | null> {
  const { data: assignee } = await supabase.from("profiles").select("role").eq("id", assigneeId).single();
  if (!assignee) return "Không tìm thấy nhân viên này";
  if (isManagerRole(assignee.role)) return null;

  const { data: isMember } = await supabase.rpc("is_branch_member", {
    p_profile_id: assigneeId,
    p_branch_id: branchId,
  });
  return isMember ? null : "Nhân viên này không thuộc cơ sở đã chọn";
}
```

In `createShiftAction`, after `const supabase = await createClient();` (line 29) and before the `getUser()` call, insert:
```ts
  const branchError = await assertBranchAllowed(supabase, parsed.data.assignee_id, parsed.data.branch_id);
  if (branchError) return { ok: false, error: branchError };
```

In `updateShiftAction`, after `const supabase = await createClient();` (line 61), insert the same two lines:
```ts
  const branchError = await assertBranchAllowed(supabase, parsed.data.assignee_id, parsed.data.branch_id);
  if (branchError) return { ok: false, error: branchError };
```

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: `tsc` clean. `eslint` clean of errors — this file's new `watch("assignee_id")` call will very likely add ONE new "Compilation Skipped: Use of incompatible library" warning (React Compiler + react-hook-form's `watch()`), the same pre-existing, non-blocking warning already present for this exact reason in `components/leave/LeaveRequestDialog.tsx` and `components/calendar/CustomEventFormDialog.tsx` (session baseline was 0 errors / 2 warnings — 3 warnings here is expected, not a regression to chase down).

- [ ] **Step 7: Manual verification**

Dev-server smoke test (`npm run dev`, sign in as a manager-tier test account): open "Tạo ca làm việc", pick a front-line assignee who belongs to only 1 of the 3 branches — confirm the "Cơ sở" dropdown only shows that branch. Switch the assignee to one at a different branch — confirm the branch field resets and the dropdown updates. Pick a management-tier assignee (if any test account exists) — confirm all 3 branches remain selectable.

- [ ] **Step 8: Commit**

```bash
git add app/"(app)"/calendar/page.tsx components/calendar/ShiftCalendarLoader.tsx components/calendar/ShiftCalendar.tsx components/shifts/ShiftFormDialog.tsx actions/shifts.ts
git commit -m "feat: scope shift-creation branch picker to the assignee's branches"
```

---

### Task 11: Self-service shift request — requester-scoped branch picker

**Files:**
- Modify: `components/shifts/ShiftRequestDialog.tsx` (whole file — add a new prop)
- Modify: `components/calendar/CalendarSidebar.tsx` (thread the new prop through to `ShiftRequestDialog`'s two render sites)
- Modify: `components/calendar/ShiftCalendar.tsx` (compute the requestable-branches list and pass it down)

**Interfaces:**
- Consumes: `branchMembers` (already includes `branch_ids` as of Task 10), `currentUserId`, `currentUserRole`, `isManagerRole` (`lib/roles.ts`).
- Produces: `ShiftRequestDialog` now takes a `requestableBranches: Branch[]` prop instead of the unfiltered `branches` prop for its own picker (the sidebar's separate "Cơ sở" visibility-filter section keeps using the full unfiltered `branches` list — unaffected, different feature).

- [ ] **Step 1: Compute `requestableBranches` in `ShiftCalendar.tsx`**

Add this memo near the existing `followGroups`/`coworkers` memos (same file, anywhere after `branchMembers` is available):

```tsx
  // ShiftRequestDialog only ever renders for the current viewer requesting
  // their OWN shift, so this is scoped to their branches, not the
  // assignee-varies logic ShiftFormDialog needs. Management-tier requesters
  // (training_director, notably — manager-tier but not in
  // DIRECT_SHIFT_ROLES, so they use this dialog too) still see every
  // branch, matching their "all branches" status everywhere else.
  const requestableBranches = useMemo(() => {
    if (isManagerRole(currentUserRole)) return branches;
    const self = branchMembers.find((m) => m.id === currentUserId);
    return branches.filter((b) => self?.branch_ids.includes(b.id));
  }, [branches, branchMembers, currentUserId, currentUserRole]);
```

Add the import alongside the existing `getCalendarFollowGroups` import:
```tsx
import { getCalendarFollowGroups, isManagerRole } from "@/lib/roles";
```

Add `requestableBranches` to `sidebarProps` (alongside the existing `branches` entry):
```tsx
    requestableBranches,
```

- [ ] **Step 2: Thread the prop through `CalendarSidebar.tsx`**

Add `requestableBranches: Branch[];` to `SidebarProps` (alongside the existing `branches: Branch[];` field).

Add `requestableBranches` to `SidebarContent`'s destructured props (alongside `branches`).

Find the two `<ShiftRequestDialog branches={branches} />` render sites (one inside `SidebarContent`'s top action button block, `!canManageShifts` branch; check whether there's a second one elsewhere in the file used for the quick-create/day-slot flow — if only one exists, only that one changes) and change `branches={branches}` to `branches={requestableBranches}` at each.

- [ ] **Step 3: No change needed inside `ShiftRequestDialog.tsx` itself**

Its `branches` prop already means "what should populate this picker" — Steps 1-2 change what gets passed in, not the component. Confirm this by re-reading the file after Steps 1-2: the `branches.map(...)` in its `SelectContent` now iterates the pre-filtered list automatically.

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 5: Manual verification**

Dev-server smoke test: sign in as a front-line test account assigned to exactly 1 branch, open "Đăng ký ca làm" — confirm the "Cơ sở" dropdown shows only that branch. Sign in as `training_director` (if a test account exists) — confirm all 3 branches are selectable there.

- [ ] **Step 6: Commit**

```bash
git add components/shifts/ShiftRequestDialog.tsx components/calendar/CalendarSidebar.tsx components/calendar/ShiftCalendar.tsx
git commit -m "feat: scope self-service shift-request branch picker to the requester's branches"
```

---

### Task 12: Full end-to-end verification pass

**Files:** none (verification only)

- [ ] **Step 1: `tsc`/`eslint`/`build` clean**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all three clean.

- [ ] **Step 2: Multi-branch person visible at every branch they belong to**

Using the admin-create-test-user + sign-in pattern established in Tasks 2/3: create a test profile with `profile_branches` rows for Branch 1 AND Branch 2 (via `set_profile_branches` RPC as a manager, or directly via `admin.from("profile_branches").insert(...)`), give them one shift at Branch 1 and one at Branch 2. Sign in as a DIFFERENT test profile who is a member of Branch 2 only — confirm they can see the Branch-2 shift of the multi-branch person (`shifts_select_branch` widening) but NOT the Branch-1 one. Delete all test data afterward.

- [ ] **Step 3: Removing a person's only branch membership removes their visibility there**

Using the manager-facing `set_profile_branches` RPC (or Staff Table UI in the dev server), remove a test profile's sole branch membership. Confirm a colleague at that branch can no longer see the person's profile/shifts via a direct RLS-scoped query. Restore/delete test data afterward.

- [ ] **Step 4: Register → Staff Table → Shift creation loop**

In the dev server: register a brand-new throwaway test account picking 2 branches. Confirm it lands with both memberships (check via Staff Table, showing 2 badge chips). As a manager, create a shift for this person — confirm the branch picker only offers those 2 branches. As this person, open "Đăng ký ca làm" — confirm the same 2-branch restriction. Delete the test account and any shifts/requests created for it afterward (mirroring the cleanup discipline used throughout this session).

- [ ] **Step 5: Report status, do not proceed to Task 13 automatically**

If any check above fails, stop and fix before Task 13 — dropping `profiles.branch_id` is not easily reversible once other code no longer references it as a fallback.

---

### Task 13: Drop `profiles.branch_id` and `current_branch_id()` — final cleanup

**Only start this task after Task 12 passes completely.**

**Files:**
- Create: `supabase/migrations/0035_drop_legacy_branch_column.sql`

- [ ] **Step 1: Confirm zero remaining references**

Run: `grep -rn "\.branch_id\b" app/ actions/ components/ lib/ --include="*.ts" --include="*.tsx" | grep -v "shift\|attendance\|leave_request\|swap\|profile_branches\|is_branch_member"`
Expected: no output (any remaining `.branch_id` reads should only be on `Shift`/`Attendance`/`LeaveRequest`/`SwapRequest`-shaped values, which are unrelated columns on other tables and correctly untouched by this feature).

- [ ] **Step 2: Write the migration**

```sql
-- Final cutover step — only run after every branch-reading surface (Register,
-- Staff Table, shift creation, shift requests, nag banner, dashboard KPI)
-- has been manually verified working off profile_branches (see
-- docs/superpowers/plans/2026-08-07-multi-branch-staff-cutover.md Task 12).
alter table public.profiles drop column branch_id;
drop function if exists public.current_branch_id();
```

- [ ] **Step 3: Apply and verify**

Run: `supabase db push`. Verify:
```sql
select column_name from information_schema.columns where table_name = 'profiles' and column_name = 'branch_id';
-- expect 0 rows
select count(*) from pg_proc where proname = 'current_branch_id';
-- expect 0
```
Then re-run the full app smoke test from Task 12 Step 4 once more against the now-cleaned-up schema, to confirm nothing was silently relying on the dropped column/function.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0035_drop_legacy_branch_column.sql
git commit -m "chore: drop legacy profiles.branch_id and current_branch_id() after multi-branch cutover"
```

---

## Self-Review

**Spec coverage:** Data model + backfill → Task 1. RLS/RPC rewrite → Task 2. `set_profile_branches`/`handle_new_user`/`request_leave` → Task 3. `Profile` type → Task 4. Staff Table write path → Task 5, UI → Task 7. Register form → Task 8. Nag banner/KPI → Task 9. Shift creation filtering → Task 10. Self-request filtering → Task 11. Final verification + column drop → Tasks 12-13. Every section of `docs/superpowers/specs/2026-08-07-multi-branch-staff-cutover-design.md` has a corresponding task.

**Placeholder scan:** No TBD/TODO; every step has literal code, not a description of code.

**Type consistency:** `Profile.branch_ids: string[]` (Task 4) is the single name used everywhere downstream (Tasks 5, 7-11) — verified no lingering `branch_id` singular reference on a `Profile`-shaped value outside Task 13's final grep check. `set_profile_branches(p_profile_id uuid, p_branch_ids uuid[])` (Task 3) matches the exact call signature used in `updateStaffBranchesAction` (Task 5). `MultiSelectBranches({ branches, value, onChange, disabled?, placeholder? })` (Task 6) matches both call sites (Tasks 7, 8) exactly.
