// iCalendar tokenising (RFC 5545 §3.1): line unfolding, property/parameter
// splitting, and pulling out the VEVENT components. Nothing here interprets
// dates or recurrence — that is ./datetime.ts and ./rrule.ts.

export type IcsProperty = {
  name: string;
  params: Record<string, string>;
  value: string;
};

/** Property name → every occurrence of it, in file order. */
export type IcsComponent = Map<string, IcsProperty[]>;

// RFC 5545 §3.1: a line beginning with a space or tab continues the previous
// one, and that leading whitespace character is not part of the value. Long
// SUMMARY and RRULE values are folded by every real exporter, so skipping this
// step truncates titles and breaks rules.
export function unfoldLines(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const unfolded: string[] = [];
  for (const line of raw) {
    if (unfolded.length > 0 && (line.startsWith(" ") || line.startsWith("\t"))) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

// Index of the first `needle` that is not inside a quoted parameter value.
// Needed because a parameter may legally contain the delimiter, as in
// TZID="(UTC+07:00) Bangkok, Hanoi": a naive indexOf(":") would cut there and
// leave a nonsense property name.
function indexOfUnquoted(text: string, needle: string): number {
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === needle) return i;
  }
  return -1;
}

function splitUnquoted(text: string, separator: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of text) {
    if (char === '"') {
      quoted = !quoted;
      current += char;
    } else if (!quoted && char === separator) {
      segments.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  segments.push(current);
  return segments;
}

function stripQuotes(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

export function parseProperty(line: string): IcsProperty | null {
  const colon = indexOfUnquoted(line, ":");
  if (colon < 0) return null;

  const [nameSegment, ...paramSegments] = splitUnquoted(line.slice(0, colon), ";");
  const name = nameSegment.trim().toUpperCase();
  if (!name) return null;

  const params: Record<string, string> = {};
  for (const segment of paramSegments) {
    const eq = segment.indexOf("=");
    if (eq > 0) {
      params[segment.slice(0, eq).trim().toUpperCase()] = stripQuotes(segment.slice(eq + 1).trim());
    }
  }

  return { name, params, value: line.slice(colon + 1) };
}

// RFC 5545 §3.3.11. Only TEXT-typed properties are escaped, so this is applied
// to SUMMARY and never to dates or rules.
export function unescapeText(value: string): string {
  return value.replace(/\\([nN;,\\])/g, (_, char: string) =>
    char === "n" || char === "N" ? "\n" : char
  );
}

// Every VEVENT in the file, each as a property map.
//
// Depth is tracked rather than matching BEGIN:VEVENT/END:VEVENT directly
// because a VEVENT commonly contains a nested VALARM, whose own properties
// (SUMMARY, DESCRIPTION, TRIGGER) would otherwise overwrite the event's. Only
// properties at the VEVENT's own level are collected.
export function extractVevents(lines: string[]): IcsComponent[] {
  const events: IcsComponent[] = [];
  let current: IcsComponent | null = null;
  let depth = 0;

  for (const line of lines) {
    const property = parseProperty(line);
    if (!property) continue;

    if (property.name === "BEGIN") {
      const component = property.value.trim().toUpperCase();
      if (component === "VEVENT" && current === null) {
        current = new Map();
        depth = 0;
      } else if (current !== null) {
        depth += 1;
      }
      continue;
    }

    if (property.name === "END") {
      const component = property.value.trim().toUpperCase();
      if (component === "VEVENT" && current !== null && depth === 0) {
        events.push(current);
        current = null;
      } else if (current !== null && depth > 0) {
        depth -= 1;
      }
      continue;
    }

    if (current !== null && depth === 0) {
      const existing = current.get(property.name);
      if (existing) existing.push(property);
      else current.set(property.name, [property]);
    }
  }

  return events;
}

export function firstValue(component: IcsComponent, name: string): IcsProperty | null {
  return component.get(name)?.[0] ?? null;
}
