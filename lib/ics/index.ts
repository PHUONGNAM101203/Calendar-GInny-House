// Turns a .ics file into rows ready for the custom_events table.
//
// Deliberately a one-shot import, not a subscription: nothing here records the
// source, so re-importing creates a second set of events rather than
// reconciling. That was the owner's choice — a syncing version needs a stored
// URL, a cron and a diffing pass, none of which exist.
import {
  APP_TIME_ZONE,
  addDaysToClock,
  icsMomentToUtc,
  parseIcsDateTime,
  wallClockToUtc,
  type IcsMoment,
  type WallClock,
} from "./datetime";
import { extractVevents, firstValue, unescapeText, unfoldLines } from "./parse";
import { expandRecurrence, parseRRule } from "./rrule";

/** Ready to insert into custom_events, minus calendar_id. */
export type ImportedEvent = {
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
};

export type IcsImportSummary = {
  events: ImportedEvent[];
  /** VEVENTs dropped because they had no usable DTSTART. */
  skipped: number;
  /**
   * VEVENTs carrying a RRULE this parser does not implement. They are still
   * imported, as the single occurrence at DTSTART — reporting the count lets
   * the UI say so instead of pretending the series came across.
   */
  unsupportedRecurrence: number;
  /** The 12-month horizon or a cap cut a series short. */
  truncated: boolean;
};

/** How far ahead recurring events are expanded — the owner's choice. */
export const RECURRENCE_HORIZON_MONTHS = 12;

/** Ceiling per series, and across a whole file, so one bad rule can't flood a calendar. */
const MAX_OCCURRENCES_PER_EVENT = 400;
export const MAX_IMPORTED_EVENTS = 2000;

const DEFAULT_TITLE = "Sự kiện không tên";
const TITLE_MAX_LENGTH = 120;

function horizonFrom(now: Date): Date {
  const end = new Date(now);
  end.setUTCMonth(end.getUTCMonth() + RECURRENCE_HORIZON_MONTHS);
  return end;
}

type EventShape = {
  title: string;
  start: IcsMoment;
  /** Timed events only — both ends share a zone, so a fixed gap is right. */
  durationMs: number;
  /** All-day events only: whole days spanned, counting the first. */
  dayCount: number;
};

function readDuration(
  start: IcsMoment,
  endRaw: { value: string; params: Record<string, string> } | null
): { durationMs: number; dayCount: number } {
  const startUtc = icsMomentToUtc(start);
  const end = endRaw ? parseIcsDateTime(endRaw.value, endRaw.params) : null;

  if (!end) {
    // RFC 5545 §3.6.1: a VEVENT with no DTEND lasts one day when date-only,
    // and is instantaneous otherwise.
    return { durationMs: 0, dayCount: 1 };
  }

  const endUtc = icsMomentToUtc(end);
  const durationMs = Math.max(0, endUtc.getTime() - startUtc.getTime());
  if (!start.dateOnly) return { durationMs, dayCount: 1 };

  // ICS all-day DTEND is EXCLUSIVE — 01/09→03/09 covers the 1st and 2nd.
  // custom_events stores an INCLUSIVE end midnight (createCustomEventAction
  // writes start_date === end_date for a one-day event), so the span loses a
  // day on the way in.
  return { durationMs, dayCount: Math.max(1, Math.round(durationMs / 86_400_000)) };
}

function toImportedEvent(shape: EventShape, occurrence: WallClock, zone: string): ImportedEvent {
  const startUtc = wallClockToUtc(occurrence, zone);

  if (shape.start.dateOnly) {
    const lastDay = addDaysToClock(occurrence, shape.dayCount - 1);
    return {
      title: shape.title,
      start_at: startUtc.toISOString(),
      end_at: wallClockToUtc(lastDay, zone).toISOString(),
      all_day: true,
    };
  }

  return {
    title: shape.title,
    start_at: startUtc.toISOString(),
    end_at: new Date(startUtc.getTime() + shape.durationMs).toISOString(),
    all_day: false,
  };
}

export function parseIcsCalendar(text: string, now: Date = new Date()): IcsImportSummary {
  const components = extractVevents(unfoldLines(text));
  const horizonEnd = horizonFrom(now);

  const events: ImportedEvent[] = [];
  let skipped = 0;
  let unsupportedRecurrence = 0;
  let truncated = false;

  for (const component of components) {
    if (events.length >= MAX_IMPORTED_EVENTS) {
      truncated = true;
      break;
    }

    const dtstart = firstValue(component, "DTSTART");
    const start = dtstart ? parseIcsDateTime(dtstart.value, dtstart.params) : null;
    if (!start) {
      skipped += 1;
      continue;
    }

    const summary = firstValue(component, "SUMMARY");
    const title =
      unescapeText(summary?.value ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, TITLE_MAX_LENGTH) || DEFAULT_TITLE;

    const dtend = firstValue(component, "DTEND");
    const { durationMs, dayCount } = readDuration(
      start,
      dtend ? { value: dtend.value, params: dtend.params } : null
    );
    const shape: EventShape = { title, start, durationMs, dayCount };

    const rruleProperty = firstValue(component, "RRULE");
    if (!rruleProperty) {
      events.push(toImportedEvent(shape, start.clock, start.zone));
      continue;
    }

    const rule = parseRRule(rruleProperty.value);
    if (!rule) {
      // Keep the first occurrence rather than dropping the event outright — a
      // meeting the parser cannot expand is still a real meeting.
      unsupportedRecurrence += 1;
      events.push(toImportedEvent(shape, start.clock, start.zone));
      continue;
    }

    // EXDATE is repeatable and each occurrence may list several comma-joined
    // dates, so both levels are flattened. Compared as instants rather than
    // clock readings because an exporter may write EXDATE in UTC while
    // DTSTART carries a TZID — matching the digits would then never fire.
    const excluded = new Set<number>();
    for (const property of component.get("EXDATE") ?? []) {
      for (const value of property.value.split(",")) {
        const moment = parseIcsDateTime(value, property.params);
        if (moment) excluded.add(icsMomentToUtc(moment).getTime());
      }
    }

    const expansion = expandRecurrence(start.clock, rule, {
      zone: start.zone,
      horizonEnd,
      cap: Math.min(MAX_OCCURRENCES_PER_EVENT, MAX_IMPORTED_EVENTS - events.length),
      excluded,
    });
    if (expansion.truncated) truncated = true;

    for (const occurrence of expansion.occurrences) {
      events.push(toImportedEvent(shape, occurrence, start.zone));
    }
  }

  return { events, skipped, unsupportedRecurrence, truncated };
}

export { APP_TIME_ZONE };
