@AGENTS.md

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Ginny House Calendar — UI Modernization**

Ginny House Calendar is an internal staff-scheduling web app for Ginny House, a
Vietnamese English-language center running 3 branches. It handles role-based
shift creation/registration, shift swaps, leave requests (full-day/late-arrival/
early-leave/hourly), real-time attendance (chấm công), a manager analytics
dashboard, and a Google-Calendar-style shift calendar with per-person follow
colors and custom personal calendars. Built on Next.js 16 (App Router,
Turbopack) + Supabase (Postgres, Auth, RLS).

This project is a **UI modernization pass** over the existing, working app —
not a rebuild. The calendar page (`/calendar`) and its components are locked:
already redesigned and explicitly excluded from this work.

**Core Value:** Every remaining screen should feel as considered and "on-brand" as the
calendar and manager dashboard already are — nothing left should read as
default shadcn scaffolding.

### Constraints

- **Tech stack**: Must stay within existing Next.js 16 App Router + Tailwind + shadcn/ui + Supabase stack — no new UI framework.
- **Locked surface**: `/calendar` route and its components must not be modified by this project.
- **Language**: All UI copy is Vietnamese; keep existing tone/labels unless a screen is being meaningfully rewritten.
- **Verification**: No test suite exists — every phase must be manually verified via `tsc --noEmit`, `eslint`, and a real dev-server check before being considered done.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.x (strict mode) - entire app (`app/`, `actions/`, `components/`, `lib/`, `hooks/`, `types/`)
- SQL (PostgreSQL dialect) - Supabase schema and RLS policies in `supabase/migrations/`
- CSS (Tailwind v4 syntax) - `app/globals.css`
## Runtime
- Node.js v22.16.0 (local dev machine; no `.nvmrc`/`.node-version` file committed — pin is implicit)
- Next.js 16.2.9, App Router, **Turbopack** is the default dev/build bundler in this Next.js version (no separate `--turbo` flag needed)
- npm (lockfile: `package-lock.json` present)
## Frameworks
- Next.js 16.2.9 - App Router, React Server Components, Server Actions (`"use server"` files in `actions/`)
- React 19.2.4 / React DOM 19.2.4
- **`proxy.ts`** (repo root) replaces the traditional `middleware.ts` file convention. It exports a `proxy()` function (not `middleware()`) and delegates to `lib/supabase/proxy.ts`. Reference docs exist at `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` and `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md` — consult these before modifying request-interception logic.
- Before writing any new Next.js-specific code (routing, data fetching, caching, server actions, config), check `node_modules/next/dist/docs/` for the relevant guide rather than relying on prior Next.js knowledge.
- shadcn/ui (`shadcn` package ^4.12.0, CLI-driven; component source lives in `components/ui/`)
- `components.json` - style: `radix-nova`, baseColor: `neutral`, iconLibrary: `lucide`, RSC: true, CSS variables enabled, no Tailwind prefix
- radix-ui ^1.6.0 (consolidated Radix primitives package, not individual `@radix-ui/react-*` packages)
- lucide-react ^1.21.0 - icon set
- next-themes ^0.4.6 - dark/light theme provider (`components/theme-provider.tsx` used in `app/layout.tsx`)
- sonner ^2.0.7 - toast notifications (`components/ui/sonner.tsx`, mounted in root layout)
- react-hook-form ^7.80.0
- zod ^4.4.3 - schemas in `lib/validations/`
- @hookform/resolvers ^5.4.0 - connects zod schemas to react-hook-form
- react-big-calendar ^1.20.0 (+ `@types/react-big-calendar`) - core calendar UI in `components/calendar/`; CSS imported via `app/globals.css` (`react-big-calendar/lib/css/react-big-calendar.css`); registered in `next.config.ts` as `serverExternalPackages: ["react-big-calendar"]` (excluded from server bundling since it's a browser-only lib)
- recharts ^3.10.1 - charts, likely attendance/reporting views (`components/attendance/`, `components/manager/`)
- Tailwind CSS v4 (`@tailwindcss/postcss` plugin, no separate `tailwind.config.*` — v4 uses CSS-first config via `@theme` in `app/globals.css`)
- tw-animate-css ^1.4.0 - animation utility classes
- class-variance-authority ^0.7.1 + clsx ^2.1.1 + tailwind-merge ^3.6.0 - the standard shadcn `cn()` utility stack (`lib/utils.ts` expected)
- shadcn's own base CSS imported directly: `@import "shadcn/tailwind.css"` in `app/globals.css`
- next/font/google: Fraunces (display/heading, weights 500/600) and Be_Vietnam_Pro (body, weights 400/500/600), both with `vietnamese` + `latin` subsets — loaded in `app/layout.tsx`. Only used weights are requested (documented rationale inline in that file and in `DESIGN.md`).
- date-fns ^4.4.0
- Not detected. No test runner, test config, or `*.test.*`/`*.spec.*` files found in the repo.
- Turbopack (Next.js 16 built-in bundler)
- ESLint 9 (flat config) - `eslint.config.mjs`, extends `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
- No Prettier config detected
## Key Dependencies
- `@supabase/supabase-js` ^2.108.2 - Supabase JS client (used directly for admin/public clients)
- `@supabase/ssr` ^0.12.0 - cookie-aware SSR client creation for browser/server contexts and the `proxy.ts` session refresh flow
- `zod` ^4.4.3 - runtime validation boundary for all Server Actions (`lib/validations/`, consumed in `actions/*.ts`)
- Supabase Postgres - system of record (schema in `supabase/migrations/`)
- Supabase Auth (GoTrue) - authentication (email/password), used via `supabase.auth.*` in `actions/auth.ts`
## Configuration
- Loaded via standard Next.js `.env.local` (present, not committed — gitignored) and `.env.sample` (committed template) at repo root.
- Required variables (from `.env.sample`):
- `.env.local` file exists locally but its contents were not read (forbidden per security policy) — existence noted only.
- `next.config.ts` - minimal config; only sets `serverExternalPackages: ["react-big-calendar"]`
- `tsconfig.json` - `strict: true`, target ES2017, `moduleResolution: "bundler"`, path alias `@/*` → repo root, Next.js TS plugin enabled
- `postcss.config.mjs` - single plugin `@tailwindcss/postcss`
- `components.json` - shadcn/ui codegen config (see Frameworks section)
## Platform Requirements
- Node.js (v22.x confirmed on the mapping machine; no explicit engines/version pin committed to the repo)
- npm with `package-lock.json`
- Supabase CLI project linked locally (`supabase/.temp/` contains `linked-project.json`, `project-ref`, `pooler-url`, and version-pin files for `gotrue`, `postgres`, `rest`, `storage` — indicates active `supabase link`/`supabase db` CLI usage for this project)
- Deployment target: not explicitly declared in-repo (no `vercel.json`, Dockerfile, or CI config found). Given Next.js + Supabase stack, Vercel is the conventional target but this is inferred, not confirmed.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- `actions/*.ts` (Server Actions): lowercase, feature-named — `leave.ts`, `shifts.ts`, `swaps.ts`, `custom-calendars.ts`. Each exports one or more `*Action` functions.
- `lib/validations/*.ts`: lowercase, singular, matches the entity — `leave.ts`, `shift.ts`, `custom-event.ts`, `auth.ts`, `profile.ts`, `swap.ts`, `shift-request.ts`.
- `components/ui/*` (shadcn primitives): kebab-case — `date-picker-field.tsx`, `alert-dialog.tsx`, `dropdown-menu.tsx`.
- `components/<feature>/*` (app-specific components): **PascalCase** filenames — `LeaveRequestDialog.tsx`, `ShiftCalendar.tsx`, `AppHeader.tsx`. This is the opposite convention from `components/ui/`; do not kebab-case a new feature component, and do not PascalCase a new shadcn primitive.
- `lib/*.ts` top-level helpers: lowercase, domain-named — `roles.ts`, `calendar.ts`, `color.ts`, `constants.ts`, `time-options.ts`, `holidays.ts`, `notifications.ts`.
- `app/(app)/<route>/page.tsx` and `app/(auth)/<route>/page.tsx`: Next.js App Router file conventions (route groups `(app)` and `(auth)` don't affect the URL).
- Server Actions: `camelCase` ending in `Action` — `requestLeaveAction`, `respondToLeaveRequestAction`, `cancelLeaveRequestAction`, `signInAction`, `signUpAction`, `signOutAction`.
- Private module-level helpers: `camelCase`, no suffix — `mapLeaveError`, `mapSignUpError`, `revalidateLeavePaths`, `ensureProfile`.
- React components: `PascalCase`, exported as `default function ComponentName()` in feature components (see `components/leave/LeaveRequestDialog.tsx`).
- `camelCase` throughout TypeScript/TSX.
- Database/Supabase field names stay `snake_case` even in TS (they mirror Postgres columns) — e.g. `start_date`, `branch_id`, `request_type`, `resolved_at`. Do not camelCase these; they are passed straight through to/from Supabase queries and RPC params (`p_start_date`, `p_end_date`, etc. for RPC args).
- Constants: `SCREAMING_SNAKE_CASE` for module-level literal arrays/objects — `LEAVE_REQUEST_TYPES`, `TYPE_OPTIONS`, `PROFILE_COLUMNS`.
- `PascalCase` for all type/interface names, defined centrally in `types/index.ts` (domain entities: `Profile`, `Shift`, `LeaveRequest`, `SwapRequest`, `CustomEvent`, etc.) plus a generic `ActionResult<T>`.
- Per-feature input types are inferred from Zod schemas and exported alongside the schema: `export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>` in `lib/validations/leave.ts`.
- "Detailed"/joined variants use a suffix: `LeaveRequestDetailed`, `SwapRequestDetailed`, `ShiftRequestDetailed`, `ShiftWithAssignee`, `AttendanceWithProfile` — these extend the base type with `Pick<...>` relations.
## Code Style
- No `.prettierrc` present — formatting relies on editor defaults / `eslint-config-next` conventions. Double quotes, semicolons, 2-space indent observed consistently across the codebase (not enforced by a dedicated formatter config file).
- `eslint.config.mjs` uses flat config: `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`, with default Next ignores (`.next/**`, `out/**`, `build/**`, `next-env.d.ts`).
- No custom rule overrides — the project relies entirely on Next's recommended config.
- Run via `npm run lint` (`"lint": "eslint"` in `package.json`).
## Import Organization
- Single alias `@/*` → repo root, configured in `tsconfig.json` (`"paths": { "@/*": ["./*"] }`). All internal imports use this — no relative `../../` chains observed in `actions/`, `lib/`, or `components/`.
## Server Actions Pattern (`actions/*.ts`)
- **Input is always `unknown`**, validated with `schema.safeParse(input)` inside the action — never trust the caller's TypeScript type across the client/server boundary.
- **Return type is always `Promise<ActionResult>`** (or `Promise<ActionResult<T>>` when returning data), defined in `types/index.ts`:
- **Auth guard first**: call `requireProfile()` (any authenticated user) or `requireManager()` (manager-role only) from `lib/auth.ts` before touching Supabase, unless the action is itself the auth entry point (`signInAction`, `signUpAction`).
- **Raw Supabase/Postgres errors are never surfaced directly** — each action module defines a private `map<Feature>Error(message: string): string` function that matches known substrings and returns a Vietnamese, user-facing message, falling back to a generic message (`mapLeaveError`) or the raw message (`mapSignUpError`, intentionally, per its own comment) if unrecognized.
- **Business logic lives in Postgres**, invoked via `supabase.rpc("<postgres_function>", { p_param: value })`. Actions are thin: validate → call RPC → map error → revalidate → return. See `supabase/migrations/` for the RPC definitions this pattern depends on.
- **Revalidate every path the mutated data appears on** via a small private helper (e.g. `revalidateLeavePaths()` hits both `/leave` and `/manager`), not ad hoc `revalidatePath()` calls scattered through the action body.
- Actions that redirect on success (`signInAction`, `signUpAction`, `signOutAction`) call `redirect()` from `next/navigation` instead of returning `{ ok: true }` — `redirect()` throws, so no return statement follows it.
## Validation Schemas (`lib/validations/*.ts`)
- Built with Zod (`v4`, per `package.json` — note `z.uuid()`/`z.email()` top-level helpers rather than `z.string().uuid()`, and `.pipe()` chaining, which are Zod v4 APIs).
- All user-facing validation messages are **in Vietnamese**, written as the second argument to Zod checks (`z.string().min(1, "Vui lòng chọn ngày bắt đầu")`).
- Multi-field/cross-field rules use `.refine()` chains with an explicit `path: [...]` so the error attaches to the right form field, not a top-level error:
- Comment each non-obvious `.refine()` inline when the rule encodes a business rule that isn't self-evident from the code (see `lib/validations/leave.ts`'s per-`request_type` time requirements).
- Every schema exports a paired `z.infer` type immediately below it: `export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>`.
- Domain enums used across schema + UI are exported as `as const` string-literal tuples next to the schema (e.g. `LEAVE_REQUEST_TYPES`), not duplicated inline in components.
- Field-level normalization happens in the schema itself, not the caller: `z.string().trim().toLowerCase().pipe(z.email(...))` for email fields (`lib/validations/auth.ts`), so every consumer gets normalized data automatically.
## "use client" / "use server" Boundaries
- **Server Components are the default** for `app/(app)/**/page.tsx` files — no directive, `async function`, calls `requireProfile()`/`requireManager()` from `lib/auth.ts`, fetches data directly via `createClient()` from `lib/supabase/server.ts`, and passes fetched data as props into client components. See `app/(app)/leave/page.tsx`.
- **Client Components** are marked `"use client";` as the literal first line, used specifically for: forms with local state (`useState`, `react-hook-form`), anything with `onClick`/interactive state, and any component using `usePathname()` or other client-only hooks (e.g. `components/layout/AppHeader.tsx`).
- **Server Actions** are separate files under `actions/`, each starting `"use server";`, imported directly into client components and called from form submit handlers (`await requestLeaveAction(values)`), not wired through `<form action={...}>` — this codebase prefers manual `handleSubmit`/`onSubmit` with `react-hook-form` + `zodResolver` over native form actions, so it can show `serverError` state and `toast.success(...)` (via `sonner`) on the client.
- Data queries (Supabase `select`) happen in Server Components; mutations (Supabase `rpc`/`insert`/`update`) happen exclusively in Server Actions. Client components never construct a Supabase client directly for mutations — they call the corresponding `*Action`.
- `react-big-calendar` is explicitly kept **client-only, never SSR'd**: the Server Component page renders a `"use client"` loader (`ShiftCalendarLoader`) that uses `next/dynamic(..., { ssr: false })` to load the real calendar component, because `next/dynamic`'s `ssr: false` only works from a Client Component, and because the library's CJS entry breaks under server-side React evaluation. See `DESIGN.md`'s "Client-only, never SSR'd" note and `app/(app)/calendar/page.tsx` / `components/calendar/ShiftCalendarLoader.tsx`.
## Error Handling
- **Server Action layer**: Supabase/Postgres errors are caught via `const { error } = await supabase.rpc(...)`, never thrown — checked immediately (`if (error) return { ok: false, error: mapXError(error.message) }`). No `try/catch` used for the expected-error path; `error` is a return value from the Supabase client, not a thrown exception.
- **Error message mapping**: each `actions/*.ts` file with Supabase-originated errors defines a private `map<Domain>Error(message: string): string` that does substring matching against a list of known raw Postgres/RPC error strings (thrown by `RAISE EXCEPTION` in the SQL functions) and returns the matching Vietnamese string, with a safe Vietnamese fallback for unrecognized errors — never leak a raw Postgres error string to the user for domain actions like leave (`mapLeaveError`). The auth mapper (`mapSignUpError`) is an intentional exception — see its inline comment: unmapped Supabase auth errors fall through as-is because they're already reasonably safe/informative.
- **Client-side surfacing**: components call the action, check `result.ok`, and on failure set local `serverError` state rendered as `<p className="text-sm text-destructive">{serverError}</p>` beneath the form — no global error boundary or toast for validation-class failures; `toast.success(...)` (via `sonner`) is used only for success confirmations.
- **Form-level validation errors** (Zod, client-side via `zodResolver`) render inline per-field via `errors.<field>?.message` from `react-hook-form`'s `formState`, styled the same `text-sm text-destructive` as server errors.
- **Auth redirect guarding**: `lib/auth.ts`'s `requireProfile()`/`requireManager()` call `redirect()` (throws) rather than returning an error value — these are guards for entire routes/actions, not recoverable per-field errors.
- No global `try/catch` wrapper, error boundary component, or centralized logger was found — errors are handled locally at the point of the Supabase call.
## Comments
- Comments are used sparingly but purposefully to explain **why**, not what — especially around non-obvious business rules, workarounds for framework bugs, and RLS/security assumptions. Examples: the `ensureProfile` self-heal note in `lib/auth.ts`, the `getSessionProfile` note about avoiding a redundant `getUser()` round trip, the `react-big-calendar` SSR workaround in `DESIGN.md`/`ShiftCalendarLoader.tsx`.
- Inline comments directly above a Zod `.refine()` or RPC call explain the business rule being encoded, especially when it isn't obvious from the code alone (see `lib/validations/leave.ts`, `actions/auth.ts`'s `mapSignUpError`).
- No JSDoc/TSDoc block-comment convention observed on exported functions — types are expected to be self-documenting via TypeScript signatures instead.
## Function Design
## Module Design
## Design System Conventions (see `DESIGN.md`)
- **Color tokens**: OKLCH-based theme in `app/globals.css`, all neutrals tinted to the brand hue (251°) rather than pure gray. Custom tokens beyond shadcn defaults: `--gold`/`--gold-foreground` and `--success`/`--success-foreground`, mapped into `@theme inline` so they work as Tailwind utilities (`bg-gold`, `text-success-foreground`) and as `Badge` variants.
- **Status badges use a soft-tint convention, not solid fill**: low-opacity background + colored (not white) text, e.g. `bg-gold/15 text-gold-foreground dark:bg-gold/20`, `bg-success/12 text-success dark:bg-success/18`, `bg-destructive/10 text-destructive dark:bg-destructive/20` — see `components/ui/badge.tsx`. Apply this pattern to any new status-pill variant rather than a solid background.
- **Status → badge variant mapping**: `pending` → `gold`, `accepted`/`approved` → `success`, `rejected`/`cancelled` → `outline`. Central label maps live in `lib/constants.ts` (`SWAP_STATUS_LABELS`, `LEAVE_STATUS_LABELS`, `SHIFT_REQUEST_STATUS_LABELS`).
- **Typography**: three-role system via CSS variables set in `app/layout.tsx` (`next/font/google`) and mapped in `app/globals.css`'s `@theme inline` block — Fraunces (`--font-heading`) for display/titles, Be Vietnam Pro (`--font-sans`) for body/UI text, JetBrains Mono (`--font-mono`) reserved for tabular/time data. Change the font mapping only in `globals.css`, never per-component.
- **Utility helper**: `cn(...)` in `lib/utils.ts` wraps `clsx` + `tailwind-merge` — use this for all conditional/merged className logic instead of manual string concatenation.
- **UI text language**: all user-facing strings (labels, validation errors, toasts, headings) are in Vietnamese; code identifiers, comments, and commit-style documentation are in English.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## System Overview
```text
```
## Component Responsibilities
| Component | Responsibility | File |
|-----------|----------------|------|
| `proxy.ts` (Next 16 middleware) | Refreshes Supabase auth cookie, gatekeeps public vs. authenticated routes | `proxy.ts`, `lib/supabase/proxy.ts` |
| App shell layout | Runs `requireProfile()`, fetches recent swap/leave/shift-request rows to build the notification bell, renders `AppHeader` | `app/(app)/layout.tsx` |
| Route pages (Server Components) | Auth-gate (`requireProfile`/`requireManager`), parallel Supabase fetches with `Promise.all`, pass typed props to client loader components | `app/(app)/calendar/page.tsx`, `app/(app)/manager/page.tsx`, `app/(app)/attendance/page.tsx`, `app/(app)/leave/page.tsx`, `app/(app)/swaps/page.tsx`, `app/(app)/account/page.tsx` |
| `lib/auth.ts` | `getSessionProfile()` (cached per-request via React `cache`), `requireProfile()`, `requireManager()`, self-healing `ensureProfile()` | `lib/auth.ts` |
| `lib/roles.ts` | Single source of truth for the 9-role hierarchy, manager-tier set, calendar-visibility scope, leave-approval matrix — mirrors SQL functions in migrations | `lib/roles.ts` |
| Server Actions | `"use server"` mutation entry points: auth-check, zod-validate, Supabase write/RPC call, `revalidatePath()` | `actions/*.ts` |
| Client dynamic loader | Wraps `react-big-calendar` in `next/dynamic(..., { ssr: false })` to avoid SSR DOM-measurement crashes | `components/calendar/ShiftCalendarLoader.tsx` |
| `ShiftCalendar` | Client-side calendar orchestration: view state, dialogs, optimistic UI, calls server actions | `components/calendar/ShiftCalendar.tsx` |
| Manager dashboards | Role-branching dashboards (`TechnicalDashboard` for read-only analytics vs `ManagerDashboard` for operational managers) | `components/manager/ManagerDashboard.tsx`, `components/manager/TechnicalDashboard.tsx`, `components/manager/StaffTable.tsx` |
| Supabase clients | Three client factories for three execution contexts (browser, server/RSC, admin/service-role) | `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/admin.ts` |
| `types/index.ts` | Hand-maintained TS types mirroring the Postgres schema (no generated types) | `types/index.ts` |
| SQL migrations | Schema, RLS policies, triggers, `SECURITY DEFINER` RPCs — the actual authorization boundary | `supabase/migrations/*.sql` |
## Pattern Overview
- No API routes / no client-side data-fetching library (no SWR/React Query) — pages fetch directly in the RSC via `lib/supabase/server.ts` and pass fully-resolved data down as props.
- Route-group-based access control: `app/(app)/*` is the authenticated shell, `app/(auth)/*` is public; enforcement happens twice — once cheaply in `proxy.ts` (cookie-presence redirect) and again authoritatively in each Server Component via `requireProfile()`/`requireManager()`.
- Mutations are exclusively Server Actions (`"use server"` files in `actions/`), never fetch handlers; the client calls them directly as async functions from `<form action={...}>` or `onClick` handlers, and each ends with `revalidatePath()` to refresh the RSC tree instead of client-side cache invalidation.
- Authorization is layered: app-side (`lib/roles.ts` predicates + `requireManager()`) guards UI/UX and gives friendly redirects; Postgres RLS + `SECURITY DEFINER` functions (`supabase/migrations/*.sql`) are the actual enforcement layer and must independently reject anything the client-side check misses.
- Business rules that require reading across rows atomically (swap acceptance moving shift ownership, leave approval with group-scoped visibility) are pushed into Postgres RPCs (`request_shift_swap`, `respond_to_swap_request`, `respond_to_leave_request`) rather than being expressed as multi-query Server Action logic — avoids race conditions and keeps RLS-bypassing logic inside a single auditable `SECURITY DEFINER` function.
- Heavy/DOM-dependent client libraries (`react-big-calendar`) are force-client-only via `next/dynamic(..., { ssr: false })` — see comment in `components/calendar/ShiftCalendarLoader.tsx` explaining a real production crash this fixed.
- Types are hand-written (`types/index.ts`), not generated from the Supabase schema — every migration that changes a table shape requires a manual, parallel edit to this file.
## Layers
- Purpose: auth gate, parallel data fetch, prop assembly for a route
- Location: `app/(app)/**/page.tsx`, `app/(auth)/**/page.tsx`
- Contains: `async function Page()` components only — no business logic beyond mapping/filtering fetched rows
- Depends on: `lib/auth.ts`, `lib/supabase/server.ts`, `lib/roles.ts`, `lib/branches.ts`, `lib/calendar.ts`
- Used by: Next.js router (file-based)
- Purpose: cross-page chrome (header, notifications) and the shared auth gate for the entire authenticated app
- Location: `app/(app)/layout.tsx`
- Contains: notification-building fetch + `AppHeader` render
- Depends on: `lib/auth.ts`, `lib/notifications.ts`, `components/layout/AppHeader.tsx`
- Used by: every route under `app/(app)/`
- Purpose: interactive UI — calendars, dialogs, forms, dashboards
- Location: `components/**/*.tsx` (all `"use client"` except where noted)
- Contains: React state, `react-hook-form` + zod-resolved forms, calls into Server Actions
- Depends on: `actions/*.ts`, `lib/validations/*.ts`, `components/ui/*` (shadcn primitives)
- Used by: Server Component pages that render them with fetched data as props
- Purpose: sole entry point for all writes; owns re-auth, validation, and cache invalidation
- Location: `actions/*.ts` (each file starts with `"use server"`)
- Contains: one exported async function per mutation, always returning `ActionResult<T>` (`types/index.ts`)
- Depends on: `lib/auth.ts` (`requireProfile`/`requireManager`), `lib/validations/*.ts` (zod schemas), `lib/supabase/server.ts`
- Used by: client components (form submit handlers)
- Purpose: shared query/derivation logic reused across pages
- Location: `lib/branches.ts`, `lib/calendar.ts`, `lib/attendance.ts`, `lib/notifications.ts`, `lib/holidays.ts`, `lib/color.ts`
- Depends on: `lib/supabase/server.ts` or pure date/util logic
- Used by: page components and Server Actions
- Purpose: schema, RLS, triggers, atomic multi-row business rules
- Location: `supabase/migrations/*.sql` (16 sequential numbered migrations, `0001`–`0016`)
- Contains: tables, enums, `SECURITY DEFINER` helper functions (`is_manager()`, `current_branch_id()`, `can_view_profile()`, `is_leave_approver()`), RPCs (`request_shift_swap`, `respond_to_swap_request`, `cancel_swap_request`, `respond_to_leave_request`), RLS policies
- Used by: every Supabase client call from the app (implicitly, via Postgres)
## Data Flow
### Primary Request Path (read)
### Mutation Path (write)
- No global client state store (no Redux/Zustand/Context-based data cache). Server state lives entirely in Postgres and is re-fetched via RSC re-render after every mutation (`revalidatePath`).
- Client components hold only transient/local UI state (dialog open/closed, form field values via `react-hook-form`, optimistic view state in `hooks/use-calendar-nav.ts`).
- `hooks/use-calendar-nav.ts` manages calendar date/view as URL search params (`?date=&view=`), keeping navigation state server-fetchable and shareable rather than in React state.
## Key Abstractions
- Purpose: uniform discriminated-union return shape for every Server Action so client components can branch on `.ok` without try/catch around network errors
- Examples: every function in `actions/*.ts`
- Pattern: `{ ok: true, data: T } | { ok: false, error: string }` with the `error` string already localized (Vietnamese) for direct toast display
- Purpose: single TypeScript source of truth for the 9-role hierarchy and every access decision derived from it (manager-tier, calendar visibility scope, leave-approval matrix, direct-shift-creation eligibility)
- Examples: `isManagerRole()`, `getCalendarScope()`, `canApproveLeaveFor()`, `canCreateShiftDirectly()`, `isCeo()`
- Pattern: each predicate has a matching Postgres function in `supabase/migrations/*.sql` (called out in code comments, e.g. "Mirrors `is_manager()` in `0005_role_hierarchy.sql` — keep both in sync") — this is a manually-maintained duality, not generated, and is the most likely place logic drift occurs between app and DB.
- Purpose: represent a row joined with its related profile(s)/shift(s) for display, matching Supabase's `select("*, related:table!fk(...)")` join syntax
- Examples: `ShiftRequestDetailed`, `SwapRequestDetailed`, `LeaveRequestDetailed`, `AttendanceWithProfile`, `ShiftWithAssignee`
- Pattern: base type (matches a table 1:1) extended with `Pick<Profile, ...>` / `Pick<Shift, ...>` fields for whatever the query actually joins — must be kept in sync by hand with each `.select()` string
- Purpose: isolate a DOM-dependent third-party library from SSR
- Pattern: `"use client"` wrapper component that `next/dynamic()`-imports the real calendar with `ssr: false` and a `Skeleton` loading state — reusable pattern for any future DOM-measuring library
- Purpose: one zod schema per mutation input, shared between client-side `react-hook-form` (via `@hookform/resolvers/zod`) and server-side Server Action re-validation
- Examples: `shiftSchema` (`lib/validations/shift.ts`), plus `auth.ts`, `custom-event.ts`, `leave.ts`, `profile.ts`, `shift-request.ts`, `swap.ts`
- Pattern: same schema instance imported on both sides — client gets instant field errors, server never trusts client-only validation
## Entry Points
- Location: `proxy.ts` (Next 16's renamed middleware convention — see `AGENTS.md`: "this is NOT the Next.js you know")
- Triggers: every request matching the config matcher (all paths except static assets)
- Responsibilities: delegate to `updateSession()` (`lib/supabase/proxy.ts`) which refreshes the Supabase auth cookie and does coarse public/private path redirects
- Location: `app/layout.tsx`
- Triggers: every page render
- Responsibilities: loads Google Fonts (`Fraunces`, `Be Vietnam Pro`), wraps the tree in `ThemeProvider` (next-themes) and a global `Toaster` (sonner)
- Location: `app/page.tsx`
- Triggers: `/` (public marketing/landing page)
- Responsibilities: static marketing content only, no data fetching, links to `/login` and `/register`
- Location: `app/(auth)/login/page.tsx`, `app/(auth)/register/page.tsx`
- Triggers: unauthenticated users hitting `/login` or `/register`
- Responsibilities: render `LoginForm`/`RegisterForm` client components that call `actions/auth.ts` Server Actions
- Location: `app/(app)/layout.tsx`
- Triggers: any route under the authenticated shell (`/calendar`, `/manager`, `/attendance`, `/leave`, `/swaps`, `/account`)
- Responsibilities: auth gate, header + notification bell assembly, branch-nag banner for front-line staff with no `branch_id`
## Architectural Constraints
- **Threading:** Standard single-request Node/Edge serverless execution per Next.js — no background workers, no queues. All "real-time" behavior (clock widget, notifications) is either client-side polling/interval or re-fetched on next navigation, not a websocket/subscription (`components/layout/RealtimeClock.tsx` is a local ticking clock, not server-pushed).
- **Global state:** No module-level mutable state in application code. `lib/supabase/admin.ts` exports a single `supabaseAdmin` client built from the service-role key at module load — this bypasses RLS entirely and must only be used server-side for privileged operations (profile self-heal in `lib/auth.ts`); never import it into a client component.
- **Circular imports:** None observed; dependency direction is strictly `app/ -> components/ -> actions/ -> lib/ -> supabase/migrations` (one-way).
- **Dual source of truth:** Role/permission logic exists in two places that must be kept manually in sync — `lib/roles.ts` (TypeScript) and `supabase/migrations/*.sql` (`is_manager()`, `can_view_profile()`, `is_leave_approver()`). Comments in `lib/roles.ts` explicitly flag which migration file mirrors each function; there is no automated check enforcing this sync.
- **No generated DB types:** `types/index.ts` is hand-written and must be manually updated whenever a migration changes table shape; there is no `supabase gen types` step in the build.
- **Timezone:** App is Vietnam-only (`Asia/Ho_Chi_Minh`, footer in `app/page.tsx`); date parsing conventions (`parse()` vs `new Date()`) are deliberately constrained — see comment in `app/(app)/calendar/page.tsx:26-29` about avoiding UTC-midnight misparse drift between server and client.
## Anti-Patterns
### Trusting client-side role checks as security
### Editing `types/index.ts` and a migration in isolation
## Error Handling
- Postgres constraint violations are pattern-matched by substring and translated to human messages (`mapShiftError()` in `actions/shifts.ts:9-20`, checking for `shifts_no_overlap`, `shifts_time_valid`, and a custom trigger-raised message)
- zod `safeParse()` (never `parse()`) is used in every Server Action so validation failures return `{ ok: false, error }` instead of throwing (e.g. `actions/shifts.ts:24-27`)
- `requireProfile()`/`requireManager()` use Next.js `redirect()` (not thrown errors) to bounce unauthenticated/unauthorized users, relying on Next's redirect-via-exception mechanism (`lib/auth.ts:63-73`)
- SQL RPCs (`request_shift_swap`, `respond_to_swap_request`, etc.) `raise exception` with Vietnamese messages directly — these bubble up as the Supabase client's `error.message`, so the RPC's error text is often shown to the user close to verbatim
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

_No project-scoped skills declared._ Skills such as `hallmark` are installed
per-machine under `~/.claude/skills/` and are not vendored into this repo.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
