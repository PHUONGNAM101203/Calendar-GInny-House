# Codebase Structure

**Analysis Date:** 2026-08-04

## Directory Layout

```
calendar-ginny-house/
├── app/                        # Next.js App Router routes
│   ├── (app)/                  # Authenticated route group (shared layout + auth gate)
│   │   ├── account/            # /account — profile self-edit
│   │   ├── attendance/         # /attendance — clock in/out + history
│   │   ├── calendar/           # /calendar — main shift calendar (default post-login page)
│   │   ├── leave/              # /leave — leave request list/create
│   │   ├── manager/            # /manager — manager/technical dashboard
│   │   ├── swaps/              # /swaps — shift swap request list/create
│   │   └── layout.tsx          # Auth gate + header + notification bell for the whole group
│   ├── (auth)/                 # Public route group
│   │   ├── login/              # /login
│   │   ├── register/           # /register
│   │   └── layout.tsx          # Shared auth-page chrome
│   ├── icon.png                # App icon (favicon)
│   ├── layout.tsx              # Root layout — fonts, ThemeProvider, Toaster
│   ├── page.tsx                # / — public marketing landing page
│   └── globals.css             # Tailwind v4 + design tokens
├── actions/                    # Server Actions ("use server"), one file per domain
├── components/                 # React components, grouped by domain
│   ├── account/                # Account/profile form
│   ├── attendance/             # Clock widget, attendance history
│   ├── auth/                   # Login/register forms
│   ├── brand/                  # Logo/illustration components
│   ├── calendar/                # react-big-calendar integration (largest domain)
│   ├── landing/                # Landing-page-only scroll-reveal helper
│   ├── layout/                 # App shell chrome (header, user menu, notifications)
│   ├── leave/                  # Leave request card/dialog
│   ├── manager/                # Manager & technical dashboards, staff tables
│   ├── shifts/                 # Shift create/edit dialogs, shift request cards
│   ├── swaps/                  # Swap request card/dialog
│   ├── ui/                     # shadcn/radix-ui primitives (generated, low-touch)
│   └── theme-provider.tsx      # next-themes wrapper
├── hooks/                      # Shared React hooks (calendar URL-state nav)
├── lib/                        # Non-component application logic
│   ├── supabase/                # Client factories: browser / server(RSC) / admin / proxy
│   ├── validations/              # zod schemas, one per mutation domain
│   ├── auth.ts                  # getSessionProfile/requireProfile/requireManager
│   ├── roles.ts                  # Role hierarchy + all permission predicates
│   ├── branches.ts, calendar.ts, attendance.ts, notifications.ts, holidays.ts,
│   │   color.ts, constants.ts, time-options.ts, utils.ts
├── supabase/
│   └── migrations/              # Sequential numbered SQL migrations (schema, RLS, RPCs)
├── types/
│   └── index.ts                 # Hand-maintained TS types mirroring the DB schema
├── public/
│   └── brand/                   # Logo/brand image assets
├── proxy.ts                     # Next 16 middleware-equivalent (session refresh, route gating)
├── next.config.ts
├── components.json              # shadcn CLI config (style: radix-nova, aliases)
├── DESIGN.md                    # Design-system rationale (typography, color, motion)
└── .agents/, .claude/            # Agent/skill configuration (not application code)
```

## Directory Purposes

**`app/(app)/`:**
- Purpose: every authenticated screen of the product
- Contains: one subdirectory per route, each with a `page.tsx` (and sometimes `loading.tsx` for a route-level Suspense fallback)
- Key files: `app/(app)/layout.tsx` (auth gate + notification fetch shared by all routes below it)

**`app/(auth)/`:**
- Purpose: pre-login screens
- Contains: `login/page.tsx`, `register/page.tsx`, both rendering client form components from `components/auth/`
- Key files: `app/(auth)/layout.tsx`

**`actions/`:**
- Purpose: the only place mutations happen — every file starts with `"use server"`
- Contains: one file per domain matching a table/feature (`shifts.ts`, `swaps.ts`, `leave.ts`, `attendance.ts`, `shift-requests.ts`, `staff.ts`, `profile.ts`, `calendar-follows.ts`, `custom-calendars.ts`, `auth.ts`)
- Key files: each exports one async function per mutation, always returning `ActionResult<T>` (`types/index.ts`)

**`components/calendar/`:**
- Purpose: the react-big-calendar integration — the largest and most complex component domain
- Contains: `ShiftCalendarLoader.tsx` (SSR-disabled dynamic import boundary), `ShiftCalendar.tsx` (orchestrator, ~400 lines), `CalendarSidebar.tsx`, `CalendarToolbar.tsx`, `CalendarDayHeader.tsx`, `MiniMonth.tsx`, `ShiftEventCell.tsx`, dialogs (`ShiftDetailDialog` lives in `components/shifts/`; calendar-specific ones: `AttendanceDetailDialog.tsx`, `CustomEventDetailDialog.tsx`, `CustomEventFormDialog.tsx`, `LeaveDetailDialog.tsx`, `ColorPickerDialog.tsx`)

**`components/manager/`:**
- Purpose: manager-facing dashboards and staff administration
- Contains: `ManagerDashboard.tsx` (operational manager view), `TechnicalDashboard.tsx` (read-only analytics view for the `technical` role), `StaffTable.tsx` (edit role/branch), `StaffOverviewTable.tsx` (attendance summary table)

**`components/ui/`:**
- Purpose: shadcn/radix-ui generated primitives — low-level, style-only, no business logic
- Contains: `button.tsx`, `dialog.tsx`, `select.tsx`, `card.tsx`, etc. Managed via `components.json` (style: `radix-nova`); regenerate/add via the shadcn CLI rather than hand-writing new primitives here.

