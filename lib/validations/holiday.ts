import { z } from "zod";
import { CALENDAR_MAX_HOUR, CALENDAR_MIN_HOUR } from "@/lib/constants";

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

// The calendar only draws between CALENDAR_MIN_HOUR and CALENDAR_MAX_HOUR, so
// a half-day starting outside that window would shade nothing at all (or the
// whole day, which is what "nguyên ngày" is for). Reject it here rather than
// letting someone save an invisible holiday.
const MIN_TIME = `${String(CALENDAR_MIN_HOUR).padStart(2, "0")}:00`;
const MAX_TIME = `${String(CALENDAR_MAX_HOUR).padStart(2, "0")}:00`;

// Both dates are inclusive and stored as-typed ("yyyy-MM-dd") — see the
// Holiday type in types/index.ts. The end >= start rule is enforced here for
// the instant form error AND by the holidays_dates_valid check constraint in
// 0080, so a hand-crafted request can't get past it either.
export const holidaySchema = z
  .object({
    name: z.string().trim().min(1, "Vui lòng nhập tên ngày lễ").max(120, "Tên tối đa 120 ký tự"),
    start_date: z.string().min(1, "Vui lòng chọn ngày bắt đầu"),
    end_date: z.string().min(1, "Vui lòng chọn ngày kết thúc"),
    // false = nguyên ngày (the default, and what every pre-0082 row is).
    half_day: z.boolean(),
    // Only meaningful when half_day is true; "" from an untouched form field
    // is normalised to null on write.
    start_time: z.string().optional(),
    // Trimmed to "" then normalised to null on write, so an emptied-out note
    // clears the column instead of storing a blank string.
    note: z.string().trim().max(500, "Ghi chú tối đa 500 ký tự").optional(),
  })
  .refine((v) => v.end_date >= v.start_date, {
    message: "Ngày kết thúc phải bằng hoặc sau ngày bắt đầu",
    path: ["end_date"],
  })
  // A half-day needs to say when it starts — that hour is the only thing that
  // makes it different from a full day on the calendar.
  .refine((v) => !v.half_day || HH_MM.test(v.start_time ?? ""), {
    message: "Vui lòng chọn giờ bắt đầu nghỉ",
    path: ["start_time"],
  })
  .refine((v) => !v.half_day || !HH_MM.test(v.start_time ?? "") || (v.start_time! >= MIN_TIME && v.start_time! < MAX_TIME), {
    message: `Giờ bắt đầu phải nằm trong khoảng ${MIN_TIME} – ${MAX_TIME}`,
    path: ["start_time"],
  });

export type HolidayInput = z.infer<typeof holidaySchema>;

export const holidayUpdateSchema = z.object({
  id: z.uuid("Ngày lễ không hợp lệ"),
  values: holidaySchema,
});

export type HolidayUpdateInput = z.infer<typeof holidayUpdateSchema>;
