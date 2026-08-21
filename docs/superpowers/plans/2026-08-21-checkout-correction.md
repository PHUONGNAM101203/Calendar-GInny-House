# Check-out Correction & Free-Typed Time Input — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff file a "giải trình công" for their check-out time with a freely-chosen time, and let every time field in the app accept typed input alongside its dropdown.

**Architecture:** Extend the existing `attendance_corrections` table with check-out columns and two new `issue_type` enum values rather than building a parallel system — the lifecycle, RLS, approval authority, batch submit action and card UI are all reused unchanged. A generated `kind` column (`check_in`/`check_out`) discriminates the two flows. The shared `TimePickerField` gains a typed input while keeping its dropdown and its existing prop contract, so all six current consumers benefit with no call-site changes.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TypeScript strict, Supabase Postgres (RLS + `security definer` RPCs), Zod v4, Tailwind v4, shadcn/ui.

## Global Constraints

- **All user-facing copy is Vietnamese.** Code identifiers and comments are English.
- **Never modify `request_attendance_correction`** (the check-in RPC, live in `0042`). Check-out gets its own RPC. The existing check-in flow must behave identically after this work.
- **Server Actions:** input typed `unknown`, validated with `schema.safeParse` (never `parse`), return `Promise<ActionResult>`, auth-guard first via `requireProfile()`/`requireManager()`.
- **Raw Postgres errors are never surfaced.** Every new `raise exception` message MUST be added to `mapAttendanceCorrectionError`'s whitelist in `actions/attendance-corrections.ts` or it silently collapses to the generic fallback.
- **Business logic lives in Postgres**, invoked via `supabase.rpc(...)`. Actions stay thin: validate → RPC → map error → revalidate → return.
- **Migration naming:** `00NN_description.sql`, zero-padded 4 digits, snake_case. Next free numbers are `0070` and `0071`.
- **No test runner exists in this project.** Verification is `npx tsc --noEmit`, `npm run lint`, SQL assertions run through a scratch script, and manual browser checks.
- **Feature-component filenames are PascalCase**; `components/ui/` primitives are kebab-case.
- Timezone is `Asia/Ho_Chi_Minh`. SQL date math must use `at time zone 'Asia/Ho_Chi_Minh'`, matching the existing RPCs.

---

## File Structure

**Created:**
- `supabase/migrations/0070_attendance_correction_checkout_enum.sql` — enum values only, alone in its own migration (see Task 2 for why).
- `supabase/migrations/0071_attendance_correction_checkout.sql` — columns, constraints, index, and all three RPCs.

**Modified:**
- `lib/time-options.ts` — add `normalizeTimeInput`, `timeToMinutes`.
- `components/ui/time-picker-field.tsx` — typed input + dropdown.
- `types/index.ts:122-143` — extend the correction types.
- `lib/constants.ts:42-45` — two new issue labels.
- `lib/validations/attendance-correction.ts` — check-out schema.
- `actions/attendance-corrections.ts` — new action, extended preview, extended error whitelist.
- `components/attendance/AttendanceCorrectionForm.tsx` — kind selector + time input.
- `components/attendance/AttendanceCorrectionCard.tsx:31-34,126-133` — icons + check-out copy.
- `lib/calendar.ts` — one-pending-per-shift becomes one-per-shift-per-kind.

---

### Task 1: Free-typed time input

Self-contained and shippable on its own. Every other time field in the app
(`ShiftFormDialog`, `ShiftRequestDialog`, `AttendanceDetailDialog`,
`CreateAttendanceManualDialog`, `LeaveRequestDialog`, `CustomEventFormDialog`)
gains typing for free because the prop contract does not change.

**Files:**
- Modify: `lib/time-options.ts`
- Modify: `components/ui/time-picker-field.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeTimeInput(raw: string): string | null` and
  `timeToMinutes(value: string): number | null` from `@/lib/time-options`.
  Task 6 uses `normalizeTimeInput`. `TimePickerField`'s props are unchanged:
  `{ id: string; label: string; value: string; onChange: (value: string) => void }`
  with `value` in `"HH:mm"`.

- [ ] **Step 1: Add the parsing helpers**

Append to `lib/time-options.ts`:

```ts
// Parses a user-typed time into canonical "HH:mm", or null when the text
// cannot be read as a time. Deliberately permissive about separators and
// zero-padding — staff type "19:20", "1920", "19h20" and "9:5"
// interchangeably — but it never guesses: anything out of range returns null
// so the caller can reject it rather than silently storing a wrong time.
export function normalizeTimeInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // "19h20" / "19.20" / "19 20" all collapse to the "19:20" form.
  const unified = trimmed.toLowerCase().replace(/[hg.\s]+/g, ":");

  let hours: number;
  let minutes: number;

  if (unified.includes(":")) {
    const [rawHours, rawMinutes = "0"] = unified.split(":");
    hours = Number(rawHours === "" ? "0" : rawHours);
    minutes = Number(rawMinutes === "" ? "0" : rawMinutes);
  } else if (/^\d{3,4}$/.test(unified)) {
    // "1920" -> 19:20, "920" -> 9:20
    hours = Number(unified.slice(0, unified.length - 2));
    minutes = Number(unified.slice(-2));
  } else if (/^\d{1,2}$/.test(unified)) {
    // A bare hour: "19" -> 19:00
    hours = Number(unified);
    minutes = 0;
  } else {
    return null;
  }

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// Minutes since midnight, or null when unparseable. Used to find the nearest
// dropdown entry for a freely-typed time.
export function timeToMinutes(value: string): number | null {
  const normalized = normalizeTimeInput(value);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}
```

- [ ] **Step 2: Rewrite the component**

Replace the whole body of `components/ui/time-picker-field.tsx` with:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ClockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TIME_OPTIONS, normalizeTimeInput, timeToMinutes } from "@/lib/time-options";
import { cn } from "@/lib/utils";