**`lib/supabase/`:**
- Purpose: the three (four, counting proxy) Supabase client factories, each scoped to one execution context
- Contains: `client.ts` (browser, `createBrowserClient`), `server.ts` (RSC/Server Action, cookie-based `createServerClient`), `admin.ts` (service-role key, bypasses RLS — server-only, used sparingly), `proxy.ts` (`updateSession()` used by root `proxy.ts`)

**`lib/validations/`:**
- Purpose: zod schemas shared between client forms (`react-hook-form` + `@hookform/resolvers/zod`) and server-side Server Action re-validation
- Contains: `shift.ts`, `swap.ts`, `leave.ts`, `shift-request.ts`, `custom-event.ts`, `profile.ts`, `auth.ts` — one file per domain, matching `actions/` file names loosely

**`supabase/migrations/`:**
- Purpose: source of truth for schema, RLS policies, triggers, and `SECURITY DEFINER` RPCs
- Contains: 16 sequential numbered files (`0001_init.sql` through `0016_calendar_follows_keep_color.sql`), each additive/forward-only — no down-migrations observed
- Generated: no (hand-written SQL)
- Committed: yes

**`types/index.ts`:**
- Purpose: single file with every domain type (`Role`, `Profile`, `Shift`, `SwapRequest`, `LeaveRequest`, `Attendance`, `CustomCalendar`, `CustomEvent`, plus `*Detailed`/`*WithProfile` join variants, and `ActionResult<T>`)
- Generated: no — manually kept in sync with migrations

**`.agents/skills/`, `.claude/`:**
- Purpose: agent/skill configuration for AI-assisted development (e.g. `.agents/skills/hallmark/` design-writing skill)
- Not application runtime code

## Key File Locations

**Entry Points:**
- `proxy.ts`: Next 16 middleware-equivalent, session refresh + route gating
- `app/layout.tsx`: root HTML shell, fonts, theme, toaster
- `app/page.tsx`: public landing page
- `app/(app)/layout.tsx`: authenticated shell entry (auth gate for everything under it)

**Configuration:**
- `next.config.ts`: Next.js config
- `components.json`: shadcn CLI config (aliases, style)
- `app/globals.css`: Tailwind v4 tokens/theme
- `.env*` (present, not read/committed): Supabase URL/anon key/service-role key

**Core Logic:**
- `lib/auth.ts`: session/profile resolution and route guards
- `lib/roles.ts`: role hierarchy and every permission predicate
- `actions/*.ts`: all mutations
- `supabase/migrations/*.sql`: schema + RLS + RPCs

**Testing:**
- Not detected — no test runner config (`jest.config.*`, `vitest.config.*`), no `*.test.*`/`*.spec.*` files found in the repo.

## Naming Conventions

**Files:**
- React components: `PascalCase.tsx` (e.g. `ShiftCalendar.tsx`, `ManagerDashboard.tsx`), one component per file, file name matches the default/named export
- Non-component modules: `kebab-case.ts` or lowercase single word (e.g. `use-calendar-nav.ts`, `roles.ts`, `custom-calendars.ts`)
- Server Actions: `kebab-case.ts` matching the domain noun, exported functions suffixed `Action` (e.g. `createShiftAction`, `respondToSwapAction`)
- Validation schemas: `lib/validations/<domain>.ts`, exported schema named `<domain>Schema` with inferred type `<Domain>Input`
- SQL migrations: `NNNN_description.sql`, zero-padded 4-digit sequential prefix, lowercase snake_case description

**Directories:**
- `components/<domain>/`: one directory per product feature area, matching the corresponding `actions/<domain>.ts` and `lib/validations/<domain>.ts` naming where applicable
- Route groups use parenthesized names `(app)`, `(auth)` — standard Next.js App Router convention, does not affect URL path

## Where to Add New Code

**New Feature (new domain, e.g. a new request type):**
- Migration: add `supabase/migrations/00NN_<feature>.sql` with table + RLS policies (+ `SECURITY DEFINER` RPC if the mutation needs to bypass row-level checks atomically)
- Types: add the base type + any `*Detailed` join type to `types/index.ts`
- Validation: add `lib/validations/<feature>.ts` with a zod schema
- Server Actions: add `actions/<feature>.ts` (`"use server"`), each function starting with `requireProfile()`/`requireManager()`, ending with `revalidatePath()`
- Role rules: extend `lib/roles.ts` predicates if the feature needs new visibility/approval logic, and mirror the same rule in the migration's `SECURITY DEFINER` function
- Components: add `components/<feature>/` with card/dialog/form components
- Route: add `app/(app)/<feature>/page.tsx` (Server Component) that fetches data and passes it to the client component(s)

**New Component/Module:**
- Domain-specific UI: `components/<existing-domain>/ComponentName.tsx`
- Generic shadcn primitive: use the shadcn CLI to add to `components/ui/` rather than hand-writing

**Utilities:**
- Shared pure helpers: `lib/utils.ts` (generic) or a new `lib/<concern>.ts` file for a cohesive concern (mirrors existing pattern of `lib/color.ts`, `lib/calendar.ts`, `lib/holidays.ts`)
- React hooks: `hooks/use-<name>.ts`

## Special Directories

**`.next/`:**
- Purpose: Next.js build output
- Generated: yes
- Committed: no

**`supabase/.temp/`:**
- Purpose: Supabase CLI local state
- Generated: yes
- Committed: no (should be gitignored)

**`public/brand/`, `public/LOGO-01.png`, `app/icon.png`:**
- Purpose: static brand assets served as-is
- Generated: no
- Committed: yes

**`.planning/`:**
- Purpose: GSD planning/codebase-mapping documents (this file's own location)
- Generated: by GSD tooling
- Committed: yes (project convention)

---

*Structure analysis: 2026-08-04*
