// Converting a Vietnamese wall-clock reading into a UTC instant.
//
// The rest of the app formats instants *out* of the database — VN_TIME in
// lib/notifications-emit.ts, formatInVietnamDate in
// actions/attendance-corrections.ts. This is the other direction: a user types
// "08:00" and something has to decide which instant that names.
//
// Doing it with date-fns `parse()` is wrong here, and was a real bug.
// `parse()` builds a Date in whatever zone the *process* runs in, and Vercel's
// Node runtime is UTC with no TZ pinned anywhere in this repo — so "08:00"
// became 08:00Z, which every Vietnamese browser then rendered as 15:00.
// Nothing in the app may infer the zone from the runtime; it has to be named.
export const APP_TIME_ZONE = "Asia/Ho_Chi_Minh";

export type WallClock = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// Offset of `zone` from UTC at instant `at`, in milliseconds, positive east of
// Greenwich. Derived by asking Intl what the wall clock reads there and
// subtracting the instant — there is no API that takes a zone and a date and
// hands back an offset.
function zoneOffsetMs(at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const read: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") read[part.type] = part.value;
  }

  // hour12:false renders midnight as "24" in some ICU builds, which would
  // throw the offset a full day out.
  const hour = read.hour === "24" ? 0 : Number(read.hour);
  const asUtc = Date.UTC(
    Number(read.year),
    Number(read.month) - 1,
    Number(read.day),
    hour,
    Number(read.minute),
    Number(read.second)
  );
  return asUtc - at.getTime();
}

// A wall-clock reading in `zone` → the UTC instant it names.
//
// Two passes, because the offset depends on the instant we are still solving
// for: the first uses the offset at the naive guess, the second the offset at
// the resulting instant. That converges everywhere except inside the one
// ambiguous or skipped hour of a DST transition, where any answer is a
// judgement call and this picks a stable one rather than throwing. Vietnam has
// had no DST since 1975, but imported calendars carry other zones.
export function wallClockToUtc(clock: WallClock, zone: string): Date {
  const naive = Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second
  );
  const firstPass = new Date(naive - zoneOffsetMs(new Date(naive), zone));
  return new Date(naive - zoneOffsetMs(firstPass, zone));
}

/**
 * "2026-09-01" + "08:00" → the instant that 08:00 names in Vietnam.
 *
 * Returns null rather than an Invalid Date when either part is malformed, so
 * callers surface a validation error instead of throwing on .toISOString().
 * `time` may be omitted for an all-day value, which resolves to local midnight.
 */
export function vietnamInstant(date: string, time?: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!dateMatch) return null;

  const timeMatch = time === undefined ? null : /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (time !== undefined && !timeMatch) return null;

  const clock: WallClock = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: timeMatch ? Number(timeMatch[1]) : 0,
    minute: timeMatch ? Number(timeMatch[2]) : 0,
    second: 0,
  };

  if (clock.month < 1 || clock.month > 12 || clock.day < 1 || clock.day > 31) return null;
  if (clock.hour > 23 || clock.minute > 59) return null;

  return wallClockToUtc(clock, APP_TIME_ZONE);
}
