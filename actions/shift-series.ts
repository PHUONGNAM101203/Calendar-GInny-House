"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth";
import { assertAssigneeAllowed, resolveShiftBranchId } from "@/lib/shift-guards";
import { describeSeriesRange, describeSeriesRule } from "@/lib/shift-series";
import {
  shiftSeriesSchema,
  shiftSeriesDeleteSchema,
  shiftSeriesUpdateSchema,
  assignShiftSlotSchema,
  type BulkDeleteScope,
} from "@/lib/validations/shift-series";
import { emitNotifications, formatShiftWindow } from "@/lib/notifications-emit";
import type { ActionResult } from "@/types";

export type SeriesSkip = { date: string; reason: string };

export type SeriesCreateSummary = {
  seriesId: string;
  created: number;
  skipped: SeriesSkip[];
  // True when the rule was planned without anyone on it, so `created` counts
  // empty slots rather than shifts. Drives the wording and, more importantly,
  // suppresses the notification — an empty slot has nobody to notify.
  unassigned: boolean;
};

export type SeriesDeleteSummary = {
  deleted: number;
  kept: number;
  slotsDeleted: number;
  seriesRemoved: boolean;
};

// Every exception the two RPCs raise is authored by us, in Vietnamese, and is
// safe to show. Anything else reaching here is a Postgres/RLS message in
// English — never surfaced, same rule as mapShiftError in actions/shifts.ts.
// Matching against the list rather than passing the string through is what
// makes that distinction, so keep this in sync with 0078_shift_series.sql.
const KNOWN_SERIES_ERRORS = [
  "Chưa đăng nhập",
  "Bạn không có quyền xếp ca cho nhân viên này",
  "Bạn không có quyền xoá ca của nhân viên này",
  "Vui lòng chọn cơ sở",
  "Vui lòng chọn ngày kết thúc",
  "Ngày kết thúc phải sau ngày bắt đầu",
  "Ca cố định chỉ được lặp tối đa 1 năm",
  "Vui lòng chọn ít nhất một ngày trong tuần",
  "Không tìm thấy ca cố định này",
  "Vui lòng chọn khoảng ngày",
  "Phạm vi xoá không hợp lệ",
  // Đợt 4 — sửa theo phạm vi (0084)
  "Phạm vi sửa không hợp lệ",
  "Bạn không có quyền sửa ca cố định này",
  "Bạn không có quyền sửa ca của nhân viên này",
  "Giờ kết thúc phải khác giờ bắt đầu",
  // Đợt 3 — ô trống (0079)
  "Bạn không có quyền tạo ca cố định",
  "Bạn không có quyền xoá ca cố định này",
  "Bạn không có quyền xoá ô ca này",
  "Vui lòng chọn nhân viên",
  "Ô ca này không còn nữa",
  "Nhân viên này đã có ca trùng giờ",
  // Raised by the quản sinh trigger on `shifts` (0055), which assign_shift_slot
  // goes through like any other write into that table.
  "Đã có quản sinh khác trực ca bắt đầu cùng giờ này",
];

function mapSeriesError(message: string, fallback: string): string {
  return KNOWN_SERIES_ERRORS.find((known) => message.includes(known)) ?? fallback;
}

// The RPCs return jsonb, which supabase-js hands back as loosely-typed JSON.
// Narrowed here rather than cast: a shape change in SQL should degrade to
// "0 ca" in the toast, not throw inside a server action after the shifts have
// already been written.
function readCreateSummary(payload: unknown): SeriesCreateSummary {
  const row = (payload ?? {}) as Record<string, unknown>;
  return {
    seriesId: typeof row.series_id === "string" ? row.series_id : "",
    created: typeof row.created === "number" ? row.created : 0,
    skipped: Array.isArray(row.skipped) ? (row.skipped as SeriesSkip[]) : [],
    unassigned: row.unassigned === true,
  };
}

function readDeleteSummary(payload: unknown): SeriesDeleteSummary {
  const row = (payload ?? {}) as Record<string, unknown>;
  return {
    deleted: typeof row.deleted === "number" ? row.deleted : 0,
    kept: typeof row.kept === "number" ? row.kept : 0,
    slotsDeleted: typeof row.slots_deleted === "number" ? row.slots_deleted : 0,
    seriesRemoved: row.series_removed === true,
  };
}