// A typed time field with a dropdown of 15-minute marks beside it — type any
// minute (19:20, 19:47) or pick a common one from the list. Times display in
// 24-hour form, matching how every other surface in this app renders a time
// (shift cards, overview tables) and how the value is stored.
export function TimePickerField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const activeRef = useRef<HTMLButtonElement>(null);
  const touchStartY = useRef(0);

  // Resync when the value changes from outside (a dropdown pick, or the
  // parent form resetting) — typing is committed on blur, so this never
  // fights the user mid-entry.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  // The value may now be any minute, which usually isn't in the 15-minute
  // TIME_OPTIONS list — scroll to the closest entry rather than nothing.
  const nearestOption = useMemo(() => {
    const target = timeToMinutes(value);
    if (target === null) return TIME_OPTIONS[0];
    return TIME_OPTIONS.reduce((best, option) => {
      const bestDistance = Math.abs((timeToMinutes(best) ?? 0) - target);
      const optionDistance = Math.abs((timeToMinutes(option) ?? 0) - target);
      return optionDistance < bestDistance ? option : best;
    }, TIME_OPTIONS[0]);
  }, [value]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => activeRef.current?.scrollIntoView({ block: "center" }));
    }
  }, [open]);

  // Committed on blur/Enter rather than per keystroke: "1" and "19" are both
  // legitimate prefixes of "19:20", so normalizing mid-typing would fight the
  // user. Unreadable text snaps back to the last good value — never guess.
  function commitDraft() {
    const normalized = normalizeTimeInput(draft);
    if (!normalized) {
      setDraft(value);
      return;
    }
    setDraft(normalized);
    if (normalized !== value) onChange(normalized);
  }

  // This popover portals outside the parent Dialog's DOM subtree, so Radix's
  // modal scroll lock (react-remove-scroll) treats wheel/touch scrolling here
  // as happening "outside the dialog" and blocks it document-wide — only
  // dragging the scrollbar thumb survives that block. Scroll the list
  // manually instead of relying on native wheel/touch scroll.
  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.currentTarget.scrollTop += e.deltaY;
  }

  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    touchStartY.current = e.touches[0].clientY;
  }

  function handleTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    const currentY = e.touches[0].clientY;
    e.currentTarget.scrollTop += touchStartY.current - currentY;
    touchStartY.current = currentY;
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          value={draft}
          inputMode="numeric"
          placeholder="19:20"
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft();
              e.currentTarget.blur();
            }
          }}
          className="h-11 pr-10 font-heading text-base tabular-nums"
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Chọn ${label.toLowerCase()} từ danh sách`}
              className="absolute top-1/2 right-1 size-9 -translate-y-1/2 text-muted-foreground"
            >
              <ClockIcon className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="max-h-64 w-32 overflow-y-auto p-1"
            onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
          >
            <div className="flex flex-col">
              {TIME_OPTIONS.map((t) => {
                const active = t === value;
                return (
                  <button
                    key={t}
                    ref={t === nearestOption ? activeRef : undefined}
                    type="button"
                    onClick={() => {
                      onChange(t);
                      setOpen(false);
                    }}
                    className={cn(
                      "rounded-md px-2.5 py-1.5 text-left text-sm tabular-nums transition-colors hover:bg-accent",
                      active && "bg-primary text-primary-foreground hover:bg-primary"
                    )}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify it compiles and lints**

```bash
npx tsc --noEmit && npm run lint
```

Expected: no errors. Three pre-existing `react-hooks/incompatible-library`
warnings about `react-hook-form`'s `watch()` are unrelated and stay.

- [ ] **Step 4: Verify in the browser**

```bash
npm run dev
```

Open `/calendar`, open "Tạo ca làm việc". For the Bắt đầu / Kết thúc fields:
- Type `19:20`, tab away → shows `19:20`.
- Type `1947`, tab away → shows `19:47`.
- Type `9h5`, tab away → shows `09:05`.
- Type `abc`, tab away → snaps back to the previous value.
- Type `25:00`, tab away → snaps back (hour out of range).
- Click the clock icon → dropdown opens scrolled near the current time; picking an entry updates the field.
- Confirm the shift saves with the typed time.

- [ ] **Step 5: Commit**

```bash
git add lib/time-options.ts components/ui/time-picker-field.tsx
git commit -m "feat: accept typed times in TimePickerField alongside the dropdown"
```

---

### Task 2: Enum values migration

**Files:**
- Create: `supabase/migrations/0070_attendance_correction_checkout_enum.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `attendance_correction_issue` enum values `missed_check_out` and
  `adjust_check_out`, usable by Task 3.

- [ ] **Step 1: Write the migration**

```sql
-- Adds the two check-out issue types, deliberately ALONE in their own
-- migration. PostgreSQL will not let a value added by ALTER TYPE be *used*
-- in the same transaction that added it, and Supabase runs each migration
-- file inside one transaction — so 0071, which inserts and compares these
-- values, must be a separate file that runs after this one commits.
alter type public.attendance_correction_issue add value if not exists 'missed_check_out';
alter type public.attendance_correction_issue add value if not exists 'adjust_check_out';
```

- [ ] **Step 2: Apply it**

```bash
supabase db push
```

Expected: `Finished supabase db push.` listing `0070_attendance_correction_checkout_enum.sql`.

- [ ] **Step 3: Verify the table is still reachable**

The authoritative check on the enum labels is Task 3 — if they were missing,
`0071` fails to apply with `invalid input value for enum`. Here just confirm
the migration did not disturb the table. Create `_tmp-verify.mjs` in the repo
root (the scratchpad lives outside the project so ESM cannot resolve
`@supabase/supabase-js` from there; this file is deleted in the same command):

```js
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const probe = await admin.from("attendance_corrections").select("issue_type").limit(1);
console.log(JSON.stringify({ reachable: !probe.error, error: probe.error?.message ?? null }));
```

