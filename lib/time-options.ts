// Every 15-minute mark in a day, as "HH:mm" (sortable, DB/URL-safe) values —
// backing both TimePickerField's dropdown and the "closest match" scroll
// target when it opens.
export const TIME_OPTIONS: string[] = Array.from({ length: 24 * 4 }, (_, i) => {
  const hours = Math.floor(i / 4);
  const minutes = (i % 4) * 15;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
});

// Parses a user-typed time into canonical "HH:mm", or null when the text
// cannot be read as a time. Deliberately permissive about separators and
// zero-padding — staff type "19:20", "1920", "19h20" and "9:5"
// interchangeably — but it never guesses: anything out of range returns null
// so the caller can reject it rather than silently storing a wrong time.
export function normalizeTimeInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // "19h20" / "19.20" / "19 20" all collapse to the "19:20" form.
  const unified = trimmed.toLowerCase().replace(/[hg.\s]+/g, ":");

  let hours: number;
  let minutes: number;

  if (unified.includes(":")) {
    const [rawHours, rawMinutes = "0"] = unified.split(":");
    hours = Number(rawHours === "" ? "0" : rawHours);
    minutes = Number(rawMinutes === "" ? "0" : rawMinutes);
  } else if (/^\d{3,4}$/.test(unified)) {
    // "1920" -> 19:20, "920" -> 9:20
    hours = Number(unified.slice(0, unified.length - 2));
    minutes = Number(unified.slice(-2));
  } else if (/^\d{1,2}$/.test(unified)) {
    // A bare hour: "19" -> 19:00
    hours = Number(unified);
    minutes = 0;
  } else {
    return null;
  }

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// Minutes since midnight, or null when unparseable. Used to find the nearest
// dropdown entry for a freely-typed time.
export function timeToMinutes(value: string): number | null {
  const normalized = normalizeTimeInput(value);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}
