import { z } from "zod";

// Both dates are inclusive and stored as-typed ("yyyy-MM-dd") — see the
// Holiday type in types/index.ts. The end >= start rule is enforced here for
// the instant form error AND by the holidays_dates_valid check constraint in
// 0080, so a hand-crafted request can't get past it either.
export const holidaySchema = z
  .object({
    name: z.string().trim().min(1, "Vui lòng nhập tên ngày lễ").max(120, "Tên tối đa 120 ký tự"),
    start_date: z.string().min(1, "Vui lòng chọn ngày bắt đầu"),
    end_date: z.string().min(1, "Vui lòng chọn ngày kết thúc"),
    // Trimmed to "" then normalised to null on write, so an emptied-out note
    // clears the column instead of storing a blank string.
    note: z.string().trim().max(500, "Ghi chú tối đa 500 ký tự").optional(),
  })
  .refine((v) => v.end_date >= v.start_date, {
    message: "Ngày kết thúc phải bằng hoặc sau ngày bắt đầu",
    path: ["end_date"],
  });

export type HolidayInput = z.infer<typeof holidaySchema>;

export const holidayUpdateSchema = z.object({
  id: z.uuid("Ngày lễ không hợp lệ"),
  values: holidaySchema,
});

export type HolidayUpdateInput = z.infer<typeof holidayUpdateSchema>;
