import { z } from "zod";

/** Mirrors the byte cap in lib/ics/fetch-remote.ts so both paths refuse the same size. */
export const MAX_ICS_TEXT_LENGTH = 5 * 1024 * 1024;

// Two ways in, one action. The file branch carries the text itself — the
// browser reads the .ics with FileReader and posts a string, so nothing is
// ever written to storage and there is no upload endpoint to secure. The URL
// branch carries only the address; the server fetches it behind the SSRF
// checks in lib/ics/fetch-remote.ts, which is why nothing here tries to judge
// whether a host is safe.
export const icsImportSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("url"),
    calendar_id: z.uuid("Lịch không hợp lệ"),
    url: z.string().trim().min(1, "Vui lòng nhập đường dẫn lịch").max(2048, "Đường dẫn quá dài"),
  }),
  z.object({
    source: z.literal("file"),
    calendar_id: z.uuid("Lịch không hợp lệ"),
    text: z
      .string()
      .min(1, "File lịch trống")
      .max(MAX_ICS_TEXT_LENGTH, "File lịch quá lớn (tối đa 5MB)"),
  }),
]);

export type IcsImportInput = z.infer<typeof icsImportSchema>;
