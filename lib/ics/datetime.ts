// Date/time handling for ICS import (RFC 5545 §3.3.4-3.3.5).
//
// Everything here works in *wall-clock* terms — a calendar day and a clock
// reading in a named zone — and only converts to a UTC instant at the very
// end. That ordering matters for recurrence: "every Monday at 08:00" is a
// statement about the clock on the wall, so expanding it by adding 7×24h to a
// UTC instant silently drifts by an hour across a DST boundary in any zone
// that has one. lib/ics/rrule.ts therefore expands over WallClock values and
// calls wallClockToUtc() once per occurrence.
//
// The zone primitives live in lib/timezone.ts because they are not
// ICS-specific — actions/custom-calendars.ts needs the same conversion for
// hand-entered events. They are re-exported here so this module stays the one
// import site for everything under lib/ics/.
import {
  APP_TIME_ZONE,
  isValidTimeZone,
  wallClockToUtc,
  type WallClock,
} from "@/lib/timezone";

export { APP_TIME_ZONE, isValidTimeZone, wallClockToUtc };
export type { WallClock };

export type IcsMoment = {
  clock: WallClock;
  /** IANA zone the clock reading belongs to. */
  zone: string;
  /** DTSTART;VALUE=DATE — a whole calendar day, not an instant. */
  dateOnly: boolean;
};

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
