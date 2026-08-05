// Every 15-minute mark in a day, as "HH:mm" (sortable, DB/URL-safe) values —
// backing both TimePickerField's dropdown and the "closest match" scroll
// target when it opens.
export const TIME_OPTIONS: string[] = Array.from({ length: 24 * 4 }, (_, i) => {
  const hours = Math.floor(i / 4);
  const minutes = (i % 4) * 15;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
});
