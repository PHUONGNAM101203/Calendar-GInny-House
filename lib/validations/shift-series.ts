import { z } from "zod";
import { SHIFT_TYPES } from "@/lib/validations/shift";

// Wall-clock "HH:mm" and calendar "yyyy-MM-dd" — the two shapes the create RPC
// takes for its `time` and `date` parameters. Deliberately NOT ISO instants: a
// recurring rule has no single instant, and converting to one on the client
// would bake that browser's timezone into every future occurrence. The
// conversion to timestamptz happens in Postgres, pinned to Asia/Ho_Chi_Minh
// (see create_shift_series in 0078_shift_series.sql).
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Mirrors the DB's own cap (the 366-day guard in create_shift_series). Checked
// here too so the manager gets a field error instead of a round-trip and a raw
// exception.
const MAX_SPAN_DAYS = 366;

function spanInDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export const shiftSeriesSchema = z
  .object({
    // Optional since Đợt 3: leaving it empty plans the rule without putting
    // anyone on it, and the RPC materialises `shift_slots` instead of
    // `shifts`. A manager fills each slot later via assignShiftSlotAction.
    assignee_id: z.uuid("Vui lòng chọn nhân viên").optional(),
    // Optional for the same reason as shiftSchema's: a remote series has no
    // real branch, and actions/shift-series.ts fills in the synthetic Remote
    // branch (0066). Required again for every other shift type, below.
    branch_id: z.uuid("Vui lòng chọn cơ sở").optional(),
    shift_type: z.enum(SHIFT_TYPES, "Vui lòng chọn loại ca"),
    weekdays: z
      .array(z.number().int().min(0).max(6))
      .min(1, "Vui lòng chọn ít nhất một ngày trong tuần")
      .max(7, "Chỉ có 7 ngày trong tuần"),
    interval_weeks: z
      .number()
      .int()
      .min(1, "Số tuần lặp tối thiểu là 1")
      .max(8, "Số tuần lặp tối đa là 8"),
    start_time: z.string().regex(TIME_PATTERN, "Giờ bắt đầu không hợp lệ"),
    end_time: z.string().regex(TIME_PATTERN, "Giờ kết thúc không hợp lệ"),
    starts_on: z.string().regex(DATE_PATTERN, "Vui lòng chọn ngày bắt đầu"),
    // Empty means "Không kết thúc" (Đợt 2). The RPC then materialises 12 weeks
    // ahead and the nightly cron (/api/cron/shift-series-extend) keeps topping
    // it up, which is what makes an endless rule safe to allow at all.
    //
    // "" rather than undefined: the field is a controlled DatePickerField that
    // starts empty and is cleared back to "", so allowing undefined too would
    // let an untouched form and a deliberately-cleared one differ in type for
    // no gain. actions/shift-series.ts maps "" to null at the RPC boundary.
    ends_on: z.union([z.literal(""), z.string().regex(DATE_PATTERN, "Ngày kết thúc không hợp lệ")]),
    note: z.string().max(280, "Ghi chú tối đa 280 ký tự").optional(),
  })
  // Equal times would produce a zero-length shift, which shifts_time_valid
  // rejects. Unequal-but-earlier is fine — that's the overnight case.
  .refine((v) => v.start_time !== v.end_time, {
    message: "Giờ kết thúc phải khác giờ bắt đầu",
    path: ["end_time"],
  })
  // "yyyy-MM-dd" sorts lexicographically the same way it sorts chronologically,
  // so comparing the strings avoids parsing them into Date and picking up the
  // browser's timezone in the process.
  // Both range rules skip the open-ended case: there is no end to compare
  // against, and the 1-year cap is meaningless for a rule the cron keeps
  // extending 12 weeks at a time.
  .refine((v) => !v.ends_on || v.ends_on >= v.starts_on, {
    message: "Ngày kết thúc phải sau ngày bắt đầu",
    path: ["ends_on"],
  })
  .refine((v) => !v.ends_on || spanInDays(v.starts_on, v.ends_on) <= MAX_SPAN_DAYS, {
    message: "Ca cố định chỉ được lặp tối đa 1 năm",
    path: ["ends_on"],
  })
  .refine((v) => v.shift_type === "remote" || !!v.branch_id, {
    message: "Vui lòng chọn cơ sở",
    path: ["branch_id"],
  });
export type ShiftSeriesInput = z.infer<typeof shiftSeriesSchema>;

// The three scopes the owner asked for, as the delete dialog holds them.
export const SERIES_DELETE_SCOPES = ["one", "all", "range"] as const;
export type SeriesDeleteScope = (typeof SERIES_DELETE_SCOPES)[number];

