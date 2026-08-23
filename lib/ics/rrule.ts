// RRULE parsing and expansion (RFC 5545 §3.3.10), scoped to what real
// calendar exports actually contain.
//
// Supported: FREQ (DAILY/WEEKLY/MONTHLY/YEARLY), INTERVAL, COUNT, UNTIL,
// BYDAY for weekly rules, BYMONTHDAY for monthly ones, plus EXDATE.
// Everything else in the grammar — BYSETPOS, BYWEEKNO, BYYEARDAY, ordinal
// BYDAY like "2MO", RDATE — is ignored rather than half-implemented, and the
// caller reports how many events that affected instead of silently importing a
// wrong series. Google and Outlook exports of ordinary weekly and monthly
// meetings stay inside the supported set.
//
// Expansion runs over WallClock values, never UTC instants — see the header of
// ./datetime.ts for why.
import {
  addDaysToClock,
  addMonthsToClock,
  clockOrdinal,
  clockWeekday,
  wallClockToUtc,
  type WallClock,
} from "./datetime";

// UNTIL is usually a UTC instant ("…Z") but may be a floating date-time or a
// bare date. The two cannot be compared the same way: reading the digits of a
// UTC value as if they were local time shifts the cut-off by the zone's whole
// offset — seven hours here — which silently drops or keeps a final
// occurrence. So the form is preserved and the comparison adapts.
export type RecurrenceUntil =
  | { kind: "instant"; at: Date }
  | { kind: "floating"; clock: WallClock };

export type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export type RecurrenceRule = {
  freq: RecurrenceFrequency;
  interval: number;
  count?: number;
  /** Inclusive upper bound. */
  until?: RecurrenceUntil;
  /** 0 = Sunday … 6 = Saturday. Weekly rules only. */
  byDay?: number[];
  /** Monthly rules only. Days a month does not have are skipped. */
  byMonthDay?: number[];
};

const WEEKDAY_CODES: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

const FREQUENCIES = new Set<string>(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);

function parseUntil(raw: string): RecurrenceUntil | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(raw.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second, utcFlag] = match;

  const clock: WallClock = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    // A date-only UNTIL bounds the whole day, not its midnight.
    hour: hour ? Number(hour) : 23,
    minute: minute ? Number(minute) : 59,
    second: second ? Number(second) : 59,
  };

  return utcFlag
    ? { kind: "instant", at: new Date(Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second)) }
    : { kind: "floating", clock };
}

export function parseRRule(value: string): RecurrenceRule | null {
  const parts: Record<string, string> = {};
  for (const segment of value.split(";")) {
    const eq = segment.indexOf("=");
    if (eq > 0) parts[segment.slice(0, eq).trim().toUpperCase()] = segment.slice(eq + 1).trim();
  }

  const freq = parts.FREQ?.toUpperCase();
  if (!freq || !FREQUENCIES.has(freq)) return null;

  // An INTERVAL of 0 would leave the loop below never advancing. Any
  // unparseable or non-positive value falls back to the RFC default of 1.
  const parsedInterval = Number(parts.INTERVAL);
  const interval =
    Number.isFinite(parsedInterval) && parsedInterval > 0 ? Math.floor(parsedInterval) : 1;

  const parsedCount = Number(parts.COUNT);
  const count = Number.isFinite(parsedCount) && parsedCount > 0 ? Math.floor(parsedCount) : undefined;

  const byDay = parts.BYDAY
    ? parts.BYDAY.split(",")
        // Strips an ordinal prefix ("2MO") and keeps the weekday. The ordinal
        // itself is not honoured — stated in the header.
        .map((token) => WEEKDAY_CODES[token.trim().toUpperCase().replace(/^[+-]?\d+/, "")])
        .filter((day): day is number => day !== undefined)
    : undefined;

  const byMonthDay = parts.BYMONTHDAY
    ? parts.BYMONTHDAY.split(",")
        .map((token) => Number(token.trim()))
        // Negative days ("-1" = last day of the month) are unsupported;
        // dropping them beats importing the wrong date.
        .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31)
    : undefined;

  return {
    freq: freq as RecurrenceFrequency,
    interval,
    count,
    until: parts.UNTIL ? (parseUntil(parts.UNTIL) ?? undefined) : undefined,
    byDay: byDay?.length ? byDay : undefined,
    byMonthDay: byMonthDay?.length ? byMonthDay : undefined,
  };
}