```bash
node _tmp-verify.mjs; rm -f _tmp-verify.mjs
```

Expected: `{"reachable":true,"error":null}`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0070_attendance_correction_checkout_enum.sql
git commit -m "feat(db): add check-out issue types to attendance_correction_issue"
```

---

### Task 3: Schema and RPCs migration

**Files:**
- Create: `supabase/migrations/0071_attendance_correction_checkout.sql`

**Interfaces:**
- Consumes: the enum values from Task 2.
- Produces:
  - Columns `actual_check_out_at timestamptz`, `requested_check_out_at timestamptz`,
    and generated `kind text` (`'check_in'` | `'check_out'`) on `attendance_corrections`.
  - RPC `request_attendance_correction_checkout(p_shift_id uuid, p_requested_check_out_at timestamptz, p_reason text)`.
  - Updated `respond_to_attendance_correction(p_id uuid, p_approve boolean)`.
  - Updated `revert_attendance_correction(p_id uuid)`.
  - New Vietnamese error strings consumed by Task 5's whitelist:
    `'Vui lòng chọn giờ ra ca'`, `'Ca này chưa có giờ vào — vui lòng giải trình giờ vào trước'`,
    `'Giờ ra phải sau giờ vào'`, `'Giờ ra không được ở tương lai'`,
    `'Giờ ra phải cùng ngày với ca làm việc'`,
    `'Ca này đã có đơn giải trình giờ ra đang chờ duyệt'`.

- [ ] **Step 1: Write the schema half of the migration**

```sql
-- Check-out giải trình công. Additive: every existing check-in column, RPC
-- and policy keeps its current behaviour — request_attendance_correction
-- (0042) is deliberately NOT touched. What is new is that the requested time
-- is supplied by the user instead of being forced to the shift boundary,
-- because a staff member who clocked out at 19:40 may legitimately need the
-- record to read 19:20.

alter table public.attendance_corrections
  add column if not exists actual_check_out_at timestamptz,
  add column if not exists requested_check_out_at timestamptz;

-- requested_check_in_at was NOT NULL back when every correction was a
-- check-in correction. Check-out rows legitimately have no requested
-- check-in, so the NOT NULL moves into the kind-aware CHECK below.
alter table public.attendance_corrections
  alter column requested_check_in_at drop not null;

-- Generated, not stored-by-hand, so it can never drift from issue_type.
alter table public.attendance_corrections
  add column if not exists kind text
  generated always as (
    case
      when issue_type in ('missed_check_out', 'adjust_check_out') then 'check_out'
      else 'check_in'
    end
  ) stored;

-- Written against issue_type, NOT against the generated kind column:
-- PostgreSQL forbids a CHECK constraint from referencing a generated column
-- on the same table.
alter table public.attendance_corrections
  drop constraint if exists attendance_corrections_time_by_issue;
alter table public.attendance_corrections
  add constraint attendance_corrections_time_by_issue check (
    case
      when issue_type in ('missed_check_out', 'adjust_check_out')
        then requested_check_out_at is not null
      else requested_check_in_at is not null
    end
  );

-- Was unique on shift_id alone, which would have made a pending check-in
-- correction block filing a check-out correction for the same shift. One
-- pending correction per shift PER KIND is the correct rule.
drop index if exists attendance_corrections_one_pending_per_shift;
create unique index if not exists attendance_corrections_one_pending_per_shift_kind
  on public.attendance_corrections (shift_id, kind) where status = 'pending';
```

- [ ] **Step 2: Append the request RPC**

```sql
-- Check-out counterpart of request_attendance_correction (0042). Separate
-- function rather than an overload: the check-in flow derives its requested
-- time server-side, this one accepts it from the user, so they share a table
-- but not a signature.
create or replace function public.request_attendance_correction_checkout(
  p_shift_id uuid,
  p_requested_check_out_at timestamptz,
  p_reason text
) returns public.attendance_corrections
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
  if p_requested_check_out_at is null then
    raise exception 'Vui lòng chọn giờ ra ca' using errcode = '23514';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id;
  if v_shift is null or v_shift.assignee_id <> v_uid then
    raise exception 'Không tìm thấy ca làm việc này';
  end if;

  v_shift_date := (v_shift.start_at at time zone 'Asia/Ho_Chi_Minh')::date;
  if (now() at time zone 'Asia/Ho_Chi_Minh')::date - v_shift_date > 7 then
    raise exception 'Đã quá hạn 1 tuần để giải trình ca này';
  end if;

  select * into v_attendance from public.attendance
  where profile_id = v_uid
    and (check_in_at at time zone 'Asia/Ho_Chi_Minh')::date = v_shift_date
  order by check_in_at desc
  limit 1;

  -- A check-out correction closes an existing session; it cannot invent one.
  -- With no check-in there is nothing to close, so send them to the check-in
  -- flow instead of silently fabricating a session.
  if v_attendance is null then
    raise exception 'Ca này chưa có giờ vào — vui lòng giải trình giờ vào trước';
  end if;

  if p_requested_check_out_at <= v_attendance.check_in_at then
    raise exception 'Giờ ra phải sau giờ vào' using errcode = '23514';
  end if;
  if p_requested_check_out_at > now() then
    raise exception 'Giờ ra không được ở tương lai' using errcode = '23514';
  end if;
  if (p_requested_check_out_at at time zone 'Asia/Ho_Chi_Minh')::date <> v_shift_date then
    raise exception 'Giờ ra phải cùng ngày với ca làm việc' using errcode = '23514';
  end if;

  v_issue := case
    when v_attendance.check_out_at is null then 'missed_check_out'
    else 'adjust_check_out'
  end;

  insert into public.attendance_corrections
    (profile_id, shift_id, attendance_id, issue_type,
     actual_check_out_at, requested_check_out_at, reason)
  values
    (v_uid, p_shift_id, v_attendance.id, v_issue,
     v_attendance.check_out_at, p_requested_check_out_at, p_reason)
  returning * into v_row;

  return v_row;