// ...but only two of them reach the bulk RPC. "Chỉ xoá ca này" is the existing
// single-row deleteShiftAction, which already handles RLS refusal and the
// per-shift notification; routing it through here would duplicate both.
export const BULK_DELETE_SCOPES = ["all", "range"] as const;
export type BulkDeleteScope = (typeof BULK_DELETE_SCOPES)[number];

export const shiftSeriesDeleteSchema = z
  .object({
    series_id: z.uuid("Không xác định được ca cố định"),
    scope: z.enum(BULK_DELETE_SCOPES, "Vui lòng chọn phạm vi xoá"),
    from: z.string().regex(DATE_PATTERN, "Ngày bắt đầu không hợp lệ").optional(),
    to: z.string().regex(DATE_PATTERN, "Ngày kết thúc không hợp lệ").optional(),
  })
  .refine((v) => v.scope !== "range" || (!!v.from && !!v.to), {
    message: "Vui lòng chọn khoảng ngày",
    path: ["from"],
  })
  .refine((v) => v.scope !== "range" || !v.from || !v.to || v.to >= v.from, {
    message: "Ngày kết thúc phải sau ngày bắt đầu",
    path: ["to"],
  });
export type ShiftSeriesDeleteInput = z.infer<typeof shiftSeriesDeleteSchema>;

// Đợt 4 — sửa theo phạm vi. Only two scopes reach this RPC, for the same
// reason delete has only two: "Chỉ sửa ca này" is the existing single-shift
// ShiftFormDialog, which already handles RLS refusal and the per-shift
// notification.
//
// weekdays / interval_weeks / ends_on are meaningful only for scope "all" —
// they describe the whole rule, and there is no coherent way to make one
// fortnight of a Monday series run on Tuesdays. The RPC ignores them for
// "range".
export const shiftSeriesUpdateSchema = z
  .object({
    series_id: z.uuid("Không xác định được ca cố định"),
    scope: z.enum(BULK_DELETE_SCOPES, "Vui lòng chọn phạm vi sửa"),
    shift_type: z.enum(SHIFT_TYPES, "Vui lòng chọn loại ca"),
    branch_id: z.uuid("Vui lòng chọn cơ sở").optional(),
    assignee_id: z.uuid("Vui lòng chọn nhân viên").optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7, "Chỉ có 7 ngày trong tuần"),
    interval_weeks: z
      .number()
      .int()
      .min(1, "Số tuần lặp tối thiểu là 1")
      .max(8, "Số tuần lặp tối đa là 8"),
    start_time: z.string().regex(TIME_PATTERN, "Giờ bắt đầu không hợp lệ"),
    end_time: z.string().regex(TIME_PATTERN, "Giờ kết thúc không hợp lệ"),
    ends_on: z.union([z.literal(""), z.string().regex(DATE_PATTERN, "Ngày kết thúc không hợp lệ")]),
    note: z.string().max(280, "Ghi chú tối đa 280 ký tự").optional(),
    from: z.string().regex(DATE_PATTERN, "Ngày bắt đầu không hợp lệ").optional(),
    to: z.string().regex(DATE_PATTERN, "Ngày kết thúc không hợp lệ").optional(),
  })
  .refine((v) => v.start_time !== v.end_time, {
    message: "Giờ kết thúc phải khác giờ bắt đầu",
    path: ["end_time"],
  })
  .refine((v) => v.scope !== "all" || v.weekdays.length > 0, {
    message: "Vui lòng chọn ít nhất một ngày trong tuần",
    path: ["weekdays"],
  })
  .refine((v) => v.scope !== "range" || (!!v.from && !!v.to), {
    message: "Vui lòng chọn khoảng ngày",
    path: ["from"],
  })
  .refine((v) => v.scope !== "range" || !v.from || !v.to || v.to >= v.from, {
    message: "Ngày kết thúc phải sau ngày bắt đầu",
    path: ["to"],
  })
  .refine((v) => v.shift_type === "remote" || !!v.branch_id, {
    message: "Vui lòng chọn cơ sở",
    path: ["branch_id"],
  });
export type ShiftSeriesUpdateInput = z.infer<typeof shiftSeriesUpdateSchema>;

// Putting a person on an empty slot. assignee_id is required here even though
// it is optional when creating the rule — this action's whole purpose is to
// supply the name that was missing.
export const assignShiftSlotSchema = z.object({
  slot_id: z.uuid("Không xác định được ô ca"),
  assignee_id: z.uuid("Vui lòng chọn nhân viên"),
});
export type AssignShiftSlotInput = z.infer<typeof assignShiftSlotSchema>;