function revalidateSeriesPaths() {
  revalidatePath("/calendar");
  revalidatePath("/manager");
}

export async function createShiftSeriesAction(
  input: unknown
): Promise<ActionResult<SeriesCreateSummary>> {
  const manager = await requireManager();
  const parsed = shiftSeriesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const branchId = await resolveShiftBranchId(parsed.data.shift_type, parsed.data.branch_id);

  // Only meaningful when a person was chosen. With no assignee there is
  // nobody to scope against, and the RPC falls back to can_manage_shift_slots()
  // — "may this caller schedule anyone at all" — as its own gate.
  if (parsed.data.assignee_id) {
    const assigneeError = await assertAssigneeAllowed(
      supabase,
      manager.role,
      parsed.data.assignee_id,
      branchId,
      parsed.data.shift_type === "remote"
    );
    if (assigneeError) return { ok: false, error: assigneeError };
  }

  // The whole rule goes to Postgres as weekdays + times + dates, never as a
  // list of computed instants: only the database knows to resolve them in
  // Asia/Ho_Chi_Minh, and only the database can check each occurrence against
  // the overlap constraint and the quản sinh trigger before inserting it.
  const { data, error } = await supabase.rpc("create_shift_series", {
    p_assignee_id: parsed.data.assignee_id ?? null,
    p_branch_id: branchId,
    p_shift_type: parsed.data.shift_type,
    p_weekdays: parsed.data.weekdays,
    p_interval_weeks: parsed.data.interval_weeks,
    p_start_time: parsed.data.start_time,
    p_end_time: parsed.data.end_time,
    p_starts_on: parsed.data.starts_on,
    // "" is the form's "Không kết thúc"; the column and the RPC both want null.
    // Passing "" through would be a date-parse error, not an open-ended rule.
    p_ends_on: parsed.data.ends_on || null,
    p_note: parsed.data.note || null,
  });

  if (error) {
    return { ok: false, error: mapSeriesError(error.message, "Không thể tạo ca cố định") };
  }

  const summary = readCreateSummary(data);
  revalidateSeriesPaths();

  // One notification for the whole batch, not one per occurrence — a dozen
  // identical bell rows for a single action is noise, not information. Skipped
  // entirely for an unassigned rule: it produced empty slots, which belong to
  // nobody and which staff are not allowed to see in the first place.
  const assigneeId = parsed.data.assignee_id;
  if (summary.created > 0 && assigneeId) {
    const rule = describeSeriesRule({
      weekdays: parsed.data.weekdays,
      interval_weeks: parsed.data.interval_weeks,
      start_time: parsed.data.start_time,
      end_time: parsed.data.end_time,
    });
    const range = describeSeriesRange({
      starts_on: parsed.data.starts_on,
      // Same "" → null mapping as the RPC call above, so an open-ended rule
      // reads "Từ 01/09/2026" in the notification instead of a bare dash.
      ends_on: parsed.data.ends_on || null,
    });
    after(() =>
      emitNotifications([
        {
          profileId: assigneeId,
          kind: "shift_assigned",
          title: "Ca cố định mới",
          body: `Bạn được xếp ${summary.created} ca: ${rule} (${range})`,
          url: "/calendar",
          relatedId: summary.seriesId || null,
        },
      ])
    );
  }

  return { ok: true, data: summary };
}