exception
  when unique_violation then
    raise exception 'Ca này đã có đơn giải trình giờ ra đang chờ duyệt';
end;
$$;

grant execute on function public.request_attendance_correction_checkout(uuid, timestamptz, text) to authenticated;
```

- [ ] **Step 3: Append the updated respond RPC**

This is `0059`'s body with one new leading branch; the two check-in branches
are byte-identical to what they replace.

```sql
-- 0059 + a check_out branch. The check-in branches are unchanged.
create or replace function public.respond_to_attendance_correction(p_id uuid, p_approve boolean)
returns public.attendance_corrections
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.attendance_corrections%rowtype;
  v_existing_attendance_id uuid;
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
    if v_row.kind = 'check_out' then
      update public.attendance
      set check_out_at = v_row.requested_check_out_at
      where id = v_row.attendance_id;
    elsif v_row.issue_type = 'missed_check_in' then
      select id into v_existing_attendance_id
      from public.attendance
      where profile_id = v_row.profile_id and shift_id = v_row.shift_id
      order by check_in_at desc
      limit 1;

      if v_existing_attendance_id is not null then
        update public.attendance
        set check_in_at = v_row.requested_check_in_at
        where id = v_existing_attendance_id;
        v_new_attendance_id := v_existing_attendance_id;
      else
        insert into public.attendance (profile_id, branch_id, shift_id, check_in_at)
        select v_row.profile_id, s.branch_id, s.id, v_row.requested_check_in_at
        from public.shifts s where s.id = v_row.shift_id
        returning id into v_new_attendance_id;
      end if;

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
```

- [ ] **Step 4: Append the updated revert RPC**

Two changes from `0058`: the sibling-conflict check is now kind-scoped, and the
`check_out_at is not null` guard (which would refuse *every* approved check-out
correction, since those always leave a check-out set) is now kind-aware.

```sql
-- 0058 + kind awareness. Two specific fixes:
--   1. The "another pending sibling" guard filtered on shift_id alone. Now
--      that one shift may legitimately hold both a pending check-in and a
--      pending check-out correction, that guard has to be kind-scoped or
--      reverting one would be wrongly blocked by the other.
--   2. The `check_out_at is not null` bail-out only makes sense for check-in
--      corrections. An approved check-out correction ALWAYS leaves a
--      check-out set, so applying that guard to it would refuse every revert.
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

  if exists (
    select 1 from public.attendance_corrections
    where shift_id = v_row.shift_id and kind = v_row.kind and id <> p_id and status = 'pending'
  ) then
    raise exception 'Ca này đã có đơn giải trình khác đang chờ duyệt — không thể khôi phục tự động' using errcode = '23514';
  end if;

  if v_row.status = 'approved' then
    if v_row.attendance_id is null then
      raise exception 'Đơn duyệt trước khi có tính năng khôi phục — không thể khôi phục tự động' using errcode = '23514';
    end if;

    select * into v_att from public.attendance where id = v_row.attendance_id;
    if not found then
      raise exception 'Không tìm thấy bản ghi chấm công liên quan — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if v_row.kind = 'check_in' and v_att.check_out_at is not null then
      raise exception 'Bản ghi chấm công đã có giờ ra — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.attendance_corrections
      where attendance_id = v_row.attendance_id and kind = v_row.kind and id <> p_id and status = 'approved'
    ) then
      raise exception 'Bản ghi chấm công đã bị sửa bởi đơn giải trình khác — không thể khôi phục tự động' using errcode = '23514';
    end if;

    if v_row.kind = 'check_out' then
      -- Restores the previous check-out, or reopens the session when the
      -- correction had supplied a missing one (actual_check_out_at is NULL).
      update public.attendance set check_out_at = v_row.actual_check_out_at where id = v_row.attendance_id;
    elsif v_row.issue_type = 'missed_check_in' then
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

> **Watch out:** reverting a `missed_check_out` correction clears `check_out_at`
> back to NULL, reopening the session. `attendance_one_open_per_profile` is a
> partial unique index on `(profile_id) WHERE check_out_at IS NULL`, so this
> fails if that person already has another open session. That is correct
> behaviour — but the unique-violation message is not mapped, so verify in
> Task 8 Step 3 what the user actually sees and add a mapping if it is raw.

- [ ] **Step 5: Apply the migration**

```bash
supabase db push
```

Expected: `Finished supabase db push.` listing `0071_attendance_correction_checkout.sql`.
If it fails with `invalid input value for enum`, Task 2 did not commit first.

- [ ] **Step 6: Verify the schema landed**

Create `_tmp-verify.mjs` in the repo root:

```js
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// The new columns must be selectable, and `kind` must be present.
const { error } = await admin
  .from("attendance_corrections")
  .select("id, kind, issue_type, actual_check_out_at, requested_check_out_at")
  .limit(1);

// Every pre-existing row is a check-in correction.
const { count: checkInRows } = await admin
  .from("attendance_corrections")
  .select("id", { count: "exact", head: true })
  .eq("kind", "check_in");
const { count: totalRows } = await admin
  .from("attendance_corrections")
  .select("id", { count: "exact", head: true });

console.log(JSON.stringify({
  columnsOk: !error,
  error: error?.message ?? null,
  checkInRows,
  totalRows,
  allExistingAreCheckIn: checkInRows === totalRows,
}));
```

```bash
node _tmp-verify.mjs; rm -f _tmp-verify.mjs
```