export type ExpansionOptions = {
  /**
   * Zone the WallClock values belong to. Needed because UNTIL and EXDATE are
   * frequently expressed in UTC while DTSTART carries a TZID, so the two can
   * only be compared as instants.
   */
  zone: string;
  /** Occurrences starting after this instant are dropped. */
  horizonEnd: Date;
  /** Hard ceiling on emitted occurrences. */
  cap: number;
  /** EXDATE values as epoch milliseconds. */
  excluded: Set<number>;
};

export type ExpansionResult = {
  occurrences: WallClock[];
  /** The horizon or the cap stopped expansion before the rule ran out. */
  truncated: boolean;
};

// One "cycle" of the rule — the dates generated by a single step of
// FREQ×INTERVAL. Weekly rules with BYDAY produce several dates per cycle; the
// others produce one, or none when the target day does not exist that month.
function cycleDates(start: WallClock, rule: RecurrenceRule, step: number): WallClock[] {
  switch (rule.freq) {
    case "DAILY":
      return [addDaysToClock(start, step * rule.interval)];

    case "WEEKLY": {
      const weekStart = addDaysToClock(start, -clockWeekday(start) + step * rule.interval * 7);
      const days = rule.byDay ?? [clockWeekday(start)];
      return days.map((weekday) => addDaysToClock(weekStart, weekday));
    }

    case "MONTHLY": {
      const base = addMonthsToClock(start, step * rule.interval);
      if (!base) return [];
      if (!rule.byMonthDay) return [base];
      return rule.byMonthDay
        .map((day) => addMonthsToClock({ ...start, day }, step * rule.interval))
        .filter((clock): clock is WallClock => clock !== null);
    }

    case "YEARLY": {
      const base = addMonthsToClock(start, step * rule.interval * 12);
      return base ? [base] : [];
    }
  }
}

// Bounds the loop when a rule generates nothing usable — an unsatisfiable
// BYMONTHDAY, say — so it terminates instead of spinning up to the cap.
const MAX_EMPTY_CYCLES = 400;

export function expandRecurrence(
  start: WallClock,
  rule: RecurrenceRule,
  options: ExpansionOptions
): ExpansionResult {
  const startOrdinal = clockOrdinal(start);
  const horizonMs = options.horizonEnd.getTime();
  // A floating UNTIL shares the event's zone, so it can stay a clock
  // comparison; a UTC one must be compared as an instant.
  const untilOrdinal =
    rule.until?.kind === "floating" ? clockOrdinal(rule.until.clock) : null;
  const untilMs = rule.until?.kind === "instant" ? rule.until.at.getTime() : null;

  const occurrences: WallClock[] = [];
  // Counts toward COUNT, which per the RFC includes dates later removed by
  // EXDATE — so this is deliberately not occurrences.length.
  let emitted = 0;
  let step = 0;
  let emptyCycles = 0;

  while (emptyCycles < MAX_EMPTY_CYCLES) {
    const candidates = cycleDates(start, rule, step).sort(
      (a, b) => clockOrdinal(a) - clockOrdinal(b)
    );
    step += 1;

    let usedThisCycle = 0;
    for (const candidate of candidates) {
      const ordinal = clockOrdinal(candidate);
      // A weekly cycle is generated from the start of its week, so the first
      // cycle can contain dates that precede DTSTART.
      if (ordinal < startOrdinal) continue;
      if (untilOrdinal !== null && ordinal > untilOrdinal) return { occurrences, truncated: false };

      const at = wallClockToUtc(candidate, options.zone).getTime();
      if (untilMs !== null && at > untilMs) return { occurrences, truncated: false };
      if (at > horizonMs) return { occurrences, truncated: true };

      usedThisCycle += 1;
      emitted += 1;
      if (!options.excluded.has(at)) occurrences.push(candidate);
      if (rule.count !== undefined && emitted >= rule.count) {
        return { occurrences, truncated: false };
      }
      if (occurrences.length >= options.cap) return { occurrences, truncated: true };
    }

    emptyCycles = usedThisCycle > 0 ? 0 : emptyCycles + 1;
  }

  return { occurrences, truncated: false };
}
