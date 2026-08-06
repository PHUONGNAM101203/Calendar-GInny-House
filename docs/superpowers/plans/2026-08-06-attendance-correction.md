# Giải trình công (Attendance Correction) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Employees can submit a "Giải trình công" request when they forgot to check in or checked in late, the request routes to the same approver(s) as leave requests, and approval auto-corrects the `attendance` row.

**Architecture:** New `attendance_corrections` table + 3 `security definer` RPCs (mirrors `leave_requests`' shape exactly), a new Server Action file, a new `/attendance/explain` route with a date-driven preview form, a new scoped Section on `/manager`, and one more input array wired into the existing `buildNotifications()`.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), Supabase Postgres (RLS + `security definer` RPCs), react-hook-form + zod, shadcn/ui.

## Global Constraints

- All UI copy in Vietnamese; code identifiers/comments in English (CLAUDE.md).
- Every Server Action: `requireProfile()` first, `unknown` input validated with `schema.safeParse`, returns `Promise<ActionResult>`/`Promise<ActionResult<T>>`, raw Supabase errors mapped through a private `mapXError()` before returning.
- Business logic lives in Postgres RPCs; actions stay thin (validate → rpc → map error → revalidate → return) — CLAUDE.md Server Actions Pattern.
- No test suite exists — verify via `tsc --noEmit`, `npm run lint`, and manual dev-server check (CLAUDE.md Verification).
- Migration numbering: current remote head is `0025` (confirmed via `supabase db query --linked "select version from supabase_migrations.schema_migrations order by version desc limit 1"`) — this plan's migration is `0026`. **Re-check the remote head immediately before creating the file** — another in-progress branch may have claimed `0026` since this plan was written (see the collision handled in commit `aeee686`); if so, use the next free number and update every reference below.
- `attendance.branch_id` is nullable (migration `0006`); `shifts.branch_id` is `not null`.
- Approver reuse: `is_leave_approver()`, `can_view_profile()`, `canApproveLeaveFor()` are NOT modified by this plan — only called.

---

## File Structure

- **Create** `supabase/migrations/0026_attendance_corrections.sql` — table, 2 enums, RLS policy, 3 RPCs.
- **Modify** `types/index.ts` — add `AttendanceCorrectionStatus`, `AttendanceCorrectionIssue`, `AttendanceCorrection`, `AttendanceCorrectionDetailed`.
- **Create** `lib/validations/attendance-correction.ts` — Zod schema for the submit form.
- **Modify** `lib/constants.ts` — add `ATTENDANCE_CORRECTION_STATUS_LABELS`, `ATTENDANCE_CORRECTION_ISSUE_LABELS`.
- **Create** `actions/attendance-corrections.ts` — 4 actions: request / respond / cancel / preview.
- **Create** `components/attendance/AttendanceCorrectionCard.tsx` — presentational history card (mirrors `LeaveRequestCard.tsx`).
- **Create** `components/attendance/AttendanceCorrectionForm.tsx` — date-driven submit form (mirrors `LeaveRequestDialog.tsx`'s form internals, but inline rather than a dialog since it needs a persistent preview area).
- **Create** `app/(app)/attendance/explain/page.tsx` — new route.
- **Modify** `app/(app)/attendance/page.tsx` — add a discoverability link to the new route.
- **Modify** `app/(app)/manager/page.tsx` — add the "Giải trình công" Section, fetched/scoped alongside the existing lists.
- **Modify** `lib/notifications.ts` — add `attendanceCorrections` input + classification loop.
- **Modify** `app/(app)/layout.tsx` — fetch `attendance_corrections` alongside the existing three arrays.

---

### Task 1: SQL migration — table, RLS, RPCs

**Files:**
- Create: `supabase/migrations/0026_attendance_corrections.sql`

**Interfaces:**
- Consumes: `public.can_view_profile(uuid)`, `public.is_leave_approver()` (both defined in `0019_hr_group_student_affairs_teaching_assistant.sql`, unmodified).
- Produces: table `public.attendance_corrections` (columns per spec §3), enums `public.attendance_correction_status`, `public.attendance_correction_issue`, RPCs `public.request_attendance_correction(p_shift_id uuid, p_reason text) returns public.attendance_corrections`, `public.respond_to_attendance_correction(p_id uuid, p_approve boolean) returns public.attendance_corrections`, `public.cancel_attendance_correction(p_id uuid) returns void`. Task 3 (actions) calls these three RPCs by exact name and parameter names.

- [ ] **Step 1: Confirm the next free migration number**

Run: `supabase db query --linked "select version from supabase_migrations.schema_migrations order by version desc limit 1;"`
Expected: `0025`. If it's higher, use `<that + 1>` as the filename prefix everywhere in this task instead of `0026`.

- [ ] **Step 2: Write the migration file**

```sql
-- 0026_attendance_corrections.sql
-- "Giải trình công": lets an employee request a correction to a missed or
-- late check-in. Mirrors leave_requests' shape (0004/0013) — same
-- pending/responder_id/resolved_at lifecycle, same is_leave_approver()/
-- can_view_profile() approval gate, same atomic `where status = 'pending'`
-- race guard. Only ever touches attendance.check_in_at — check-out
-- correction is explicitly out of scope (see design spec §2).

create type public.attendance_correction_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.attendance_correction_issue as enum ('missed_check_in', 'late_check_in');

create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  attendance_id uuid references public.attendance(id) on delete set null,
  issue_type public.attendance_correction_issue not null,
  actual_check_in_at timestamptz,
  requested_check_in_at timestamptz not null,
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

create policy attendance_corrections_select on public.attendance_corrections
  for select to authenticated
  using (profile_id = auth.uid() or public.can_view_profile(profile_id));

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

grant execute on function public.request_attendance_correction(uuid, text) to authenticated;

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

grant execute on function public.respond_to_attendance_correction(uuid, boolean) to authenticated;

create or replace function public.cancel_attendance_correction(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  update public.attendance_corrections
  set status = 'cancelled'
  where id = p_id
    and status = 'pending'
    and (profile_id = v_uid or public.is_leave_approver());

  if not found then
    raise exception 'Không thể huỷ đơn này';
  end if;
end;
$$;

grant execute on function public.cancel_attendance_correction(uuid) to authenticated;
```

- [ ] **Step 3: Apply the migration**

Run: `supabase db push --yes`
Expected: `"migrations":["0026_attendance_corrections.sql"]` (or the corrected number from Step 1) in the JSON output, `"upToDate":false` beforehand.

- [ ] **Step 4: Verify the table and RPCs exist on remote**

Run: `supabase db query --linked "select proname from pg_proc where proname like '%attendance_correction%' order by proname;"`
Expected: `cancel_attendance_correction`, `request_attendance_correction`, `respond_to_attendance_correction` all present.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0026_attendance_corrections.sql
git commit -m "feat: add attendance_corrections table and RPCs for Giải trình công"
```

---

### Task 2: Types, validation schema, constants

**Files:**
- Modify: `types/index.ts` (append near the existing `Attendance`/`AttendanceWithProfile` types)
- Create: `lib/validations/attendance-correction.ts`
- Modify: `lib/constants.ts` (append near `LEAVE_STATUS_LABELS`)

**Interfaces:**
- Consumes: `Profile`, `Shift` (both already in `types/index.ts`).
- Produces: `AttendanceCorrectionStatus`, `AttendanceCorrectionIssue`, `AttendanceCorrection`, `AttendanceCorrectionDetailed` types; `attendanceCorrectionSchema`/`AttendanceCorrectionInput` from the validation file; `ATTENDANCE_CORRECTION_STATUS_LABELS: Record<AttendanceCorrectionStatus, string>`, `ATTENDANCE_CORRECTION_ISSUE_LABELS: Record<AttendanceCorrectionIssue, string>`. Tasks 3–6 import all of these by exact name.

- [ ] **Step 1: Add types**

Append to `types/index.ts` right after the existing `AttendanceWithProfile` type:

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

- [ ] **Step 2: Add the validation schema**

Create `lib/validations/attendance-correction.ts`:

```ts
import { z } from "zod";

export const attendanceCorrectionSchema = z.object({
  shift_id: z.uuid("Vui lòng chọn ca cần giải trình"),
  reason: z
    .string()
    .trim()
    .min(1, "Vui lòng nhập lý do giải trình")
    .max(500, "Lý do tối đa 500 ký tự"),
});
export type AttendanceCorrectionInput = z.infer<typeof attendanceCorrectionSchema>;

export const correctionPreviewSchema = z.object({
  date: z.string().min(1, "Vui lòng chọn ngày"),
});
export type CorrectionPreviewInput = z.infer<typeof correctionPreviewSchema>;
```

- [ ] **Step 3: Add label constants**

Append to `lib/constants.ts` right after `LEAVE_REQUEST_TYPE_LABELS`:

```ts
export const ATTENDANCE_CORRECTION_STATUS_LABELS: Record<
  "pending" | "approved" | "rejected" | "cancelled",
  string
> = {
  pending: "Đang chờ",
  approved: "Đã duyệt",
  rejected: "Đã từ chối",
  cancelled: "Đã huỷ",
};

export const ATTENDANCE_CORRECTION_ISSUE_LABELS: Record<"missed_check_in" | "late_check_in", string> = {
  missed_check_in: "Quên chấm công",
  late_check_in: "Chấm công trễ",
};
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add types/index.ts lib/validations/attendance-correction.ts lib/constants.ts
git commit -m "feat: add types, validation schema, and labels for attendance corrections"
```

---

### Task 3: Server Actions

**Files:**
- Create: `actions/attendance-corrections.ts`

**Interfaces:**
- Consumes: `requireProfile()` (`lib/auth.ts`), `createClient()` (`lib/supabase/server.ts`), `attendanceCorrectionSchema`/`correctionPreviewSchema` (Task 2), `ActionResult<T>` (`types/index.ts`), RPCs from Task 1 (`request_attendance_correction`, `respond_to_attendance_correction`, `cancel_attendance_correction`).
- Produces:
  - `requestAttendanceCorrectionAction(input: unknown): Promise<ActionResult>`
  - `respondToAttendanceCorrectionAction(id: string, approve: boolean): Promise<ActionResult>`
  - `cancelAttendanceCorrectionAction(id: string): Promise<ActionResult>`
  - `getAttendanceCorrectionPreviewAction(input: unknown): Promise<ActionResult<CorrectionPreview>>` where
    `type CorrectionPreview = { kind: "no_shift" } | { kind: "no_discrepancy" } | { kind: "missed_check_in"; shift: Pick<Shift, "id" | "start_at" | "end_at"> } | { kind: "late_check_in"; shift: Pick<Shift, "id" | "start_at" | "end_at">; actualCheckInAt: string }`
  Tasks 5–6 (form, card) import all four by exact name; the form imports the `CorrectionPreview` type too.

- [ ] **Step 1: Write the file**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { attendanceCorrectionSchema, correctionPreviewSchema } from "@/lib/validations/attendance-correction";
import type { ActionResult, Attendance, Shift } from "@/types";

export type CorrectionPreview =
  | { kind: "no_shift" }
  | { kind: "no_discrepancy" }
  | { kind: "missed_check_in"; shift: Pick<Shift, "id" | "start_at" | "end_at"> }
  | { kind: "late_check_in"; shift: Pick<Shift, "id" | "start_at" | "end_at">; actualCheckInAt: string };

function mapAttendanceCorrectionError(message: string): string {
  const known = [
    "Không tìm thấy ca làm việc này",
    "Đã quá hạn 2 ngày để giải trình ca này",
    "Ca này không có sai lệch cần giải trình",
    "Ca này đã có đơn giải trình đang chờ duyệt",
    "Vui lòng nhập lý do giải trình",
    "Chỉ quản lý mới được duyệt đơn giải trình công",
    "Bạn không có quyền duyệt đơn của nhân viên này",
    "Đơn giải trình công không hợp lệ hoặc đã được xử lý",
    "Không thể huỷ đơn này",
  ];
  return known.find((m) => message.includes(m)) ?? "Không thể xử lý đơn giải trình công";
}

function revalidateAttendanceCorrectionPaths() {
  revalidatePath("/attendance/explain");
  revalidatePath("/manager");
}

export async function requestAttendanceCorrectionAction(input: unknown): Promise<ActionResult> {
  await requireProfile();
  const parsed = attendanceCorrectionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_attendance_correction", {
    p_shift_id: parsed.data.shift_id,
    p_reason: parsed.data.reason,
  });

  if (error) return { ok: false, error: mapAttendanceCorrectionError(error.message) };

  revalidateAttendanceCorrectionPaths();
  return { ok: true, data: undefined };
}

export async function respondToAttendanceCorrectionAction(
  id: string,
  approve: boolean
): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_to_attendance_correction", {
    p_id: id,
    p_approve: approve,
  });

  if (error) return { ok: false, error: mapAttendanceCorrectionError(error.message) };

  revalidateAttendanceCorrectionPaths();
  return { ok: true, data: undefined };
}

export async function cancelAttendanceCorrectionAction(id: string): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_attendance_correction", { p_id: id });

  if (error) return { ok: false, error: mapAttendanceCorrectionError(error.message) };

  revalidateAttendanceCorrectionPaths();
  return { ok: true, data: undefined };
}

// Deliberate exception to "actions only mutate" — see design spec §5. The
// submit form needs a live preview as the user picks an arbitrary date;
// there's no other established idiom in this codebase for a client-driven
// ad hoc read (no API routes, no client-side Supabase query pattern for
// this).
export async function getAttendanceCorrectionPreviewAction(
  input: unknown
): Promise<ActionResult<CorrectionPreview>> {
  const profile = await requireProfile();
  const parsed = correctionPreviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const dayStart = `${parsed.data.date}T00:00:00+07:00`;
  const dayEnd = `${parsed.data.date}T23:59:59+07:00`;

  const { data: shifts } = await supabase
    .from("shifts")
    .select("id, start_at, end_at")
    .eq("assignee_id", profile.id)
    .gte("start_at", dayStart)
    .lte("start_at", dayEnd)
    .limit(1);

  const shift = ((shifts as Pick<Shift, "id" | "start_at" | "end_at">[]) ?? [])[0];
  if (!shift) {
    return { ok: true, data: { kind: "no_shift" } };
  }

  const { data: attendanceRows } = await supabase
    .from("attendance")
    .select("*")
    .eq("profile_id", profile.id)
    .gte("check_in_at", dayStart)
    .lte("check_in_at", dayEnd)
    .order("check_in_at", { ascending: false })
    .limit(1);

  const attendance = ((attendanceRows as Attendance[]) ?? [])[0];
  if (!attendance) {
    return { ok: true, data: { kind: "missed_check_in", shift } };
  }
  if (attendance.check_in_at > shift.start_at) {
    return { ok: true, data: { kind: "late_check_in", shift, actualCheckInAt: attendance.check_in_at } };
  }
  return { ok: true, data: { kind: "no_discrepancy" } };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npx eslint actions/attendance-corrections.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add actions/attendance-corrections.ts
git commit -m "feat: add server actions for attendance correction requests"
```

---

### Task 4: `AttendanceCorrectionCard` (history display)

**Files:**
- Create: `components/attendance/AttendanceCorrectionCard.tsx`

**Interfaces:**
- Consumes: `AttendanceCorrectionDetailed` (Task 2), `ATTENDANCE_CORRECTION_STATUS_LABELS`/`ATTENDANCE_CORRECTION_ISSUE_LABELS` (Task 2), `respondToAttendanceCorrectionAction`/`cancelAttendanceCorrectionAction` (Task 3).
- Produces: `export default function AttendanceCorrectionCard({ request, canRespond, canCancel, showName }: { request: AttendanceCorrectionDetailed; canRespond: boolean; canCancel: boolean; showName: boolean })`. Tasks 5 and 6 render this component.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { AlarmClockOffIcon, ClockAlertIcon } from "lucide-react";
import {
  cancelAttendanceCorrectionAction,
  respondToAttendanceCorrectionAction,
} from "@/actions/attendance-corrections";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ATTENDANCE_CORRECTION_STATUS_LABELS, ATTENDANCE_CORRECTION_ISSUE_LABELS } from "@/lib/constants";
import type { AttendanceCorrectionDetailed } from "@/types";

const ISSUE_ICON = {
  missed_check_in: AlarmClockOffIcon,
  late_check_in: ClockAlertIcon,
};

export default function AttendanceCorrectionCard({
  request,
  canRespond,
  canCancel,
  showName,
}: {
  request: AttendanceCorrectionDetailed;
  canRespond: boolean;
  canCancel: boolean;
  showName: boolean;
}) {
  const [pending, setPending] = useState(false);

  async function handleRespond(approve: boolean) {
    setPending(true);
    const result = await respondToAttendanceCorrectionAction(request.id, approve);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(approve ? "Đã duyệt đơn giải trình công" : "Đã từ chối đơn giải trình công");
  }

  async function handleCancel() {
    setPending(true);
    const result = await cancelAttendanceCorrectionAction(request.id);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Đã huỷ đơn giải trình công");
  }

  const statusVariant =
    request.status === "approved" ? "success" : request.status === "pending" ? "gold" : "outline";
  const Icon = ISSUE_ICON[request.issue_type];
  const shiftDate = format(new Date(request.shift.start_at), "EEEE dd/MM/yyyy", { locale: vi });
  const shiftRange = `${format(new Date(request.shift.start_at), "HH:mm")}–${format(
    new Date(request.shift.end_at),
    "HH:mm"
  )}`;

  return (
    <Card
      className="border-l-4 border-l-transparent data-[status=pending]:border-l-gold"
      data-status={request.status}
    >
      <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            {showName && `${request.profile.full_name} · `}
            {shiftDate} · Ca {shiftRange}
          </p>
          <p className="text-xs text-muted-foreground">
            {ATTENDANCE_CORRECTION_ISSUE_LABELS[request.issue_type]}
            {request.issue_type === "late_check_in" && request.actual_check_in_at && (
              <> · Chấm công lúc {format(new Date(request.actual_check_in_at), "HH:mm")}</>
            )}
            {" · Sửa về "}
            {format(new Date(request.requested_check_in_at), "HH:mm")}
          </p>
          <p className="text-sm text-muted-foreground italic">“{request.reason}”</p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={statusVariant}>{ATTENDANCE_CORRECTION_STATUS_LABELS[request.status]}</Badge>
          {canRespond && request.status === "pending" && (
            <>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => handleRespond(false)}>
                Từ chối
              </Button>
              <Button size="sm" disabled={pending} onClick={() => handleRespond(true)}>
                Duyệt
              </Button>
            </>
          )}
          {canCancel && request.status === "pending" && (
            <Button size="sm" variant="outline" disabled={pending} onClick={handleCancel}>
              Huỷ
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint components/attendance/AttendanceCorrectionCard.tsx`
Expected: no errors. (If `AlarmClockOffIcon`/`ClockAlertIcon` don't exist in the installed `lucide-react` version, substitute any two distinct icons already used elsewhere in `components/attendance/` or `components/leave/` — e.g. `ClockIcon` and `AlertTriangleIcon` — the exact icon choice is not load-bearing.)

- [ ] **Step 3: Commit**

```bash
git add components/attendance/AttendanceCorrectionCard.tsx
git commit -m "feat: add AttendanceCorrectionCard component"
```

---

### Task 5: `AttendanceCorrectionForm` + `/attendance/explain` route

**Files:**
- Create: `components/attendance/AttendanceCorrectionForm.tsx`
- Create: `app/(app)/attendance/explain/page.tsx`
- Modify: `app/(app)/attendance/page.tsx` (add a discoverability link)

**Interfaces:**
- Consumes: `attendanceCorrectionSchema`/`AttendanceCorrectionInput` (Task 2), `getAttendanceCorrectionPreviewAction`/`requestAttendanceCorrectionAction`/`CorrectionPreview` (Task 3), `AttendanceCorrectionCard` (Task 4), `DatePickerField` (`components/ui/date-picker-field.tsx`, existing), `PageHeader`/`SectionHeading`/`EmptyState` (`components/layout/PageChrome.tsx`, existing), `requireProfile()` (existing), `AttendanceCorrectionDetailed` (Task 2).
- Produces: `export default function AttendanceCorrectionForm()` (no props — self-contained, matches `LeaveRequestDialog`'s no-props pattern). Nothing downstream depends on this beyond the page rendering it.

- [ ] **Step 1: Write the form component**

```tsx
"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { format } from "date-fns";
import { attendanceCorrectionSchema, type AttendanceCorrectionInput } from "@/lib/validations/attendance-correction";
import {
  getAttendanceCorrectionPreviewAction,
  requestAttendanceCorrectionAction,
  type CorrectionPreview,
} from "@/actions/attendance-corrections";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

export default function AttendanceCorrectionForm() {
  const [date, setDate] = useState("");
  const [preview, setPreview] = useState<CorrectionPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<AttendanceCorrectionInput>({ resolver: zodResolver(attendanceCorrectionSchema) });

  async function handleDateChange(value: string) {
    setDate(value);
    setPreview(null);
    setPreviewError("");
    setValue("shift_id", "");
    if (!value) return;

    setLoadingPreview(true);
    const result = await getAttendanceCorrectionPreviewAction({ date: value });
    setLoadingPreview(false);
    if (!result.ok) {
      setPreviewError(result.error);
      return;
    }
    setPreview(result.data);
    if (result.data.kind === "missed_check_in" || result.data.kind === "late_check_in") {
      setValue("shift_id", result.data.shift.id, { shouldValidate: true });
    }
  }

  async function onSubmit(values: AttendanceCorrectionInput) {
    const result = await requestAttendanceCorrectionAction(values);
    if (!result.ok) {
      setPreviewError(result.error);
      return;
    }
    toast.success("Đã gửi đơn giải trình công");
    setDate("");
    setPreview(null);
    reset({ shift_id: "", reason: "" });
  }

  const canSubmit = preview?.kind === "missed_check_in" || preview?.kind === "late_check_in";

  return (
    <Card>
      <CardContent className="space-y-4">
        <DatePickerField id="correction_date" label="Ngày cần giải trình" value={date} onChange={handleDateChange} />

        {loadingPreview && <p className="text-sm text-muted-foreground">Đang kiểm tra...</p>}

        {!loadingPreview && preview?.kind === "no_shift" && (
          <p className="text-sm text-muted-foreground">Bạn không có ca làm việc vào ngày này.</p>
        )}
        {!loadingPreview && preview?.kind === "no_discrepancy" && (
          <p className="text-sm text-muted-foreground">Bạn đã chấm công đúng giờ ngày này, không cần giải trình.</p>
        )}
        {!loadingPreview && preview?.kind === "missed_check_in" && (
          <p className="text-sm text-destructive">
            Bạn chưa chấm công ngày này. Ca {format(new Date(preview.shift.start_at), "HH:mm")}–
            {format(new Date(preview.shift.end_at), "HH:mm")} — hệ thống sẽ sửa giờ vào ca thành{" "}
            {format(new Date(preview.shift.start_at), "HH:mm")}.
          </p>
        )}
        {!loadingPreview && preview?.kind === "late_check_in" && (
          <p className="text-sm text-destructive">
            Bạn chấm công lúc {format(new Date(preview.actualCheckInAt), "HH:mm")}, trễ so với giờ ca{" "}
            {format(new Date(preview.shift.start_at), "HH:mm")}–{format(new Date(preview.shift.end_at), "HH:mm")} —
            hệ thống sẽ sửa lại thành {format(new Date(preview.shift.start_at), "HH:mm")}.
          </p>
        )}
        {previewError && <p className="text-sm text-destructive">{previewError}</p>}

        {canSubmit && (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
            <input type="hidden" {...register("shift_id")} />
            <div className="space-y-1.5">
              <Label htmlFor="reason">Lý do giải trình</Label>
              <Textarea id="reason" rows={3} {...register("reason")} />
              {errors.reason && <p className="text-sm text-destructive">{errors.reason.message}</p>}
            </div>
            <Button type="submit" disabled={isSubmitting}>
              Gửi giải trình
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Write the route**

```tsx
// app/(app)/attendance/explain/page.tsx
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, SectionHeading, EmptyState } from "@/components/layout/PageChrome";
import AttendanceCorrectionForm from "@/components/attendance/AttendanceCorrectionForm";
import AttendanceCorrectionCard from "@/components/attendance/AttendanceCorrectionCard";
import type { AttendanceCorrectionDetailed } from "@/types";

export default async function AttendanceExplainPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data } = await supabase
    .from("attendance_corrections")
    .select("*, profile:profiles!profile_id(id, full_name, role), shift:shifts!shift_id(id, start_at, end_at)")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false });

  const requests = (data as AttendanceCorrectionDetailed[]) ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 overflow-y-auto p-4 sm:p-6">
      <PageHeader
        eyebrow="Chấm công"
        title="Giải trình công"
        description="Quên chấm công hoặc chấm công trễ? Chọn ngày và gửi giải trình để quản lý duyệt."
      />

      <AttendanceCorrectionForm />

      <section className="space-y-3">
        <SectionHeading title="Đơn của tôi" />
        {requests.length === 0 ? (
          <EmptyState>Bạn chưa gửi đơn giải trình công nào.</EmptyState>
        ) : (
          <div className="space-y-3">
            {requests.map((r) => (
              <AttendanceCorrectionCard key={r.id} request={r} canRespond={false} canCancel={r.status === "pending"} showName={false} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Link from `/attendance`**

In `app/(app)/attendance/page.tsx`, add the import `import Link from "next/link";` at the top, then add a link line right after the `<ClockWidget open={open} />` element and before the `<section>` for history:

```tsx
      <ClockWidget open={open} />

      <p className="text-sm text-muted-foreground">
        Quên chấm công hoặc chấm công trễ?{" "}
        <Link href="/attendance/explain" className="font-medium text-foreground underline underline-offset-4">
          Gửi giải trình
        </Link>
      </p>

      <section className="space-y-3">
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint "app/(app)/attendance/**" components/attendance/AttendanceCorrectionForm.tsx`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, sign in as a front-line employee with a shift assigned yesterday and no check-in that day, navigate to `/attendance`, click "Gửi giải trình", confirm the link lands on `/attendance/explain`, pick that date, confirm the "Bạn chưa chấm công ngày này" preview appears with the correct shift time, fill a reason, submit, confirm the toast and the new row appears under "Đơn của tôi" with status "Đang chờ".

- [ ] **Step 6: Commit**

```bash
git add components/attendance/AttendanceCorrectionForm.tsx "app/(app)/attendance/explain/page.tsx" "app/(app)/attendance/page.tsx"
git commit -m "feat: add attendance correction submit form and /attendance/explain route"
```

---

### Task 6: Manager page Section

**Files:**
- Modify: `app/(app)/manager/page.tsx`

**Interfaces:**
- Consumes: `AttendanceCorrectionCard` (Task 4), `AttendanceCorrectionDetailed` (Task 2), `isLeaveApprover`/`canApproveLeaveFor` (existing, already imported in this file), the `groupRoles`/`Section` machinery already in this file from the manager-dashboard-group-scope work (commit `6080ca4`).
- Produces: nothing consumed elsewhere — this is the last task touching this file for this feature.

- [ ] **Step 1: Add the fetch**

In the `Promise.all` array in `app/(app)/manager/page.tsx`, add one more entry. Find:

```ts
    supabase
      .from("shift_requests")
      .select("*, profile:profiles!profile_id(id, full_name, role)")
      .order("created_at", { ascending: false }),
  ]);
```

Replace with:

```ts
    supabase
      .from("shift_requests")
      .select("*, profile:profiles!profile_id(id, full_name, role)")
      .order("created_at", { ascending: false }),
    supabase
      .from("attendance_corrections")
      .select("*, profile:profiles!profile_id(id, full_name, role), shift:shifts!shift_id(id, start_at, end_at)")
      .order("created_at", { ascending: false }),
  ]);
```

And update the destructuring above it — find:

```ts
  const [
    { data: staff },
    { data: swaps },
    branches,
    { data: shiftsTodayRows },
    { data: clockedIn },
    { data: leaves },
    { data: yearAttendance },
    { data: shiftRequests },
  ] = await Promise.all([
```

Replace with:

```ts
  const [
    { data: staff },
    { data: swaps },
    branches,
    { data: shiftsTodayRows },
    { data: clockedIn },
    { data: leaves },
    { data: yearAttendance },
    { data: shiftRequests },
    { data: attendanceCorrections },
  ] = await Promise.all([
```

- [ ] **Step 2: Normalize and scope the new list**

Find:

```ts
  const shiftRequestsList = (shiftRequests as ShiftRequestDetailed[]) ?? [];
  const shiftsTodayList = (shiftsTodayRows as Pick<{ assignee_id: string }, "assignee_id">[]) ?? [];
```

Replace with:

```ts
  const shiftRequestsList = (shiftRequests as ShiftRequestDetailed[]) ?? [];
  const attendanceCorrectionsList = (attendanceCorrections as AttendanceCorrectionDetailed[]) ?? [];
  const shiftsTodayList = (shiftsTodayRows as Pick<{ assignee_id: string }, "assignee_id">[]) ?? [];
```

Then find the block of `scoped*` derivations (right after `groupMeta`) ending with `scopedShiftsToday`, and add one more scoped list immediately after `scopedShiftRequests`:

```ts
  const scopedShiftRequests = groupRoles
    ? shiftRequestsList.filter((r) => groupRoles.has(r.profile.role))
    : shiftRequestsList;
  const scopedAttendanceCorrections = groupRoles
    ? attendanceCorrectionsList.filter((r) => groupRoles.has(r.profile.role))
    : attendanceCorrectionsList;
```

- [ ] **Step 3: Add the Section**

Add the import at the top of the file:

```ts
import AttendanceCorrectionCard from "@/components/attendance/AttendanceCorrectionCard";
```

and add `AttendanceCorrectionDetailed` to the existing `import type { ... } from "@/types"` block.

Add a new `Section` right after the `"leave"` section (the last one in the file, before the closing `</div>`):

```tsx
      <Section id="attendance-corrections" title="Giải trình công" count={scopedAttendanceCorrections.length}>
        {scopedAttendanceCorrections.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có đơn giải trình công nào.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {scopedAttendanceCorrections.map((r) => (
              <AttendanceCorrectionCard
                key={r.id}
                request={r}
                canRespond={
                  r.status === "pending" &&
                  isLeaveApprover(manager.role) &&
                  canApproveLeaveFor(manager.role, r.profile.role)
                }
                canCancel={r.status === "pending"}
                showName
              />
            ))}
          </div>
        )}
      </Section>
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint "app/(app)/manager/page.tsx"`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/manager/page.tsx"
git commit -m "feat: add Giải trình công section to manager dashboard"
```

---

### Task 7: Notifications integration

**Files:**
- Modify: `lib/notifications.ts`
- Modify: `app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `AttendanceCorrectionDetailed` (Task 2), `isManagerRole` (existing import in both files).
- Produces: `buildNotifications()` gains one more parameter; nothing downstream depends on this beyond rendering the notification bell (`AppNotification[]` shape unchanged).

- [ ] **Step 1: Extend `buildNotifications`**

In `lib/notifications.ts`, update the import line:

```ts
import type {
  AttendanceCorrectionDetailed,
  LeaveRequestDetailed,
  Profile,
  ShiftRequestDetailed,
  SwapRequestDetailed,
} from "@/types";
```

Update the function signature — find:

```ts
export function buildNotifications({
  profile,
  swaps,
  leaves,
  shiftRequests,
}: {
  profile: Pick<Profile, "id" | "role">;
  swaps: SwapRequestDetailed[];
  leaves: LeaveRequestDetailed[];
  shiftRequests: ShiftRequestDetailed[];
}): AppNotification[] {
```

Replace with:

```ts
export function buildNotifications({
  profile,
  swaps,
  leaves,
  shiftRequests,
  attendanceCorrections,
}: {
  profile: Pick<Profile, "id" | "role">;
  swaps: SwapRequestDetailed[];
  leaves: LeaveRequestDetailed[];
  shiftRequests: ShiftRequestDetailed[];
  attendanceCorrections: AttendanceCorrectionDetailed[];
}): AppNotification[] {
```

Add a new loop right after the existing `for (const r of shiftRequests) { ... }` block, before the final `return items.sort(...)`:

```ts
  for (const c of attendanceCorrections) {
    const isMine = c.profile_id === profile.id;
    if (c.status === "pending" && isManager) {
      items.push({
        id: `attendance-correction-${c.id}`,
        text: `${c.profile.full_name} gửi đơn giải trình công đang chờ duyệt`,
        href: "/manager",
        at: c.created_at,
        needsAction: true,
      });
    } else if (
      isMine &&
      c.status !== "pending" &&
      c.resolved_at &&
      new Date(c.resolved_at).getTime() > recentCutoff
    ) {
      items.push({
        id: `attendance-correction-resolved-${c.id}`,
        text:
          c.status === "approved"
            ? "Đơn giải trình công của bạn đã được duyệt"
            : "Đơn giải trình công của bạn đã bị từ chối",
        href: "/attendance/explain",
        at: c.resolved_at,
        needsAction: false,
      });
    }
  }
```

Note: this uses the same flat `isManager` gate the existing `leaves`/`shiftRequests` loops use (not scoped by `canApproveLeaveFor`, and HR — not being `isManagerRole` — won't get the "pending, needs action" notification here) — this mirrors an existing simplification already present for leave-request notifications, not a new gap introduced by this feature. Do not "fix" it as part of this task; it's out of scope (see design spec §2).

- [ ] **Step 2: Fetch the new array in the layout**

In `app/(app)/layout.tsx`, update the import:

```ts
import type {
  AttendanceCorrectionDetailed,
  LeaveRequestDetailed,
  ShiftRequestDetailed,
  SwapRequestDetailed,
} from "@/types";
```

Update the `Promise.all` — find:

```ts
  const [{ data: swaps }, { data: leaves }, { data: shiftRequests }] = await Promise.all([
```

Replace with:

```ts
  const [{ data: swaps }, { data: leaves }, { data: shiftRequests }, { data: attendanceCorrections }] =
    await Promise.all([
```

and add one more entry to that same array, right after the `shift_requests` query:

```ts
    supabase
      .from("shift_requests")
      .select("*, profile:profiles!profile_id(id, full_name)")
      .order("created_at", { ascending: false })
      .limit(15),
    supabase
      .from("attendance_corrections")
      .select("*, profile:profiles!profile_id(id, full_name)")
      .order("created_at", { ascending: false })
      .limit(15),
  ]);
```

Update the `buildNotifications` call:

```ts
  const notifications = buildNotifications({
    profile,
    swaps: (swaps as SwapRequestDetailed[]) ?? [],
    leaves: (leaves as LeaveRequestDetailed[]) ?? [],
    shiftRequests: (shiftRequests as ShiftRequestDetailed[]) ?? [],
    attendanceCorrections: (attendanceCorrections as AttendanceCorrectionDetailed[]) ?? [],
  });
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint lib/notifications.ts "app/(app)/layout.tsx"`
Expected: no errors.

- [ ] **Step 4: Manual verification**

With the dev server running, sign in as an approver (e.g. `ceo`) while a `pending` attendance correction exists from Task 5's manual test, open the notification bell, confirm "... gửi đơn giải trình công đang chờ duyệt" appears and links to `/manager`.

- [ ] **Step 5: Commit**

```bash
git add lib/notifications.ts "app/(app)/layout.tsx"
git commit -m "feat: surface attendance correction requests in the notification bell"
```

---

## Self-Review Notes

- **Spec coverage:** §3 (data model) → Task 1. §4 (RPCs) → Task 1. §5 (actions, including the deliberate read-action exception) → Task 3. §6 (validation schema) → Task 2. §7 (types) → Task 2. §8 UI: `/attendance/explain` route + form → Task 5; manager Section → Task 6; notifications → Task 7. §9 (manual verification) → Steps embedded in Tasks 1, 5, 7.
- **Placeholder scan:** no TBD/TODO; every step has literal code. The one caveat (icon name substitution in Task 4 Step 2) is an explicit fallback instruction, not an unresolved placeholder.
- **Type consistency:** `CorrectionPreview` defined once in Task 3, imported by exact name in Task 5; `AttendanceCorrectionDetailed` defined once in Task 2, imported by exact name in Tasks 4, 5, 6, 7; `scopedAttendanceCorrections`/`attendanceCorrectionsList` defined once in Task 6 Step 2, used once in Step 3 — no renames across steps.