Expected: `columnsOk: true`, `error: null`, `allExistingAreCheckIn: true`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0071_attendance_correction_checkout.sql
git commit -m "feat(db): check-out attendance corrections with a user-chosen time"
```

---

### Task 4: Types, labels and validation

**Files:**
- Modify: `types/index.ts:122-143`
- Modify: `lib/constants.ts:42-45`
- Modify: `lib/validations/attendance-correction.ts`

**Interfaces:**
- Consumes: the DB shape from Task 3.
- Produces:
  - `AttendanceCorrectionIssue` gains `"missed_check_out" | "adjust_check_out"`.
  - `AttendanceCorrectionKind = "check_in" | "check_out"`.
  - `AttendanceCorrection` gains `kind`, `actual_check_out_at`,
    `requested_check_out_at`; `requested_check_in_at` becomes `string | null`.
  - `checkoutCorrectionSchema` / `CheckoutCorrectionInput` with fields
    `{ shift_id: string; check_out_time: string; reason: string }`, exported
    from `@/lib/validations/attendance-correction`. Tasks 5 and 6 use it.

- [ ] **Step 1: Extend the types**

In `types/index.ts`, replace the correction block:

```ts
export type AttendanceCorrectionStatus = "pending" | "approved" | "rejected" | "cancelled";
export type AttendanceCorrectionIssue =
  | "missed_check_in"
  | "late_check_in"
  | "missed_check_out"
  | "adjust_check_out";
// Generated in Postgres from issue_type (0071) — never set from the client.
export type AttendanceCorrectionKind = "check_in" | "check_out";

