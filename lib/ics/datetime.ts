// Date/time handling for ICS import (RFC 5545 §3.3.4-3.3.5).
//
// Everything here works in *wall-clock* terms — a calendar day and a clock
// reading in a named zone — and only converts to a UTC instant at the very
// end. That ordering matters for recurrence: "every Monday at 08:00" is a
// statement about the clock on the wall, so expanding it by adding 7×24h to a
// UTC instant silently drifts by an hour across a DST boundary in any zone
// that has one. lib/ics/rrule.ts therefore expands over WallClock values and
// calls wallClockToUtc() once per occurrence.

/** The only zone this app displays in — see the timezone note in AGENTS.md. */
export const APP_TIME_ZONE = "Asia/Ho_Chi_Minh";

export type WallClock = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type IcsMoment = {
  clock: WallClock;
  /** IANA zone the clock reading belongs to. */
  zone: string;
  /** DTSTART;VALUE=DATE — a whole calendar day, not an instant. */
  dateOnly: boolean;
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
// subtracting the instant — there is no direct API that takes a zone and a
// date and hands back an offset.
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
// judgement call and this picks a stable one rather than throwing.
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

export function icsMomentToUtc(moment: IcsMoment): Date {
  return wallClockToUtc(moment.clock, moment.zone);
}

const ICS_DATE_TIME = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/;

// DTSTART / DTEND / EXDATE values in all three forms RFC 5545 allows:
//   20260901                          → whole day
//   20260901T080000Z                  → UTC instant
//   20260901T080000 (+ optional TZID) → wall clock in that zone
//
// A floating value (no Z, no TZID) is read as Vietnam time rather than as the
// server's zone: this runs on Vercel, where the process zone is UTC, so
// trusting the runtime would shift every floating event by seven hours.
export function parseIcsDateTime(
  raw: string,
  params: Record<string, string>
): IcsMoment | null {
  const match = ICS_DATE_TIME.exec(raw.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute, second, utcFlag] = match;
  const dateOnly = params.VALUE === "DATE" || hour === undefined;

  const clock: WallClock = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: dateOnly ? 0 : Number(hour),
    minute: dateOnly ? 0 : Number(minute),
    second: dateOnly ? 0 : Number(second),
  };

  if (clock.month < 1 || clock.month > 12 || clock.day < 1 || clock.day > 31) {
    return null;
  }

  // A UTC value is already an instant; re-expressing it as a wall clock in UTC
  // gives recurrence expansion a single representation to work with.
  const zone = utcFlag
    ? "UTC"
    : params.TZID && isValidTimeZone(params.TZID)
      ? params.TZID
      : APP_TIME_ZONE;

  return { clock, zone, dateOnly };
}

export function addDaysToClock(clock: WallClock, days: number): WallClock {
  const shifted = new Date(Date.UTC(clock.year, clock.month - 1, clock.day + days));
  return {
    ...clock,
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

// Calendar-month arithmetic that refuses to roll over: adding one month to
// 31/01 yields null rather than 03/03, because a MONTHLY rule means "the 31st"
// and a month without one simply has no occurrence (RFC 5545 §3.3.10).
export function addMonthsToClock(clock: WallClock, months: number): WallClock | null {
  const target = new Date(Date.UTC(clock.year, clock.month - 1 + months, 1));
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth() + 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (clock.day > daysInMonth) return null;
  return { ...clock, year, month };
}

/** 0 = Sunday … 6 = Saturday, for the calendar date the clock names. */
export function clockWeekday(clock: WallClock): number {
  return new Date(Date.UTC(clock.year, clock.month - 1, clock.day)).getUTCDay();
}

/** Ordering key — comparable because it deliberately ignores the zone. */
export function clockOrdinal(clock: WallClock): number {
  return Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second
  );
}