export async function deleteShiftSeriesAction(
  input: unknown
): Promise<ActionResult<SeriesDeleteSummary>> {
  await requireManager();
  const parsed = shiftSeriesDeleteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_shift_series_occurrences", {
    p_series_id: parsed.data.series_id,
    p_scope: parsed.data.scope,
    p_from: parsed.data.from ?? null,
    p_to: parsed.data.to ?? null,
  });

  if (error) {
    return { ok: false, error: mapSeriesError(error.message, "Không thể xoá ca cố định") };
  }

  const summary = readDeleteSummary(data);

  // Nothing removed, nothing kept and no empty slot touched means the scope
  // matched no occurrence at all. Reported as a failure rather than a silent
  // "Đã xoá" — the same false-success trap that count: "exact" fixes for the
  // single-shift delete. slotsDeleted has to be in this test: a rule that was
  // never assigned has only slots, so leaving it out would call a successful
  // cleanup a failure.
  if (summary.deleted === 0 && summary.kept === 0 && summary.slotsDeleted === 0) {
    return { ok: false, error: "Không có ca nào trong phạm vi đã chọn" };
  }

  revalidateSeriesPaths();

  if (summary.deleted > 0) {
    // The RPC returns the assignee because the shifts are gone by the time it
    // does — there is nothing left to read the recipient off.
    const assigneeId = (data as Record<string, unknown> | null)?.assignee_id;
    if (typeof assigneeId === "string") {
      after(() =>
        emitNotifications([
          {
            profileId: assigneeId,
            kind: "shift_deleted",
            title: "Ca cố định bị xoá",
            body: `${summary.deleted} ca cố định của bạn đã bị xoá khỏi lịch`,
            url: "/calendar",
            relatedId: parsed.data.series_id,
          },
        ])
      );
    }
  }

  return { ok: true, data: summary };
}

export type SeriesUpdateSummary = {
  scope: BulkDeleteScope;
  /** Occurrences rewritten ("range") or re-created from the new rule ("all"). */
  updated: number;
  /** Left alone because they already have attendance against them. */
  kept: number;
  /** Occurrences the new rule could not place — reported, never fatal. */
  conflicts: number;
  /** Future occurrences removed before re-materialising. "all" only. */
  deleted: number;
  skipped: SeriesSkip[];
};

function readUpdateSummary(payload: unknown, fallbackScope: BulkDeleteScope): SeriesUpdateSummary {
  const row = (payload ?? {}) as Record<string, unknown>;
  return {
    scope: row.scope === "all" || row.scope === "range" ? row.scope : fallbackScope,
    updated: typeof row.updated === "number" ? row.updated : 0,
    kept: typeof row.kept === "number" ? row.kept : 0,
    conflicts: typeof row.conflicts === "number" ? row.conflicts : 0,
    deleted: typeof row.deleted === "number" ? row.deleted : 0,
    skipped: Array.isArray(row.skipped) ? (row.skipped as SeriesSkip[]) : [],
  };
}

// Đợt 4 — sửa theo phạm vi.
//
// "all" rewrites the rule and re-materialises everything from today forward;
// "range" rewrites just the occurrences inside the chosen dates and leaves the
// rule alone. Neither ever touches an occurrence that already has attendance,
// nor anything in the past — see the header of 0084 for why both matter.
export async function updateShiftSeriesAction(
  input: unknown
): Promise<ActionResult<SeriesUpdateSummary>> {
  const manager = await requireManager();
  const parsed = shiftSeriesUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const branchId = await resolveShiftBranchId(parsed.data.shift_type, parsed.data.branch_id);

  // The same guard the create path runs, for the same reason: the RPC checks
  // can_manage_shift_for on the new assignee, but this one also enforces the
  // branch/role pairing the RPC has no opinion about.
  if (parsed.data.assignee_id) {
    const assigneeError = await assertAssigneeAllowed(
      supabase,
      manager.role,
      parsed.data.assignee_id,
      branchId,
      parsed.data.shift_type === "remote"
    );
    if (assigneeError) return { ok: false, error: assigneeError };
  }

  const { data, error } = await supabase.rpc("update_shift_series_occurrences", {
    p_series_id: parsed.data.series_id,
    p_scope: parsed.data.scope,
    p_shift_type: parsed.data.shift_type,
    p_start_time: parsed.data.start_time,
    p_end_time: parsed.data.end_time,
    p_branch_id: branchId,
    p_assignee_id: parsed.data.assignee_id ?? null,
    p_weekdays: parsed.data.weekdays,
    p_interval_weeks: parsed.data.interval_weeks,
    // "" is "Không kết thúc", the same mapping createShiftSeriesAction does.
    p_ends_on: parsed.data.ends_on || null,
    p_note: parsed.data.note || null,
    p_from: parsed.data.from ?? null,
    p_to: parsed.data.to ?? null,
  });

  if (error) {
    return { ok: false, error: mapSeriesError(error.message, "Không thể sửa ca cố định") };
  }

  const summary = readUpdateSummary(data, parsed.data.scope);

  // Nothing changed, nothing kept, nothing clashed means the scope matched no
  // occurrence at all — reported as a failure rather than a silent "Đã sửa",
  // the same false-success trap deleteShiftSeriesAction guards against.
  if (summary.updated === 0 && summary.kept === 0 && summary.conflicts === 0) {
    return { ok: false, error: "Không có ca nào trong phạm vi đã chọn" };
  }

  revalidateSeriesPaths();

  if (summary.updated > 0) {
    // Read off the RPC's return, not the request: on "range" the assignee may
    // have been left unchanged, in which case the payload carries the series'
    // existing one rather than a null.
    const assigneeId = (data as Record<string, unknown> | null)?.assignee_id;
    if (typeof assigneeId === "string") {
      after(() =>
        emitNotifications([
          {
            profileId: assigneeId,
            kind: "shift_updated",
            title: "Ca cố định thay đổi",
            body: `${summary.updated} ca cố định của bạn đã được cập nhật`,
            url: "/calendar",
            relatedId: parsed.data.series_id,
          },
        ])
      );
    }
  }

  return { ok: true, data: summary };
}