export type AttendanceCorrection = {
  id: string;
  profile_id: string;
  shift_id: string;
  attendance_id: string | null;
  issue_type: AttendanceCorrectionIssue;
  kind: AttendanceCorrectionKind;
  // Only the pair matching this row's kind is populated; the CHECK
  // constraint in 0071 enforces that.
  actual_check_in_at: string | null;
  requested_check_in_at: string | null;
  actual_check_out_at: string | null;
  requested_check_out_at: string | null;
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

- [ ] **Step 2: Add the two labels**

In `lib/constants.ts`, replace `ATTENDANCE_CORRECTION_ISSUE_LABELS`:

```ts
export const ATTENDANCE_CORRECTION_ISSUE_LABELS: Record<
  "missed_check_in" | "late_check_in" | "missed_check_out" | "adjust_check_out",
  string
> = {
  missed_check_in: "Quên chấm công",
  late_check_in: "Chấm công trễ",
  missed_check_out: "Quên chấm công ra",
  adjust_check_out: "Sửa giờ ra ca",
};
```

- [ ] **Step 3: Add the check-out schema**

Append to `lib/validations/attendance-correction.ts`:

```ts
// Check-out giải trình. Unlike the check-in schema, the user supplies the
// corrected time, so it is validated here as well as in the RPC — the RPC
// stays the authoritative gate, since it is the only side that can see the
// actual check-in time to compare against.
export const checkoutCorrectionSchema = z.object({
  shift_id: z.uuid("Vui lòng chọn ca cần giải trình"),
  check_out_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Giờ ra không hợp lệ"),
  reason: z.string().trim()
    .min(1, "Vui lòng nhập lý do giải trình")
    .max(500, "Lý do tối đa 500 ký tự"),
});
export type CheckoutCorrectionInput = z.infer<typeof checkoutCorrectionSchema>;
```

- [ ] **Step 4: Verify — the exhaustive Records force the compile error**

```bash
npx tsc --noEmit
```

Expected at this point: errors in `components/attendance/AttendanceCorrectionCard.tsx`
about `ISSUE_ICON` missing the two new keys, and possibly in `lib/calendar.ts`
and `components/calendar/AttendanceDetailDialog.tsx` about
`requested_check_in_at` now being nullable. That is the safety net working —
Task 7 fixes them. The tree is intentionally red between here and Task 7, so do
not commit until then.

If any error names a file other than those three, stop and report it — an
unexpected consumer needs handling.

---

### Task 5: Server action and preview

**Files:**
- Modify: `actions/attendance-corrections.ts`

**Interfaces:**
- Consumes: `checkoutCorrectionSchema` (Task 4), the RPC and error strings (Task 3).
- Produces:
  - `requestCheckoutCorrectionAction(input: unknown): Promise<ActionResult>`.
  - `CorrectionPreview` gains
    `{ kind: "check_out_available"; shift: Pick<Shift,"id"|"start_at"|"end_at">; actualCheckInAt: string; actualCheckOutAt: string | null }`.
    Task 6 renders it.

- [ ] **Step 1: Extend the preview union**

Replace the `CorrectionPreview` type:

```ts
export type CorrectionPreview =
  | { kind: "no_shift" }
  | { kind: "no_discrepancy" }
  | { kind: "missed_check_in"; shift: Pick<Shift, "id" | "start_at" | "end_at"> }
  | { kind: "late_check_in"; shift: Pick<Shift, "id" | "start_at" | "end_at">; actualCheckInAt: string }
  | {
      kind: "check_out_available";
      shift: Pick<Shift, "id" | "start_at" | "end_at">;
      actualCheckInAt: string;
      // Null when they never clocked out — the correction then supplies the
      // missing time rather than adjusting an existing one.
      actualCheckOutAt: string | null;
    };
```

- [ ] **Step 2: Add the new error strings to the whitelist**

In `mapAttendanceCorrectionError`, add to the `known` array (order does not
matter; it is a substring match):

```ts
    "Vui lòng chọn giờ ra ca",
    "Ca này chưa có giờ vào — vui lòng giải trình giờ vào trước",
    "Giờ ra phải sau giờ vào",
    "Giờ ra không được ở tương lai",
    "Giờ ra phải cùng ngày với ca làm việc",
    "Ca này đã có đơn giải trình giờ ra đang chờ duyệt",
```

- [ ] **Step 3: Add the date helper**

Insert above `mapAttendanceCorrectionError`:

```ts
// "yyyy-MM-dd" for an ISO instant, in Vietnam time. Intl rather than date-fns
// because this server process has no explicit TZ set (see the comment in
// app/(app)/attendance/page.tsx) — the zone has to be pinned explicitly or a
// late-evening shift resolves to the wrong calendar day.
function formatInVietnamDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
```

- [ ] **Step 4: Add the request action**

Insert after `requestAttendanceCorrectionsAction`:

```ts
// Single-shift only, unlike the check-in batch action: each check-out
// correction carries its own chosen time, so there is no "same treatment for
// N shifts" shortcut to batch over.
export async function requestCheckoutCorrectionAction(input: unknown): Promise<ActionResult> {
  const profile = await requireProfile();
  const parsed = checkoutCorrectionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();

  // The RPC needs an absolute instant, but the user picked a wall-clock time.
  // Resolve it against the shift's own date in Vietnam time — the shift is
  // what the RPC validates against, and building the timestamp from the
  // browser's clock would drift for anyone not on Asia/Ho_Chi_Minh.
  const { data: shiftRows } = await supabase
    .from("shifts")
    .select("start_at")
    .eq("id", parsed.data.shift_id)
    .eq("assignee_id", profile.id)
    .limit(1);

  const shift = ((shiftRows as Pick<Shift, "start_at">[]) ?? [])[0];
  if (!shift) {
    return { ok: false, error: "Không tìm thấy ca làm việc này" };
  }

  const requestedCheckOutAt = `${formatInVietnamDate(shift.start_at)}T${parsed.data.check_out_time}:00+07:00`;

  const { error } = await supabase.rpc("request_attendance_correction_checkout", {
    p_shift_id: parsed.data.shift_id,
    p_requested_check_out_at: requestedCheckOutAt,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return { ok: false, error: mapAttendanceCorrectionError(error.message) };
  }

  revalidateAttendanceCorrectionPaths();
  // See requestAttendanceCorrectionsAction for why this is wrapped in after().
  after(() =>
    sendPushToLeaveApprovers(profile.role, {
      title: "Đơn giải trình công mới",
      body: `${profile.full_name} vừa gửi đơn giải trình giờ ra ca`,
      url: "/manager",
      tag: "attendance-correction",
    })
  );

  return { ok: true, data: undefined };
}
```

Add `checkoutCorrectionSchema` to the existing import from
`@/lib/validations/attendance-correction`.

- [ ] **Step 5: Extend the preview action**

In `getAttendanceCorrectionPreviewAction`, replace the block from
`const attendance = ...` to the end of the function:

```ts
  const attendance = ((attendanceRows as Attendance[]) ?? [])[0];
  if (!attendance) {
    return { ok: true, data: { kind: "missed_check_in", shift } };
  }
  if (attendance.check_in_at > shift.start_at) {
    return { ok: true, data: { kind: "late_check_in", shift, actualCheckInAt: attendance.check_in_at } };
  }
  // Clocked in on time. A check-out correction is still available — either to
  // supply a check-out they never made, or to adjust the one on record.
  return {
    ok: true,
    data: {
      kind: "check_out_available",
      shift,
      actualCheckInAt: attendance.check_in_at,
      actualCheckOutAt: attendance.check_out_at,
    },
  };
```

> `no_discrepancy` is now unreachable from this action but stays in the union —
> Task 6 still renders it, and removing a variant used across two files is
> churn for no gain.

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit 2>&1 | grep -v "AttendanceCorrectionCard\|lib/calendar\|AttendanceDetailDialog" || echo "no unexpected errors"
```

Expected: only the three known files from Task 4 still error.

---

### Task 6: Correction form

**Files:**
- Modify: `components/attendance/AttendanceCorrectionForm.tsx`

**Interfaces:**
- Consumes: `checkoutCorrectionSchema` (Task 4), `requestCheckoutCorrectionAction`
  and the `check_out_available` preview variant (Task 5), `TimePickerField` (Task 1).
- Produces: nothing consumed later.

- [ ] **Step 1: Extend the row model**

Replace `CorrectionRow` and `emptyRow`:

```ts
type CorrectionRow = {
  key: string;
  date: string;
  preview: CorrectionPreview | null;
  previewError: string;
  loadingPreview: boolean;
  checkOutTime: string;
  reason: string;
  reasonError: string;
};

function emptyRow(key: string): CorrectionRow {
  return {
    key,
    date: "",
    preview: null,
    previewError: "",
    loadingPreview: false,
    checkOutTime: "",
    reason: "",
    reasonError: "",
  };
}
```

Add beside `shiftIdForRow`:

```ts
function isCheckoutRow(row: CorrectionRow) {
  return row.preview?.kind === "check_out_available";
}

// The stored instants are UTC; every time the user sees or types is Vietnam
// wall-clock, so the zone is pinned rather than trusting the browser's.
function formatVn(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
```

- [ ] **Step 2: Seed the time field when a preview arrives**

In `handleDateChange`, replace the final `updateRow(...)` call:

```ts
    const preview = result.data;
    // Seed the field so the common case — nudging a recorded check-out by a
    // few minutes — starts from the real value instead of blank.
    updateRow(key, {
      preview,
      loadingPreview: false,
      checkOutTime:
        preview.kind === "check_out_available"
          ? formatVn(preview.actualCheckOutAt ?? preview.shift.end_at)
          : "",
    });
```

- [ ] **Step 3: Add the check-out submit handler**

Add after `handleSubmit`:

```ts
  async function handleSubmitCheckout(row: CorrectionRow) {
    if (row.preview?.kind !== "check_out_available") return;

    const parsed = checkoutCorrectionSchema.safeParse({
      shift_id: row.preview.shift.id,
      check_out_time: row.checkOutTime,
      reason: row.reason,
    });
    if (!parsed.success) {
      updateRow(row.key, { reasonError: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" });
      return;
    }

    setIsSubmitting(true);
    const result = await requestCheckoutCorrectionAction(parsed.data);
    setIsSubmitting(false);

    if (!result.ok) {
      updateRow(row.key, { reasonError: result.error });
      return;
    }

    toast.info("Đã gửi đơn giải trình giờ ra ca");
    setRows((prev) => {
      const rest = prev.filter((r) => r.key !== row.key);
      return rest.length === 0 ? [emptyRow(crypto.randomUUID())] : rest;
    });
  }
```

Add the imports:

```ts
import { attendanceCorrectionSchema, checkoutCorrectionSchema } from "@/lib/validations/attendance-correction";
import {
  getAttendanceCorrectionPreviewAction,
  requestAttendanceCorrectionsAction,
  requestCheckoutCorrectionAction,
  type CorrectionPreview,
} from "@/actions/attendance-corrections";
import { TimePickerField } from "@/components/ui/time-picker-field";
```

- [ ] **Step 4: Render the check-out preview and time field**

After the existing `late_check_in` preview block and before
`{row.previewError && ...}`:

```tsx
            {!row.loadingPreview && row.preview?.kind === "check_out_available" && (
              <p className="text-sm text-muted-foreground">
                Bạn vào ca lúc {formatVn(row.preview.actualCheckInAt)}.{" "}
                {row.preview.actualCheckOutAt
                  ? `Giờ ra đang ghi nhận là ${formatVn(row.preview.actualCheckOutAt)}.`
                  : "Ca này chưa có giờ ra."}
              </p>
            )}

            {isCheckoutRow(row) && (
              <div className="max-w-44">
                <TimePickerField
                  id={`checkout_time_${row.key}`}
                  label="Giờ ra ca đề nghị"
                  value={row.checkOutTime}
                  onChange={(value) => updateRow(row.key, { checkOutTime: value, reasonError: "" })}
                />
              </div>
            )}
```

- [ ] **Step 5: Extend the reason block and add the per-row submit**

Change the reason block's condition from `canSubmitRow(row) && (` to
`(canSubmitRow(row) || isCheckoutRow(row)) && (`, and add inside that block,
after the `reasonError` paragraph:

```tsx
                {isCheckoutRow(row) && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={isSubmitting || !row.checkOutTime || !row.reason.trim()}
                    onClick={() => handleSubmitCheckout(row)}
                  >
                    {isSubmitting ? "Đang gửi..." : "Gửi giải trình giờ ra"}
                  </Button>
                )}
```

The existing footer "Gửi giải trình" button stays as-is — it is driven by
`hasSubmittable`, which only counts check-in rows, so the two submit paths do
not collide.

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit 2>&1 | grep -v "AttendanceCorrectionCard\|lib/calendar\|AttendanceDetailDialog" || echo "no unexpected errors"
```

---

### Task 7: Card, calendar plumbing, and green build

**Files:**
- Modify: `components/attendance/AttendanceCorrectionCard.tsx:31-34,126-133`
- Modify: `lib/calendar.ts`
- Modify: `components/calendar/AttendanceDetailDialog.tsx` (only where Task 4's
  compile errors point)

**Interfaces:**
- Consumes: everything above.
- Produces: a green `tsc` and `lint`.

- [ ] **Step 1: Extend the icon map**

```ts
const ISSUE_ICON = {
  missed_check_in: AlarmClockOffIcon,
  late_check_in: ClockAlertIcon,
  missed_check_out: AlarmClockOffIcon,
  adjust_check_out: ClockAlertIcon,
};
```

- [ ] **Step 2: Make the card's detail line kind-aware**

Replace the `<p className="text-xs text-muted-foreground">` block:

```tsx
          <p className="text-xs text-muted-foreground">
            {ATTENDANCE_CORRECTION_ISSUE_LABELS[request.issue_type]}
            {request.kind === "check_out" ? (
              <>
                {request.actual_check_out_at && (
                  <> · Chấm công ra lúc {format(new Date(request.actual_check_out_at), "HH:mm")}</>
                )}
                {request.requested_check_out_at && (
                  <> · Sửa về {format(new Date(request.requested_check_out_at), "HH:mm")}</>
                )}
              </>
            ) : (
              <>
                {request.issue_type === "late_check_in" && request.actual_check_in_at && (
                  <> · Chấm công lúc {format(new Date(request.actual_check_in_at), "HH:mm")}</>
                )}
                {request.requested_check_in_at && (
                  <> · Sửa về {format(new Date(request.requested_check_in_at), "HH:mm")}</>
                )}
              </>
            )}
          </p>
```

- [ ] **Step 3: Fix the remaining compile errors**

```bash
npx tsc --noEmit
```

Work through what it reports in `lib/calendar.ts` and
`components/calendar/AttendanceDetailDialog.tsx`. Expected causes:

1. `requested_check_in_at` is now `string | null`, so any unguarded read needs
   a null check.
2. `pendingCorrectionsByShiftId` assumes at most one pending correction per
   shift. Keep the `Map` keyed by `shift_id` — the calendar badge only
   communicates "this shift has something pending", which stays true with two —
   but make the writer tolerate a second entry instead of assuming uniqueness,
   and update the stale comment that asserts the one-per-shift rule.

Do not change *which* corrections are visible to whom — that is authorization,
not display, and is out of scope here.

- [ ] **Step 4: Full verification**

```bash
npx tsc --noEmit && npm run lint
```

Expected: clean, apart from the three pre-existing `react-hook-form` warnings.

- [ ] **Step 5: Commit**

```bash
git add types/index.ts lib/constants.ts lib/validations/attendance-correction.ts \
        actions/attendance-corrections.ts components/attendance/ lib/calendar.ts \
        components/calendar/AttendanceDetailDialog.tsx
git commit -m "feat: giải trình công for check-out with a user-chosen time"
```

---

### Task 8: End-to-end verification and deploy

**Files:** none modified unless a defect surfaces.

- [ ] **Step 1: Exercise the request flow locally**

```bash
npm run dev
```

As a staff account with a shift in the last 7 days, on `/attendance/explain`:

1. Pick a date where you clocked in and out. Confirm the preview reports both
   times and "Giờ ra ca đề nghị" is pre-filled with the recorded check-out.
2. Type `19:20`, enter a reason, submit. Expect the success toast, and the card
   below to read "Sửa giờ ra ca · Chấm công ra lúc … · Sửa về 19:20".
3. A time **before** the check-in → "Giờ ra phải sau giờ vào".
4. A time in the future → "Giờ ra không được ở tương lai".
5. A shift with no check-in → "Ca này chưa có giờ vào — vui lòng giải trình giờ vào trước".
6. Confirm a check-in correction and a check-out correction can both be pending
   on the **same shift**. This is the constraint change; it would have failed before.

- [ ] **Step 2: Exercise approval**

As a manager (`ceo`/`coo`/`training_director`/`hr`): `/manager` → find the
request → Duyệt. Then confirm the attendance row actually moved, via
`_tmp-verify.mjs` in the repo root:

```js
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const { data } = await admin
  .from("attendance_corrections")
  .select("id, kind, issue_type, status, requested_check_out_at, attendance_id")
  .eq("kind", "check_out")
  .order("created_at", { ascending: false })
  .limit(1);
const row = data?.[0];
if (!row) { console.log("no check_out correction found"); process.exit(0); }
const { data: att } = await admin
  .from("attendance")
  .select("id, check_in_at, check_out_at")
  .eq("id", row.attendance_id)
  .single();
console.log(JSON.stringify({
  correction: row,
  attendance: att,
  matches: row.status === "approved"
    ? new Date(att.check_out_at).getTime() === new Date(row.requested_check_out_at).getTime()
    : "not approved yet",
}, null, 2));
```

```bash
node _tmp-verify.mjs; rm -f _tmp-verify.mjs
```

Expected once approved: `"matches": true`.

- [ ] **Step 3: Exercise revert as Kỹ thuật**

`/manager` as `technical` → "Khôi phục" on the approved check-out correction.
Re-run the Step 2 script and confirm `check_out_at` returned to its previous
value. For a `missed_check_out` revert it returns to `null`; if that person has
another open session, `attendance_one_open_per_profile` rejects it — confirm the
message shown is Vietnamese, and if a raw Postgres error leaks through, add
`"attendance_one_open_per_profile"` handling to `mapAttendanceCorrectionError`
with the message "Nhân viên đang có ca chưa chấm công ra — không thể khôi phục
tự động", then re-verify.

- [ ] **Step 4: Regression-check the check-in flow**

File a normal check-in giải trình exactly as before (a date where you clocked in
late). Confirm it still submits, still reads "Chấm công trễ · … · Sửa về …", and
still approves correctly. **This is the main regression risk of the whole task.**

- [ ] **Step 5: Verify the other time fields**

Open "Tạo ca làm việc" on `/calendar`, the xin-nghỉ dialog on `/leave`, and the
calendar's attendance edit dialog. Confirm each time field accepts typing and
its dropdown still opens.

- [ ] **Step 6: Refresh the knowledge graph and deploy**

```bash
graphify update .
git add -A && git commit -m "chore: refresh knowledge graph after check-out correction"
git push origin main
vercel --prod --yes
```

- [ ] **Step 7: Smoke-test production**

Open the deployed URL, file one check-out giải trình, approve it, confirm the
attendance record updated.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Additive schema; check-in path untouched | 3 Step 1; regression-checked 8 Step 4 |
| `kind` discriminator, generated | 3 Step 1 |
| Enum extension in its own migration | 2 |
| `requested_check_in_at` NOT NULL → kind-aware CHECK | 3 Step 1 |
| CHECK written against `issue_type`, not `kind` | 3 Step 1 |
| Unique index becomes `(shift_id, kind)` | 3 Step 1; verified 8 Step 1.6 |
| New check-out RPC with the agreed guards | 3 Step 2 |
| `respond_to_…` writes `check_out_at` | 3 Step 3 |
| `revert_…` kind-aware guard + restore branch | 3 Step 4 |
| Requires an existing check-in | 3 Step 2; verified 8 Step 1.5 |
| Types, exhaustive labels, icons | 4, 7 |
| Error whitelist extended | 5 Step 2 |
| Preview extended on both sides | 5 Steps 1, 5 |
| Form: choose what to correct + time input | 6 |
| `pendingCorrectionsByShiftId` tolerates two per shift | 7 Step 3 |
| Typed time, minute precision, dropdown kept | 1 |
| Applies to shift registration + calendar edit | 1 (shared component); verified 8 Step 5 |
| Verified by tsc / eslint / manual | every task |

Spec Parts 3 and 4 (dashboard tables, performance) are deliberately **not** in
this plan — they become Plan B, written after this ships so it reflects the real
file state. The region change from Part 4 is already done and deployed.

**Placeholder scan:** none. Every step carries actual code or an actual command.

**Type consistency:** `AttendanceCorrectionKind` (Task 4) is used in Tasks 5–7.
`checkoutCorrectionSchema`'s three fields (`shift_id`, `check_out_time`,
`reason`) match the action's `parsed.data` reads in Task 5 Step 4 and the form's
`safeParse` call in Task 6 Step 3. `check_out_available`'s payload fields
(`shift`, `actualCheckInAt`, `actualCheckOutAt`) match every render site in
Task 6 Steps 2 and 4. The RPC parameter names (`p_shift_id`,
`p_requested_check_out_at`, `p_reason`) match Task 5's `rpc()` call exactly.
`formatVn` (Task 6) and `formatInVietnamDate` (Task 5) are deliberately separate
— different files, different output shapes (`HH:mm` vs `yyyy-MM-dd`).
