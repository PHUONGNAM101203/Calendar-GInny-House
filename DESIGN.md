# Ginny House — Design System

This documents the visual identity applied to the staff scheduling app, so
future work (including the calendar UI template the team will provide)
reuses the same tokens instead of re-deriving them. Update this file
whenever a token, font, or component pattern changes — it should stay the
single source of truth for "what does on-brand look like here."

## Brand brief

**Ginny House** is an English-language center. The app is mainly an internal
staff tool (shift scheduling + shift swaps across 3 branches), so most of the
design investment goes into a coherent, calm, trustworthy "back office" feel.
The one exception is `/`, a public landing page for logged-out visitors.

Since 2026-08 the visual identity is governed by **`brand-guideline.html` v1.0**
(Mina/CMO, 2026-07), which lives outside this repo. Where this document and
the guideline disagree, **the guideline wins** — and this document is wrong and
should be corrected.

The guideline closes with a three-question **Brand Test** that any published
surface has to pass. Worth keeping in view when building UI, not just posters:

1. Recognisably Ginny House at a glance — white ground, Vivid Blue leading,
   red only as a small accent, 60/25/10/5, Barlow.
2. Kind and truthful — no fear-marketing, no invented promises or numbers.
3. Warm and encouraging — never cold or transactional.

Point 2 has teeth for product work too: **do not invent metrics** for a UI
mock. A number-shaped hole is honest; a fabricated number is not.

## Logo

> ⚠️ **Unresolved: the logo is still the retired navy.** Sampling
> `public/brand/icon-navy.png` gives a dominant ink of `rgb(15, 67, 115)` /
> `#0F4373` — the exact colour §8 of the guideline retires by name. So
> `BrandMark` currently renders old-brand artwork beside new Vivid Blue UI, in
> the header, the auth screen, the favicon and the landing page.
>
> This was **not** fixed unilaterally. The guideline has no logo section, so
> whether the mark should be re-issued in `#022B9D` is a brand decision for the
> CMO, not an implementation detail. Mechanically it is trivial — the same
> recolour recipe used for the white variant (below) would do it — but the call
> is not ours. **Ask before shipping brand collateral.**

The **official** logo file lives at `public/LOGO-01.png` (full lockup: icon
+ "Ginny House" wordmark). It is the source of the cropped assets below.

Note it is no longer the source of the *palette*: `--primary` used to be
sampled from this file, and now comes from the guideline instead.

Three cropped assets were extracted from it (see the "Logo asset pipeline"
note at the bottom of this file for how, in case it needs to be redone with
a newer export):

| File | What | Used for |
|---|---|---|
| `public/brand/icon-navy.png` | Icon only, transparent bg, original navy strokes | Header logo (`AppHeader.tsx`), general navy-on-light use |
| `public/brand/icon-white.png` | Same icon, strokes recolored solid white, alpha preserved | Auth screen (navy background) — logo mark + the oversized low-opacity watermark |
| `public/brand/icon-square.png` | Navy icon centered on a transparent square canvas, 512×512 | Source for `app/icon.png` (favicon) |

`components/brand/BrandMark.tsx` wraps these as a `next/image` with a
`variant` prop:

```tsx
<BrandMark className="size-6" />                 {/* navy, default */}
<BrandMark variant="white" className="size-10" /> {/* white, for dark/navy backgrounds */}
```

`className` sizes the wrapping box (`size-*`, or an absolute-position +
`size-[28rem]` for the watermark treatment); the image fills it with
`object-contain`, so aspect ratio is always preserved.