export type SlotAssignSummary = {
  shiftId: string;
  startAt: string;
  endAt: string;
};

// Puts a person on an empty slot, turning it into a real shift. The RPC does
// the conversion atomically — insert the shift, drop the slot — so a slot can
// never survive as a duplicate of the shift it became.
export async function assignShiftSlotAction(
  input: unknown
): Promise<ActionResult<SlotAssignSummary>> {
  const manager = await requireManager();
  const parsed = assignShiftSlotSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();

  // The slot carries the branch, so the branch-membership half of this guard
  // needs it before the RPC runs. Read separately rather than trusting the
  // client: the slot id is the only thing that crossed the wire.
  const { data: slot } = await supabase
    .from("shift_slots")
    .select("branch_id, shift_type")
    .eq("id", parsed.data.slot_id)
    .maybeSingle();
  if (!slot) return { ok: false, error: "Ô ca này không còn nữa" };

  const assigneeError = await assertAssigneeAllowed(
    supabase,
    manager.role,
    parsed.data.assignee_id,
    slot.branch_id,
    slot.shift_type === "remote"
  );
  if (assigneeError) return { ok: false, error: assigneeError };

  const { data, error } = await supabase.rpc("assign_shift_slot", {
    p_slot_id: parsed.data.slot_id,
    p_assignee_id: parsed.data.assignee_id,
  });

  if (error) {
    return { ok: false, error: mapSeriesError(error.message, "Không thể gán ca cho nhân viên") };
  }

  const row = (data ?? {}) as Record<string, unknown>;
  const summary: SlotAssignSummary = {
    shiftId: typeof row.shift_id === "string" ? row.shift_id : "",
    startAt: typeof row.start_at === "string" ? row.start_at : "",
    endAt: typeof row.end_at === "string" ? row.end_at : "",
  };

  revalidateSeriesPaths();

  // Now there IS someone to tell — this is the moment a plan becomes their
  // shift, so it gets the same notification a directly-created shift gets.
  if (summary.startAt && summary.endAt) {
    after(() =>
      emitNotifications([
        {
          profileId: parsed.data.assignee_id,
          kind: "shift_assigned",
          title: "Ca làm việc mới",
          body: `Bạn được xếp ca ${formatShiftWindow(summary.startAt, summary.endAt)}`,
          url: "/calendar",
          relatedId: summary.shiftId || null,
        },
      ])
    );
  }

  return { ok: true, data: summary };
}

// Removing a single empty slot. No notification and no attendance check: an
// unassigned slot belongs to nobody and cannot have a clock-in against it.
export async function deleteShiftSlotAction(slotId: string): Promise<ActionResult> {
  await requireManager();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("delete_shift_slot", { p_slot_id: slotId });
  if (error) {
    return { ok: false, error: mapSeriesError(error.message, "Không thể xoá ô ca") };
  }
  // The RPC returns false when the row was already gone — reported rather than
  // toasted as success, so a stale list never claims a delete that did nothing.
  if (data !== true) return { ok: false, error: "Ô ca này không còn nữa" };

  revalidateSeriesPaths();
  return { ok: true, data: undefined };
}
