"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth";
import { assertAssigneeAllowed, resolveShiftBranchId } from "@/lib/shift-guards";
import { describeSeriesRange, describeSeriesRule } from "@/lib/shift-series";
import { shiftSeriesSchema, shiftSeriesDeleteSchema } from "@/lib/validations/shift-series";
import { emitNotifications } from "@/lib/notifications-emit";
import type { ActionResult } from "@/types";

export type SeriesSkip = { date: string; reason: string };

export type SeriesCreateSummary = {
  seriesId: string;
  created: number;
  skipped: SeriesSkip[];
};

export type SeriesDeleteSummary = {
  deleted: number;
  kept: number;
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
  };
}

function readDeleteSummary(payload: unknown): SeriesDeleteSummary {
  const row = (payload ?? {}) as Record<string, unknown>;
  return {
    deleted: typeof row.deleted === "number" ? row.deleted : 0,
    kept: typeof row.kept === "number" ? row.kept : 0,
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

  const assigneeError = await assertAssigneeAllowed(
    supabase,
    manager.role,
    parsed.data.assignee_id,
    branchId,
    parsed.data.shift_type === "remote"
  );
  if (assigneeError) return { ok: false, error: assigneeError };

  // The whole rule goes to Postgres as weekdays + times + dates, never as a
  // list of computed instants: only the database knows to resolve them in
  // Asia/Ho_Chi_Minh, and only the database can check each occurrence against
  // the overlap constraint and the quản sinh trigger before inserting it.
  const { data, error } = await supabase.rpc("create_shift_series", {
    p_assignee_id: parsed.data.assignee_id,
    p_branch_id: branchId,
    p_shift_type: parsed.data.shift_type,
    p_weekdays: parsed.data.weekdays,
    p_interval_weeks: parsed.data.interval_weeks,
    p_start_time: parsed.data.start_time,
    p_end_time: parsed.data.end_time,
    p_starts_on: parsed.data.starts_on,
    p_ends_on: parsed.data.ends_on,
    p_note: parsed.data.note || null,
  });

  if (error) {
    return { ok: false, error: mapSeriesError(error.message, "Không thể tạo ca cố định") };
  }

  const summary = readCreateSummary(data);
  revalidateSeriesPaths();

  // One notification for the whole batch, not one per occurrence — a dozen
  // identical bell rows for a single action is noise, not information.
  if (summary.created > 0) {
    const rule = describeSeriesRule({
      weekdays: parsed.data.weekdays,
      interval_weeks: parsed.data.interval_weeks,
      start_time: parsed.data.start_time,
      end_time: parsed.data.end_time,
    });
    const range = describeSeriesRange({
      starts_on: parsed.data.starts_on,
      ends_on: parsed.data.ends_on,
    });
    after(() =>
      emitNotifications([
        {
          profileId: parsed.data.assignee_id,
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

  // Nothing removed and nothing kept means the scope matched no occurrence at
  // all. Reported as a failure rather than a silent "Đã xoá" — the same
  // false-success trap that count: "exact" fixes for the single-shift delete.
  if (summary.deleted === 0 && summary.kept === 0) {
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