Used at three scales:
- **Header** (`components/layout/AppHeader.tsx`): 24px, next to the "Ginny House" wordmark (set in Barlow ExtraBold, not the logo's own lettering — see Typography).
- **Auth screen** (`app/(auth)/layout.tsx`): 40px white mark above the wordmark; also used oversized (28rem / 24rem) at 6% opacity, twice, as a background watermark for texture.
- **Favicon** (`app/icon.png`, Next's file-based favicon convention): the square navy crop.

We do **not** use the logo's own wordmark lettering anywhere in the UI —
headings are set in Barlow (see Typography) so the type system stays
consistent across the whole app rather than mixing the logo's specific
font with the UI's. If that's ever wanted for a specific marketing surface,
crop the wordmark region of `LOGO-01.png` the same way the icon was cropped.

### Logo asset pipeline (for regenerating if a new export arrives)

The current assets were produced with Python/Pillow: find the tight bounding
box of non-white, non-transparent pixels (there's a clean blank-row gap in
`LOGO-01.png` between the icon and the wordmark, y≈1524–1812 at the
source's native 2482×2245 resolution, which is what separates the two crops),
crop the icon region with a small padding, then for the white variant set
RGB to `255,255,255` on every pixel with `alpha > 0` while keeping alpha
untouched. Re-run the same recipe if `LOGO-01.png` is replaced with a higher-res
or re-exported file.

## Color

**Source of truth: `brand-guideline.html` v1.0** (Mina/CMO, 2026-07). The app
no longer derives its palette from the logo — the guideline supersedes it.

> **Superseded 2026-08.** The previous system anchored on navy `#0F4373`,
> sampled from `public/LOGO-01.png`, with all neutrals tinted at hue 251.
> §8 of the guideline retires that navy **by name** ("Navy cũ #144372 — màu
> nhận diện đời trước, đã thay bằng Vivid Blue #022B9D. Không trộn 2 xanh").
> This was a replacement, not a tint adjustment.

Values are stored as the guideline's own **hex**, not converted to OKLCH. That
is a deliberate reversal of the previous convention: the brand ships a
hand-tuned 9-step ramp per hue, so there is nothing left to interpolate, and
every conversion would only introduce rounding drift away from the spec.

### Ramps

Three ramps, 9 steps each, in `:root` — `--blue-100…900`, `--red-100…900`,
`--yellow-100…900`. Components should use the semantic layer below, not the
ramps directly; the ramps exist so semantic tokens have somewhere honest to
point.

### Semantic layer

| Name | Token | Light | Usage |
|---|---|---|---|
| **Vivid Blue** | `--primary` | `#022B9D` (blue-700) | Brand lead — links, active nav, your own shifts, CS1, wordmark |
| **CTA Red** | `--destructive` | `#D90513` (red-600) | Primary call-to-action, errors, destructive actions |
| — | `--destructive-strong` | `#B4040F` (red-700) | Red **text on a red tint** only; see contrast note below |
| **Ink** | `--foreground` | `#0A1230` | Body text |
| **Muted** | `--muted-foreground` | `#5B6480` | Secondary text |
| **Surface** | `--background` / `--card` | `#FFFFFF` | Page and card ground |
| **Surface alt** | `--muted` | `#F4F6FB` | Section bands, sidebar |
| **Line** | `--border` | `#E6E9F2` | Hairlines |
| **Highlight** | `--gold` | `#F7AE47` (yellow-500) | Pending states, CS2 — **background only** |
| — | `--gold-foreground` | `#8F5B0D` (yellow-800) | Text on a yellow tint |
| **Success** | `--success` | `#167A3B` | Approved states, positive confirmation |
| **Warning** | `--warning` | `#955700` | Cautionary states |

### Rules the guideline enforces (§8)

- **Red is an accent, never a ground.** Capped near 10% of any surface. A
  full-bleed red panel is explicitly rejected — it reads as tension, wrong for
  a school. This is why the landing page's closing CTA panel is blue and only
  its button is red, and why `--primary` was *not* wired to red even though
  the guideline calls the primary button red: `--primary` also paints every
  one of your own shifts on the calendar, and flipping it would blow the cap
  on the densest screen in the app. The red CTA lives in the `cta` Button
  variant instead.
- **Yellow is seasoning, not a ground, and never text on white.** `#F7AE47`
  on white measures 1.9:1. Yellow text must be `#C07A12` (yellow-700) or
  darker.
- **No hue outside the system.** No purple, pink, or neon green. This is what
  retired the old teal/plum/cyan person-colour set.
- **Ratio to hold:** 60 white / 25 blue / 10 red / 5 yellow.

### Contrast

The guideline ships its own WCAG 2.2 table (body ≥4.5:1, large/non-text ≥3:1).
Measured for the tinted `Badge` variants against their own 10–15% tints:

| Variant | Tint | Text | Ratio |
|---|---|---|---|
| `gold` | `#FEF3E3` | `#8F5B0D` | 5.21 ✓ |
| `success` | `#E3EFE8` | `#167A3B` | 4.58 ✓ |
| `destructive` | `#FBE6E7` | `#D90513` | **4.41 ✗** |

That last one is why `--destructive-strong` exists: red-600 as text on its own
tint fails the floor, so tinted surfaces step down to red-700 (5.93:1). Solid
red buttons are unaffected — white on red-600 is fine.

### Branch and per-person colours

`--chart-1…6` feed both the 3 branch colours (`branches.color_token` seed in
`supabase/migrations/0001_init.sql`) and the per-person calendar palette.
Branches map cleanly: **CS1 = Vivid Blue, CS2 = Highlight yellow, CS3 = CTA red**
(as a 6px bar only — well inside the red cap).

**Known weakness, unresolved.** The per-person palette used to be five
well-separated hues (teal, plum, amber, gold, cyan). §8 forbids hues outside
the system, so it now draws from three ramps spread across lightness instead
(`blue-700 / blue-400 / blue-300 / yellow-600 / yellow-800 / red-500`). These
sit measurably closer together, and telling two coworkers apart at a glance is
harder than it was. There is no fix that satisfies both the guideline and the
old legibility — resolving it needs a brand decision (an approved pair of
auxiliary hues), not a code change.

### Dark mode

**Dark mode is an extension beyond the guideline, not part of it.** The
guideline is light-only and §8 rejects a dark dominant ground ("GH là brand
trắng-sáng"). It is kept because the app already shipped a theme toggle and
evening-shift staff use it. Values pull from the same three ramps, with
`--primary` stepping up to blue-400 (blue-700 is unreadable on a dark ground).
One value could not come from any ramp: dark-mode `--success` is a lightened
`#4FB477`, because the guideline has no green scale and `#167A3B` sinks to
about 2:1 against `#0A1230`. It is marked as derived at the point of use.

## Typography

**One family: [Barlow](https://fonts.google.com/specimen/Barlow).** The
guideline is explicit — *"Một họ chữ duy nhất… Không trộn font thứ hai."*
Hierarchy is carried entirely by weight, never by a second typeface.

> **Superseded 2026-08.** The previous system paired Fraunces (display serif)
> with Be Vietnam Pro (body) and reserved JetBrains Mono for data. All three
> are gone.

The **`vietnamese` subset is non-negotiable** and was verified against
next/font's own metadata before the switch (`['latin','latin-ext','vietnamese']`).
This is the same trap that disqualified Geist originally: without it, every
precomposed diacritic (`ệ ủ ằ ẩ`) silently falls back to a system face.

### Scale

| Role | Size / weight | Notes |
|---|---|---|
| Display | 52px / 900 | ls −0.025em, lh 1.0 |
| H1 | 38px / 800 | ls −0.015em, lh 1.05 |
| H2 | 29px / 800 | lh 1.12 |
| H3 | 22px / 700 | lh 1.25 |
| Lead | 19px / 500 | lh 1.5 |
| Body | 16px / 400 | lh 1.6 |
| Label | 13px / 700 | ls +0.01em |
| Caption | 12px / 600 | |
| Overline | 11px / 800 | +0.2em, uppercase |

Weights loaded: 400, 500, 600, 700, 800, 900. The guideline lists nine; the
four unused light weights are omitted because next/font fetches one static
file per weight and they would be dead payload.

### There is no mono font — on purpose

`--font-mono` is **not defined**, and no monospace family is loaded. Anything
that previously reached for `font-mono` now uses one of two replacements
depending on which job it was actually doing:

- **Aligning columns of numbers** → `tabular-nums`. Barlow's tabular figures
  line up without paying for a second font download. `RealtimeClock` set this
  precedent deliberately.
- **The "technical label" look** → Barlow at 800 with tracking and uppercase,
  which is precisely the Overline role above.

> **Fixed 2026-08.** For a period, `--font-mono` was referenced in 17 places
> across 7 files while being defined nowhere — so those labels rendered in
> whatever mono the OS supplied (SF Mono on macOS, Consolas on Windows,
> Courier elsewhere), differing per device and belonging to no design system.
> Do not reintroduce `font-mono` without also loading a mono family and
> getting it approved: the guideline forbids a second face.

Font loading is in `app/layout.tsx` via `next/font/google`; the mapping to the
Tailwind-facing `--font-sans` / `--font-heading` tokens happens in
`app/globals.css`'s `@theme inline` block, where **both now point at the same
family**. Change the mapping there, never per-component.

## Layout & components

- **Radius**: the guideline's four rungs — **8 / 14 / 20 / 28px** (`--radius-sm/md/lg/xl`), plus a pill for fully-rounded controls. `--radius` is the md rung (14px), which is what shadcn primitives inherit. These are set **literally** rather than derived by multiplier: the old `calc(var(--radius) * n)` ladder could not land on all four rungs from a single base without drifting a pixel or two off each. `2xl`–`4xl` keep climbing for oversized panels.
- **Motion**: `--dur-fast` 120ms · `--dur-base` 200ms · `--dur-slow` 320ms, with `--ease-out` `cubic-bezier(.22,.61,.36,1)` and `--ease-pop` `cubic-bezier(.34,1.56,.64,1)`. **Nothing exceeds 320ms** — that is a guideline rule, not a preference. `ease-pop` overshoots and is reserved for *buttons only*; content and colour transitions use `ease-out`. Every animation collapses under `prefers-reduced-motion: reduce`.
- **Elevation**: cards on a colored/navy background (auth screen) get `shadow-2xl shadow-black/20` for real lift; cards on the parchment background rely on the existing `ring-1 ring-foreground/10` from the shadcn primitives, which is enough contrast there.
- **Role badges**: `Badge variant="gold"` for Quản lý (manager), `variant="secondary"` for Nhân viên (employee) — see `AppHeader.tsx` and `StaffTable.tsx`.
- **Status badges — soft-tint, not solid fill** (2026-08 pass): `gold` and `success` badge variants moved from a full-saturation background (`bg-gold`/`bg-success`) to a low-opacity tint (`bg-gold/15` light · `/20` dark, `bg-success/12` light · `/18` dark) with the accent as the text color instead of white-on-color. Same convention `destructive` already used (`bg-destructive/10 text-destructive`) — the fix made the other two match it instead of the other way around. Solid pill badges read as a dated Bootstrap-era pattern; the soft-tint + colored-text pairing is what current SaaS UI (GitHub, Linear, Vercel) uses for status pills, and it's calmer on a page with several badges in view at once. Applies everywhere `Badge` is used: role badges, swap/leave/shift-request status pills, notification dots.
- **Status badge mapping**: `pending` → `gold`, `accepted`/`approved` → `success`, `rejected`/`cancelled` → `outline`. See `SWAP_STATUS_LABELS`/`LEAVE_STATUS_LABELS`/`SHIFT_REQUEST_STATUS_LABELS` in `lib/constants.ts` and the mapping in `SwapRequestCard.tsx`/`LeaveRequestCard.tsx`/`ShiftRequestCard.tsx`. Pending cards also get a `border-l-gold` left accent.
- **Active nav state**: `AppHeader` is a client component using `usePathname()` so the current section (`Lịch` / `Đổi ca` / `Quản lý`) gets a `bg-accent` highlight instead of relying on hover alone.
- **Calendar (react-big-calendar), Google Calendar-inspired shell**: the calendar page follows Google Calendar's structural pattern — a fixed-width left sidebar (`CalendarSidebar.tsx`, `hidden lg:flex w-64`) with a manager-only "Tạo ca làm việc" primary button, a hand-rolled mini month picker (no extra date-picker dependency — built from `date-fns` in the same file), and a color legend; on screens below `lg`, the sidebar collapses into `CalendarMobileMenu.tsx`, a `Popover`-based trigger rendered above the toolbar instead of a full drawer. The toolbar (`CalendarToolbar.tsx`) uses fully rounded (`rounded-full`) pill buttons for Today/prev/next and the month/week/day/agenda switcher, mirroring Google's pill toolbar, with the current range label set in `font-heading`.
  - **Per-person color, not per-branch**: each coworker gets a stable color pulled from a 5-hue palette (`--chart-3` teal, `--chart-4` plum, `--chart-5` amber, `--gold`, `--chart-6` cyan — deliberately excluding `--chart-1`/navy since that's reserved for "mine") via a deterministic string hash, `getPersonColorVar()` in `lib/calendar.ts`. This is the Google Calendar mental model of "one color per calendar" reinterpreted as "one color per person," which reads far better than a single flat grey once more than one coworker's shifts are visible on the same view. Your own shifts always render solid `--primary` navy regardless of hash, so they never accidentally match a coworker's color.
  - The per-person color reaches the DOM via an inline CSS custom property (`style={{ "--event-color": "var(--chart-4)" }}` set in `eventPropGetter`), which `globals.css`'s `.shift-event--other` rule consumes through `color-mix(in oklch, var(--event-color, var(--chart-3)) 16%, var(--card))` for a soft tinted chip in month/agenda view, and a stronger 30% mix in day/week's `.rbc-day-slot` for legibility on white. This indirection (CSS var, not inline `backgroundColor`) is what keeps dark mode correct for free — the same class works in both themes.
  - "Today" no longer gets a background tint (2026-08: removed, including overriding RBC's own built-in `.rbc-today` default — matches Google Calendar, which doesn't wash the whole day column either). The current-time indicator (red line + dot, `.rbc-current-time-indicator`) is the only "today" marker now. Pending-swap events still keep their dashed gold outline layered on top of whichever person-color chip they already have.
  - `--chart-6` (`oklch(0.58 0.1 200)` light / `oklch(0.64 0.1 200)` dark, a cyan) was added specifically to round the person palette out to 5 well-separated hues — if you need a 6th person color, extend `PERSON_COLOR_VARS` in `lib/calendar.ts` and add one more `--chart-N` pair here rather than reusing `--chart-1`.
  - **Client-only, never SSR'd**: `react-big-calendar` touches the DOM directly and its CJS entry doesn't survive being evaluated against the server's React instance during a cold Turbopack compile — that mismatch was the actual cause of a recurring `TypeError: Cannot read properties of null (reading 'useMemo')` crash on `/calendar`'s first request each dev-server restart (confirmed via the dev server log: the error was thrown server-side, inside SSR, not in the browser). Fixed by never letting the server render it at all: `app/(app)/calendar/page.tsx` (a Server Component) renders `ShiftCalendarLoader` (`"use client"`), which loads the real `ShiftCalendar` through `next/dynamic(..., { ssr: false })` with a `Skeleton`-based loading state. `next/dynamic`'s `ssr: false` option only works from a Client Component — that's why the loader wrapper exists instead of calling `dynamic()` straight from the page. `next.config.ts`'s `serverExternalPackages: ["react-big-calendar"]` is still required on top of this — removing it reintroduces a *different*, build-time version of the same class of bug (`Super expression must either be null or a function`) because Next's page-data collection step still statically walks into the dynamic-import target even when it will never execute server-side.

## Routes

All app routes are English slugs (renamed from an earlier Vietnamese-slug
pass): `/login`, `/register`, `/calendar`, `/swaps`, `/manager`, `/attendance`,
`/account`. `/` redirects to `/calendar` (authenticated) or `/login` (not).
The calendar's URL state uses English query params too:
`?date=2026-08-01&view=week`. Route protection and the public/private
redirect rules live in `lib/supabase/proxy.ts` (`PUBLIC_PATHS`) — any
authenticated-only route just needs to *not* be in that list, no per-route
wiring required, which is why `/attendance` and `/account` needed zero
proxy changes. UI copy (labels, headings, toasts) stays in Vietnamese — only
the URL structure and code-facing names changed.

## Navigation: calendar icon, apps launcher, clock, avatar menu

Three tiers, each answering a different question:
- **Calendar link**: no longer a text nav item — condensed into a
  `CalendarDaysIcon` ghost button (`AppHeader.tsx`) grouped in the same
  bordered pill as the apps launcher, right after direct feedback that a
  separate "Lịch" text tab read as redundant next to a header whose logo
  already links to `/calendar`. The pill (`rounded-full border p-0.5`
  wrapping both icon buttons) is what visually says "these two icons are
  one cluster of navigation," not just incidental proximity.
- **Apps launcher** (`AppLauncher.tsx`, the grid icon, same interaction
  pattern as Google's app-switcher waffle): `Chấm công`, `Xin nghỉ phép`,
  `Xin đổi ca` — features someone dips into for a specific task, then
  leaves. Framed as "apps within the app" rather than nav tabs on purpose,
  per direct instruction — these are occasional actions, not a place to
  live. Naming is deliberately verb-first ("Xin ...") to match: they're
  requests a person *makes*, not sections they browse, which is also why
  `/swaps`'s own page heading was renamed from "Đổi ca" to "Xin đổi ca" to
  match the launcher tile it's opened from.
- **Avatar menu** (`UserMenu.tsx`): trigger widened from a bare avatar
  circle to avatar + given name + chevron (`Huỳnh Lê Phương Nam` → shows
  "Nam", the last word — Vietnamese names are addressed by the given name,
  not the family name, so showing the full string would both overflow the
  header and address the person by the wrong part of their own name).
  Holds `Cập nhật thông tin` (both roles) and `Quản lý` (manager only) —
  account-level, opened rarely.

The role `Badge` ("Quản lý" gold / "Nhân viên" grey) used to sit loose in
the header bar — direct feedback called it visual clutter that "made the
interface feel crowded" for information that isn't acted on from the
header itself. Moved inside the avatar dropdown's `DropdownMenuLabel`,
on the same row as the full name — a first pass stacked the badge under
the name instead, which read as more awkward than the original clutter, so
it moved back beside the name per follow-up feedback. What actually fixed
the earlier overflow/clipping wasn't the stacking, it was two things done
together: `DropdownMenuContent` pinned to `w-64` (its default width tracks
the trigger's width, and the trigger is short) and the name span given
`min-w-0 truncate` so an unusually long full name ellipsizes instead of
pushing the badge (`shrink-0`) out of the visible area.

The manager-only nav item in this menu also reads "Dashboard" now, not
"Quản lý" — the label is specifically for the link to `/manager`'s
Tổng quan tab, and "Dashboard" names the destination more precisely than
the role name did (the manager page is more than a dashboard, but the
link's whole job is "go look at your numbers"). The page itself, its H1,
and the `/manager` route slug are unchanged — only this one menu item's
copy changed.

If a 4th "app" is ever needed, add it to the `APPS` array in
`AppLauncher.tsx`; the grid layout (`grid-cols-3`) already accepts more
tiles without a redesign.

## Realtime clock

`RealtimeClock.tsx`, next to the apps launcher pill: ticks every second via
`setInterval` + `Intl.DateTimeFormat` pinned to `timeZone: "Asia/Ho_Chi_Minh"`
— hardcoded, not derived from the visitor's browser timezone, because the
whole point is "what time is it at the branch right now" for a Vietnam-only
business, not the viewer's local time. Two-line layout (time on top,
"ASIA/HCM · GMT+7" caption below in small uppercase) rather than a single
inline string, so the timezone is legible without needing the `title`
tooltip. Uses `tabular-nums` instead of loading a monospace font — the
digits still align on every tick without paying the font-payload cost that
this doc's Typography section's font-trimming pass deliberately avoided. Hidden below `sm` to
keep the mobile header from getting crowded. Seeds its initial state from a
lazy `useState(() => formatter.format(new Date()))` rather than `null` +
setting it inside a `useEffect` body — the latter is exactly the pattern
ESLint's `react-hooks/set-state-in-effect` flags (same fix already applied
once before, in `ClockWidget.tsx`'s elapsed-time ticker).

**Fixed: hydration mismatch.** That same lazy initializer runs on both the
server render and the client's first render, and a live clock's whole
premise is that those two moments are milliseconds apart — occasionally
landing on opposite sides of a second boundary, which React reports as a
hydration mismatch (`Text content does not match server-rendered HTML`).
The fix is `<span suppressHydrationWarning>{time}</span>` wrapping just the
digits (not the icon, not the container) — this is React's own documented
escape hatch for content that's *supposed* to differ between server and
client render (their docs use a clock as the canonical example), not a
workaround for an actual bug. Don't "fix" this by removing
`suppressHydrationWarning` — the mismatch is inherent to what the
component does, and removing it just brings the console error back on an
unpredictable ~1-in-however-many-loads cadence.

## Chấm công (attendance / clock in-out)

- **Schema** (`supabase/migrations/0003_attendance.sql`): one `attendance`
  row per clock-in, `check_out_at` null while the person is still "in".
  A partial unique index (`attendance_one_open_per_profile`, `where
  check_out_at is null`) is what actually prevents double clock-ins — not
  application logic — so it holds even under concurrent requests. All
  writes go through two SECURITY DEFINER RPCs, `clock_in()`/`clock_out()`,
  which raise a clear Vietnamese-mappable error (`mapAttendanceError` in
  `actions/attendance.ts`) instead of leaking a Postgres constraint name to
  the toast.
- **RLS is deliberately wider than shifts**: `attendance_select_branch`
  lets a manager read every branch's attendance (`public.is_manager()`,
  no branch match required), not just their own — mirrors the same
  reasoning as the `profiles` SELECT widening in migration `0002` (a
  manager filling in the dashboard's "toàn hệ thống" stat needs to see
  everyone, not just their own branch's roster).
- **UI**: `ClockWidget.tsx` (own status + one-button toggle, on `/attendance`)
  and `AttendanceHistory.tsx` (own last 30 records) are personal-scoped by
  design — the cross-branch, "who's clocked in right now" aggregate view
  lives on the manager dashboard instead (`ManagerDashboard.tsx`'s "Đang
  trong ca" card), so the same data isn't rendered twice with two different
  scopes on two different pages.

## Manager dashboard

`/manager`'s first tab (`ManagerDashboard.tsx`, tab value `dashboard`,
default-selected) is stat cards, not a table: tổng nhân viên (+ chưa gán
cơ sở as the hint line, not a separate card — it's a qualifier on the same
number, not an independent metric), ca hôm nay, chờ đổi ca, đang chấm công.
Ca hôm nay / chờ đổi ca are scoped to the manager's own branch (same RLS as
everywhere else); đang chấm công is system-wide (see attendance RLS above)
— the card's hint line says which, explicitly, since silently mixing
branch-scoped and system-wide numbers in one grid would read as
inconsistent once someone actually manages a multi-branch business. The
`StatCard` component takes an icon + label + value + optional hint rather
than being hardcoded per-metric, so a fifth metric is a one-line addition
in `ManagerDashboard.tsx`, not a new component. It now shows five: the
attendance four plus "Chờ duyệt nghỉ" from the leave-request feature below.

## Xin nghỉ phép (leave requests)

Schema/RPCs in `supabase/migrations/0004_leave_requests.sql`, structurally
the same shape as shift swaps (`request_leave` / `respond_to_leave_request`
/ `cancel_leave_request`, all SECURITY DEFINER, all writes gated through
them) — but the SELECT policy is deliberately **not** copied from shifts.
`leave_select_own_or_manager` is `profile_id = auth.uid() or (is_manager()
and branch_id = current_branch_id())`: an employee only ever sees their own
leave requests, full stop, not "everyone in my branch" the way shifts/swaps
are visible to coworkers. A shift being swappable is inherently a
between-coworkers thing; a reason for requesting leave is personal, so
coworker-visibility here would have been a privacy regression copied in by
habit rather than a deliberate choice. `/leave`'s page structure mirrors
`/swaps` (chờ duyệt / đơn của tôi / lịch sử cơ sở, manager-only for the
first and third sections) for the same reason: don't reinvent a layout
users already learned on the swap-request page for what is, structurally,
the same kind of two-party-approval flow.

## Fixed: branch assignment silently not saving

Root cause, found by making the failure loud instead of guessing again:
`updateStaffBranchAction` (`actions/staff.ts`) called `.update().eq(...)`
with no `.select()` — Supabase-js reports **no error** when RLS silently
matches zero rows, it just updates nothing. So when migration `0002`'s
`profiles_update_manager` policy hadn't actually been applied yet, the
action still returned `{ ok: true }`, the UI showed a "saved" toast, and
the value reverted to "Chưa gán" on next load — the exact same shape of
bug as the earlier role-not-saving issue, and for the same underlying
reason (a policy/trigger change the UI has no way to detect from the
client side). Fixed at the code level regardless of DB state: the action
now does `.select("id, branch_id").maybeSingle()` and treats "no row came
back" as an explicit error, so a missing migration now surfaces as a real
toast ("Không có quyền cập nhật cơ sở...") instead of a false success.
Separately, migration `0002` itself was missing a `drop policy if exists`
before creating `profiles_update_manager` — re-running it (e.g. after
pasting `0001`–`0004` together to catch up) would have aborted the whole
script with "policy already exists," silently taking the trigger fix down
with it. Both `0002` and `0003` are now written to be safe to re-run any
number of times; `0004` was written idempotent from the start. **Lesson
for future migrations in this project: every `create policy`/`create
trigger` needs its `drop ... if exists` twin, and every action that writes
via `.update()`/`.insert()` under RLS should read the row back and treat
"nothing came back" as a failure — never trust a bare `{ error: null }`.**

## Role hierarchy (replaces the old employee/manager binary)

`profiles.role` is now an 8-value enum (`supabase/migrations/0005_role_hierarchy.sql`,
`public.staff_role`) instead of `employee`/`manager`: `ceo`, `coo`,
`training_director`, `hr`, `technical`, `teacher`, `collaborator`,
`customer_care` (Vietnamese labels in `lib/roles.ts`'s `ROLE_LABELS`).
Manager-tier access (shifts, swap/leave approval, staff & branch
assignment, dashboard) is granted by **title**, not a single flag —
`ceo`, `coo`, `training_director`, and `technical` have it; `hr`,
`teacher`, `collaborator`, `customer_care` don't. This was a deliberate,
explicit choice (confirmed directly, not defaulted): HR and the other four
front-line titles are scoped like any other employee — own schedule, own
swap/leave requests — while Kỹ thuật (Technical) sits with the directors
because it runs its own operational scheduling.

The manager-tier set lives in exactly two places and they must be kept in
sync: `is_manager()` in `0005_role_hierarchy.sql` (the actual RLS gate) and
`MANAGER_ROLES` in `lib/roles.ts` (`isManagerRole()`, used for UI-side
checks like which nav/redirects to show — never trusted as the real
security boundary, since RLS is the boundary). Every place in the app that
used to check `role === "manager"` now calls `isManagerRole(role)` instead;
grep for `isManagerRole` before adding a new one rather than re-checking a
role string directly.

`ROLE_HIERARCHY` in `lib/roles.ts` is the canonical top-to-bottom order —
`StaffTable.tsx`'s role `<Select>` renders it in that order specifically so
promoting/demoting someone in the dropdown reads as moving up/down a real
ladder, not an alphabetical list. Migrating a manager to change someone's
role reuses the exact same RLS policy as branch assignment
(`profiles_update_manager` from migration `0002`, which permits *any*
field a manager writes to `profiles`, not just `branch_id`) — no new policy
was needed, only the app-level `updateStaffRoleAction` in `actions/staff.ts`,
which follows the same "read the row back, treat a no-op as a failure"
pattern as `updateStaffBranchAction` for the same reason.

Existing rows are migrated automatically when `0005` runs: former
`manager` rows become `coo`, former `employee` rows become `teacher` — a
best-effort default, expected to be manually corrected per person
afterwards via the new role dropdown, not a permanent mapping.

## Landing page (`/`, public)

`/` is a public marketing/orientation page (added to `PUBLIC_PATHS` in
`lib/supabase/proxy.ts`; logged-in visitors are redirected to `/calendar` by
the same proxy rule, so it only ever shows to logged-out visitors). It reuses
the app's exact token system — no new colours or fonts.

Signature element: the hero **week board**, a CSS-built mini schedule (not a
screenshot) speaking the product's real visual language — own shifts solid
blue, coworkers as per-person tinted chips, a dashed-yellow "Chờ đổi ca" chip,
a green holiday chip, and a red now-line. Features are a real workday sequence
("Một ngày làm việc", 08:00 → 17:30) rather than a generic feature grid, and
branch cards use the CS1/CS2/CS3 mapping from `branches.color_token`.

### The 3D layer (2026-08)

Depth is **interactive, not decorative** — the governing rule is that a 3D
element the user cannot influence has not earned its cost, so nothing spins or
floats on its own.

- **`components/landing/TiltCard.tsx`** — the hero board tilts to follow the
  pointer. Its clock-in card sits on a higher Z plane (`.tilt-lift-2` vs
  `.tilt-lift-1`), so the two surfaces shift by different amounts as it moves.
  That parallax is what reads as depth; a single skewed plane just looks
  sheared. It writes CSS custom properties from a `requestAnimationFrame`
  callback rather than calling `setState`, so React never re-renders during
  pointer movement.
- **Disarmed, not degraded**, on three counts: `prefers-reduced-motion`,
  coarse pointers (a phone has no hover, so tilt-on-touch only reads as lag),
  and any subtree lacking a `.scene-3d` ancestor.
- **`.scene-3d`** sets `perspective` on the *section*, never per card — a row
  of cards must share one vanishing point or each becomes its own little world
  and the group stops reading as one space.
- **`Reveal depth`** reuses the existing IntersectionObserver so the
  reduced-motion and run-once behaviour is inherited, not duplicated.

Large `bg-primary` panels (final CTA) switch to `dark:bg-card dark:border` — in
dark mode `--primary` is a brighter blue and a big slab of it glares. That
panel is **blue, not red**, and its button carries the red: §8 rejects red as a
large ground, so the guideline's "red CTA" rule applies to the control, not the
container.

## Manager dashboard — command band

`ManagerDashboard.tsx` replaced the 5 separate stat cards with one navy
"băng điều hành" panel: date + status sentence on the left, the 5 numbers
inline on the right. On the navy ground, numbers that need action carry
their own color (gold = pending approvals, teal = live "đang trong ca,"
with a pulsing dot); neutral counts stay white — the manager reads "what
needs me today" from color alone. Same dark-mode rule as above: the band
becomes a bordered card (`dark:bg-card`), and the success tone is
lightened to `oklch(0.78 0.1 165)` in light mode only, because `--success`
(L 0.55) sinks against navy. The old horizontal bar chart (which re-drew
the same 4 numbers) was replaced by "Cần xử lý" — clickable queue rows
linking to `/manager#swaps`, `#leave`, `#staff` (the page's `Section` now
takes an `id` and `scroll-mt-6`).

## Reuse checklist for future template/theme work

1. **Never hand-pick a colour.** Pull from the semantic table above. If nothing
   fits, add a token that points at a ramp step — do not inline a hex. A stray
   value is how a system quietly becomes a freestyle.
2. **No second font, ever.** Both `--font-sans` and `--font-heading` resolve to
   Barlow; hierarchy comes from weight. If you find yourself reaching for
   `font-mono`, see the Typography section — it does not exist here.
3. **Check red before shipping.** Roughly ≤10% of any surface, and never as a
   large ground. If a design needs a big coloured panel, it is blue.
4. **Yellow is never text on white.** Use `--gold-foreground` (yellow-800) on a
   yellow tint, or `#C07A12` and darker on white.
5. **Nothing animates longer than 320ms**, and `ease-pop` is for buttons only.
   Every animation must collapse under `prefers-reduced-motion`.
6. **New tinted badge or status pill?** Measure it. The guideline sets 4.5:1
   for body text, and one variant already failed that at 4.41:1 — the eye does
   not catch this, only the arithmetic does.
7. If a future template ships its own CSS, translate its colour variables to
   reference ours (`var(--primary)` etc.) the same way the `.rbc-*` overrides
   and the `--event-color` indirection do, rather than hardcoding new hex values.
8. **Keep this file honest.** It was wrong for a while after the rebrand — every
   section described a navy/Fraunces system that no longer existed. A design doc
   that lies is worse than no design doc, because people trust it.
