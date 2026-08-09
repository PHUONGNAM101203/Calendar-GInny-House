// Pins the server's timezone to Vietnam so server-rendered times match what
// the browser renders.
//
// This app formats timestamptz values with date-fns `format()` in ~30 places
// (shift ranges, chấm công times, request cards). `format()` renders in the
// *runtime's* local timezone — so on Vercel, whose Node runtime is UTC, the
// server sent "12:00–15:00" while the browser (GMT+7) hydrated the same
// instant as "19:00–22:00". React saw the text change under it and threw
// hydration error #418 on every production page load. It never reproduced
// locally, because a dev machine in Vietnam runs the server and the browser
// in the same timezone.
//
// Setting TZ here rather than as a platform env var is not a preference:
// Vercel rejects TZ as a reserved variable name. `register()` runs once when
// a server instance starts and must finish before it serves any request
// (see node_modules/next/dist/docs/.../instrumentation.md), so every render
// happens with the timezone already pinned. Verified that Node applies a
// runtime change to process.env.TZ rather than caching the startup value.
//
// The business is Vietnam-only (see DESIGN.md / CLAUDE.md), so GMT+7 is the
// correct wall clock for every user — this also quietly fixes server-side
// "today" boundaries, which were previously computed at UTC midnight, i.e.
// 7am Vietnam time.
export function register() {
  process.env.TZ = "Asia/Ho_Chi_Minh";
}
