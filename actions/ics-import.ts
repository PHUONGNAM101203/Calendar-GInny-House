"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { fetchRemoteIcs } from "@/lib/ics/fetch-remote";
import { MAX_IMPORTED_EVENTS, RECURRENCE_HORIZON_MONTHS, parseIcsCalendar } from "@/lib/ics";
import { icsImportSchema } from "@/lib/validations/ics-import";
import type { ActionResult } from "@/types";

export type IcsImportReport = {
  imported: number;
  /** VEVENTs with no usable DTSTART. */
  skipped: number;
  /** Series whose RRULE this parser does not implement — first occurrence only. */
  unsupportedRecurrence: number;
  /** The 12-month horizon or the row cap cut the file short. */
  truncated: boolean;
  horizonMonths: number;
};

// Supabase rejects very large single inserts, and 2000 rows of five columns is
// past the comfortable range for one statement. Chunking also means a partial
// failure leaves the earlier chunks in place, which is the better outcome
// here: the user sees fewer events than expected and can re-import, rather
// than losing a whole file to one bad row.
const INSERT_CHUNK = 500;

// Deliberately a local copy of the ownership check rather than a shared
// helper. actions/custom-calendars.ts holds the original, but that file is
// "use server": everything it exports becomes a callable server endpoint, and
// a helper taking a Supabase client as its first argument must not be one.
async function assertOwnsCalendar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  calendarId: string,
  profileId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("custom_calendars")
    .select("owner_id")
    .eq("id", calendarId)
    .maybeSingle();

  if (!data) return "Không tìm thấy lịch";
  if ((data as { owner_id: string }).owner_id !== profileId) {
    return "Bạn chỉ có thể nhập sự kiện vào lịch của mình";
  }
  return null;
}

export async function importIcsAction(input: unknown): Promise<ActionResult<IcsImportReport>> {
  const profile = await requireProfile();

  const parsed = icsImportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const request = parsed.data;

  const supabase = await createClient();
  // Checked before fetching, not after: an unauthorised caller must not be
  // able to use this action as a general-purpose URL fetcher.
  const ownerError = await assertOwnsCalendar(supabase, request.calendar_id, profile.id);
  if (ownerError) return { ok: false, error: ownerError };

  let icsText: string;
  if (request.source === "url") {
    const fetched = await fetchRemoteIcs(request.url);
    if (!fetched.ok) return { ok: false, error: fetched.error };
    icsText = fetched.text;
  } else {
    icsText = request.text;
  }

  if (!icsText.includes("BEGIN:VCALENDAR")) {
    return { ok: false, error: "Nội dung này không phải file lịch (.ics) hợp lệ." };
  }

  const summary = parseIcsCalendar(icsText);
  if (summary.events.length === 0) {
    return {
      ok: false,
      error: summary.skipped
        ? "Không đọc được sự kiện nào — file có sự kiện nhưng thiếu ngày bắt đầu."
        : "File lịch này không có sự kiện nào.",
    };
  }

  for (let offset = 0; offset < summary.events.length; offset += INSERT_CHUNK) {
    const { error } = await supabase.from("custom_events").insert(
      summary.events.slice(offset, offset + INSERT_CHUNK).map((event) => ({
        calendar_id: request.calendar_id,
        title: event.title,
        start_at: event.start_at,
        end_at: event.end_at,
        all_day: event.all_day,
      }))
    );

    if (error) {
      console.error("[ics] insert failed", { code: error.code, message: error.message, offset });
      revalidatePath("/calendar");
      return {
        ok: false,
        error:
          offset === 0
            ? "Không thể lưu sự kiện vào lịch."
            : `Đã nhập được ${offset} sự kiện rồi dừng vì lỗi lưu. Bạn có thể xoá lịch này và thử lại.`,
      };
    }
  }

  revalidatePath("/calendar");
  return {
    ok: true,
    data: {
      imported: summary.events.length,
      skipped: summary.skipped,
      unsupportedRecurrence: summary.unsupportedRecurrence,
      truncated: summary.truncated || summary.events.length >= MAX_IMPORTED_EVENTS,
      horizonMonths: RECURRENCE_HORIZON_MONTHS,
    },
  };
}
