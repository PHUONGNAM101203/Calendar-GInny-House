import { z } from "zod";

export const customEventSchema = z
  .object({
    title: z.string().min(1, "Vui lòng nhập tên sự kiện").max(120, "Tên tối đa 120 ký tự"),
    all_day: z.boolean(),
    start_date: z.string().min(1, "Vui lòng chọn ngày bắt đầu"),
    end_date: z.string().min(1, "Vui lòng chọn ngày kết thúc"),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
  })
  .refine((v) => v.end_date >= v.start_date, {
    message: "Ngày kết thúc phải sau ngày bắt đầu",
    path: ["end_date"],
  })
  .refine((v) => v.all_day || Boolean(v.start_time), {
    message: "Vui lòng chọn giờ bắt đầu",
    path: ["start_time"],
  })
  .refine((v) => v.all_day || Boolean(v.end_time), {
    message: "Vui lòng chọn giờ kết thúc",
    path: ["end_time"],
  })
  .refine(
    (v) => v.all_day || v.end_date !== v.start_date || !v.start_time || !v.end_time || v.end_time > v.start_time,
    { message: "Giờ kết thúc phải sau giờ bắt đầu", path: ["end_time"] }
  );

export type CustomEventInput = z.infer<typeof customEventSchema>;
