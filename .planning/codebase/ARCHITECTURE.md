<!-- refreshed: 2026-08-04 -->
# Architecture

**Analysis Date:** 2026-08-04

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                     proxy.ts (Next 16 "middleware")          │
│     matches all routes, refreshes Supabase session cookie,   │
│     redirects unauthenticated -> /login, authenticated on    │
│     public paths -> /calendar   `proxy.ts` `lib/supabase/proxy.ts` │
└───────────────────────────┬───────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│         App Router route groups (Server Components)          │
│  `app/(auth)/*`  login/register — public                      │
│  `app/(app)/*`   calendar/manager/attendance/leave/swaps/     │
│                  account — behind requireProfile()/            │
│                  requireManager() in `lib/auth.ts`            │
└─────────────┬──────────────────────────────┬──────────────────┘
              │ fetch (RSC, awaited)          │ render
              ▼                              ▼
┌───────────────────────────┐   ┌─────────────────────────────┐
│  Supabase Postgres via     │   │  Client Components           │
│  `lib/supabase/server.ts`  │   │  `components/calendar/*`,    │
│  (RLS-scoped, cookie auth) │   │  `components/manager/*`, etc.│
└──────────────┬──────────────┘   └───────────────┬───────────────┘
              │                                  │ calls
              │                                  ▼
              │                     ┌─────────────────────────────┐
              │                     │  Server Actions ("use server")│
              │                     │  `actions/*.ts`                │
              │                     │  requireProfile/requireManager │
              │                     │  -> zod validate -> supabase   │
              │                     │  write -> revalidatePath()     │
              │                     └───────────────┬───────────────┘
              │                                     │
              ▼                                     ▼
┌─────────────────────────────────────────────────────────────┐
│          Supabase Postgres — RLS policies + SECURITY         │
│          DEFINER RPCs   `supabase/migrations/*.sql`          │
└─────────────────────────────────────────────────────────────┘
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

**Overall:** Server-first Next.js App Router app — Server Components own all reads, Server Actions own all writes, Postgres RLS is the real authorization boundary (app-layer role checks are a UX convenience, not the security guarantee).

**Key Characteristics:**
- No API routes / no client-side data-fetching library (no SWR/React Query) — pages fetch directly in the RSC via `lib/supabase/server.ts` and pass fully-resolved data down as props.
- Route-group-based access control: `app/(app)/*` is the authenticated shell, `app/(auth)/*` is public; enforcement happens twice — once cheaply in `proxy.ts` (cookie-presence redirect) and again authoritatively in each Server Component via `requireProfile()`/`requireManager()`.
- Mutations are exclusively Server Actions (`"use server"` files in `actions/`), never fetch handlers; the client calls them directly as async functions from `<form action={...}>` or `onClick` handlers, and each ends with `revalidatePath()` to refresh the RSC tree instead of client-side cache invalidation.
- Authorization is layered: app-side (`lib/roles.ts` predicates + `requireManager()`) guards UI/UX and gives friendly redirects; Postgres RLS + `SECURITY DEFINER` functions (`supabase/migrations/*.sql`) are the actual enforcement layer and must independently reject anything the client-side check misses.
- Business rules that require reading across rows atomically (swap acceptance moving shift ownership, leave approval with group-scoped visibility) are pushed into Postgres RPCs (`request_shift_swap`, `respond_to_swap_request`, `respond_to_leave_request`) rather than being expressed as multi-query Server Action logic — avoids race conditions and keeps RLS-bypassing logic inside a single auditable `SECURITY DEFINER` function.
- Heavy/DOM-dependent client libraries (`react-big-calendar`) are force-client-only via `next/dynamic(..., { ssr: false })` — see comment in `components/calendar/ShiftCalendarLoader.tsx` explaining a real production crash this fixed.
- Types are hand-written (`types/index.ts`), not generated from the Supabase schema — every migration that changes a table shape requires a manual, parallel edit to this file.

## Layers

**Route/Page layer (Server Components):**
- Purpose: auth gate, parallel data fetch, prop assembly for a route
- Location: `app/(app)/**/page.tsx`, `app/(auth)/**/page.tsx`
- Contains: `async function Page()` components only — no business logic beyond mapping/filtering fetched rows
- Depends on: `lib/auth.ts`, `lib/supabase/server.ts`, `lib/roles.ts`, `lib/branches.ts`, `lib/calendar.ts`
- Used by: Next.js router (file-based)

**Shell layout:**
- Purpose: cross-page chrome (header, notifications) and the shared auth gate for the entire authenticated app
- Location: `app/(app)/layout.tsx`
- Contains: notification-building fetch + `AppHeader` render
- Depends on: `lib/auth.ts`, `lib/notifications.ts`, `components/layout/AppHeader.tsx`
- Used by: every route under `app/(app)/`

**Client interaction layer:**
- Purpose: interactive UI — calendars, dialogs, forms, dashboards
- Location: `components/**/*.tsx` (all `"use client"` except where noted)
- Contains: React state, `react-hook-form` + zod-resolved forms, calls into Server Actions
- Depends on: `actions/*.ts`, `lib/validations/*.ts`, `components/ui/*` (shadcn primitives)
- Used by: Server Component pages that render them with fetched data as props

**Server Action layer:**
- Purpose: sole entry point for all writes; owns re-auth, validation, and cache invalidation
- Location: `actions/*.ts` (each file starts with `"use server"`)
- Contains: one exported async function per mutation, always returning `ActionResult<T>` (`types/index.ts`)
- Depends on: `lib/auth.ts` (`requireProfile`/`requireManager`), `lib/validations/*.ts` (zod schemas), `lib/supabase/server.ts`
- Used by: client components (form submit handlers)

**Data-access helpers:**
- Purpose: shared query/derivation logic reused across pages
- Location: `lib/branches.ts`, `lib/calendar.ts`, `lib/attendance.ts`, `lib/notifications.ts`, `lib/holidays.ts`, `lib/color.ts`
- Depends on: `lib/supabase/server.ts` or pure date/util logic
- Used by: page components and Server Actions

**Database layer:**
- Purpose: schema, RLS, triggers, atomic multi-row business rules
- Location: `supabase/migrations/*.sql` (16 sequential numbered migrations, `0001`–`0016`)
- Contains: tables, enums, `SECURITY DEFINER` helper functions (`is_manager()`, `current_branch_id()`, `can_view_profile()`, `is_leave_approver()`), RPCs (`request_shift_swap`, `respond_to_swap_request`, `cancel_swap_request`, `respond_to_leave_request`), RLS policies
- Used by: every Supabase client call from the app (implicitly, via Postgres)

## Data Flow

### Primary Request Path (read)

1. Browser requests `/calendar?date=...&view=...` — `proxy.ts` runs first, refreshes the Supabase session cookie and redirects to `/login` if unauthenticated (`lib/supabase/proxy.ts:6-51`)
2. `app/(app)/layout.tsx` runs `requireProfile()` (`lib/auth.ts:63-67`), fetches recent swaps/leaves/shift-requests for the notification bell
3. `app/(app)/calendar/page.tsx` re-derives the profile (React `cache`-deduped, no extra network round trip), computes the visible date range (`lib/calendar.ts` `getVisibleRange`), and issues 8 parallel Supabase queries via `Promise.all` (`app/(app)/calendar/page.tsx:38-82`) — all implicitly RLS-scoped to what the signed-in user is allowed to see
4. Server Component passes typed, already-fetched arrays as props into `ShiftCalendarLoader` (`components/calendar/ShiftCalendarLoader.tsx`)
5. `ShiftCalendarLoader` is `"use client"` and `next/dynamic`-imports `ShiftCalendar` with `ssr: false`, so the actual `react-big-calendar` render happens only in the browser
6. `ShiftCalendar` renders events, dialogs, and toolbars from the props alone — no further data fetching client-side

### Mutation Path (write)

1. User submits a form/dialog inside a client component (e.g. `components/shifts/ShiftFormDialog.tsx`)
2. Client component calls a Server Action directly, e.g. `createShiftAction(input)` (`actions/shifts.ts:22-47`)
3. Server Action re-runs `requireManager()`/`requireProfile()` (`lib/auth.ts`) — authorization is never trusted from the client, even though the button was already conditionally hidden client-side
4. Input is validated with a zod schema from `lib/validations/*.ts` (e.g. `shiftSchema`, `lib/validations/shift.ts`)
5. Server Action calls `createClient()` (`lib/supabase/server.ts`) and performs the Postgres write — either a direct table insert/update/delete (RLS-checked) or an RPC call into a `SECURITY DEFINER` function for cross-row atomic operations (e.g. `respond_to_swap_request`)
6. Postgres-level constraints/triggers can still reject the write (e.g. `shifts_no_overlap` exclusion constraint, `shifts_time_valid` check) — the action maps known Postgres error substrings to Vietnamese user-facing messages (`mapShiftError` in `actions/shifts.ts:9-20`)
7. On success, the action calls `revalidatePath("/calendar")` and `revalidatePath("/manager")` — no client-side cache/store update; Next.js re-renders the affected Server Components server-side and streams the new tree down
8. Action returns `ActionResult` (`{ ok: true, data } | { ok: false, error }`, `types/index.ts:140-142`); the client component branches on `.ok` to show a toast (`sonner`) or close a dialog

**State Management:**
- No global client state store (no Redux/Zustand/Context-based data cache). Server state lives entirely in Postgres and is re-fetched via RSC re-render after every mutation (`revalidatePath`).
- Client components hold only transient/local UI state (dialog open/closed, form field values via `react-hook-form`, optimistic view state in `hooks/use-calendar-nav.ts`).
- `hooks/use-calendar-nav.ts` manages calendar date/view as URL search params (`?date=&view=`), keeping navigation state server-fetchable and shareable rather than in React state.

## Key Abstractions

**`ActionResult<T>` (`types/index.ts:140-142`):**
- Purpose: uniform discriminated-union return shape for every Server Action so client components can branch on `.ok` without try/catch around network errors
- Examples: every function in `actions/*.ts`
- Pattern: `{ ok: true, data: T } | { ok: false, error: string }` with the `error` string already localized (Vietnamese) for direct toast display

**Role predicates (`lib/roles.ts`):**
- Purpose: single TypeScript source of truth for the 9-role hierarchy and every access decision derived from it (manager-tier, calendar visibility scope, leave-approval matrix, direct-shift-creation eligibility)
- Examples: `isManagerRole()`, `getCalendarScope()`, `canApproveLeaveFor()`, `canCreateShiftDirectly()`, `isCeo()`
- Pattern: each predicate has a matching Postgres function in `supabase/migrations/*.sql` (called out in code comments, e.g. "Mirrors `is_manager()` in `0005_role_hierarchy.sql` — keep both in sync") — this is a manually-maintained duality, not generated, and is the most likely place logic drift occurs between app and DB.

**`*Detailed` types (`types/index.ts`):**
- Purpose: represent a row joined with its related profile(s)/shift(s) for display, matching Supabase's `select("*, related:table!fk(...)")` join syntax
- Examples: `ShiftRequestDetailed`, `SwapRequestDetailed`, `LeaveRequestDetailed`, `AttendanceWithProfile`, `ShiftWithAssignee`
- Pattern: base type (matches a table 1:1) extended with `Pick<Profile, ...>` / `Pick<Shift, ...>` fields for whatever the query actually joins — must be kept in sync by hand with each `.select()` string

**`ShiftCalendarLoader` dynamic-import boundary (`components/calendar/ShiftCalendarLoader.tsx`):**
- Purpose: isolate a DOM-dependent third-party library from SSR
- Pattern: `"use client"` wrapper component that `next/dynamic()`-imports the real calendar with `ssr: false` and a `Skeleton` loading state — reusable pattern for any future DOM-measuring library

**Validation schemas (`lib/validations/*.ts`):**
- Purpose: one zod schema per mutation input, shared between client-side `react-hook-form` (via `@hookform/resolvers/zod`) and server-side Server Action re-validation
- Examples: `shiftSchema` (`lib/validations/shift.ts`), plus `auth.ts`, `custom-event.ts`, `leave.ts`, `profile.ts`, `shift-request.ts`, `swap.ts`
- Pattern: same schema instance imported on both sides — client gets instant field errors, server never trusts client-only validation

## Entry Points

**`proxy.ts` (root):**
- Location: `proxy.ts` (Next 16's renamed middleware convention — see `AGENTS.md`: "this is NOT the Next.js you know")
- Triggers: every request matching the config matcher (all paths except static assets)
- Responsibilities: delegate to `updateSession()` (`lib/supabase/proxy.ts`) which refreshes the Supabase auth cookie and does coarse public/private path redirects

**`app/layout.tsx` (root layout):**
- Location: `app/layout.tsx`
- Triggers: every page render
- Responsibilities: loads Google Fonts (`Fraunces`, `Be Vietnam Pro`), wraps the tree in `ThemeProvider` (next-themes) and a global `Toaster` (sonner)

**`app/page.tsx`:**
- Location: `app/page.tsx`
- Triggers: `/` (public marketing/landing page)
- Responsibilities: static marketing content only, no data fetching, links to `/login` and `/register`

**`app/(auth)/login/page.tsx`, `app/(auth)/register/page.tsx`:**
- Location: `app/(auth)/login/page.tsx`, `app/(auth)/register/page.tsx`
- Triggers: unauthenticated users hitting `/login` or `/register`
- Responsibilities: render `LoginForm`/`RegisterForm` client components that call `actions/auth.ts` Server Actions

**`app/(app)/layout.tsx`:**
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

**What happens:** Nowhere in this codebase — every Server Action re-runs `requireProfile()`/`requireManager()` and every table has RLS enabled.
**Why it's wrong:** N/A — flagged here as a constraint to preserve: any new Server Action that skips the `requireProfile`/`requireManager` call at its top, relying only on the button being hidden client-side, would be a real regression given the established pattern.
**Do this instead:** Every new file in `actions/` must call `requireProfile()` or `requireManager()` (`lib/auth.ts`) as its first line, matching all 9 existing files in `actions/`.

### Editing `types/index.ts` and a migration in isolation

**What happens:** `types/index.ts` types are hand-maintained copies of the Postgres schema; migrations are the source of truth. A migration changing a column (e.g. `0012_leave_request_types.sql` adding `request_type`) requires a matching manual edit to `types/index.ts`.
**Why it's wrong:** Divergence produces silent `any`-like mismatches — Supabase's untyped client (`lib/supabase/server.ts`) does not catch this at compile time; query results are cast with `as` (e.g. `(shifts as ShiftWithAssignee[]) ?? []` in `app/(app)/calendar/page.tsx:94`).
**Do this instead:** Any migration touching `profiles`, `shifts`, `shift_swap_requests`, `shift_requests`, `attendance`, `leave_requests`, `custom_calendars`, or `custom_events` must be paired with an edit to `types/index.ts` in the same change.

## Error Handling

**Strategy:** Server Actions never throw to the client — Supabase/Postgres errors are caught inline and mapped to a Vietnamese-language `ActionResult` error string; the client always gets a typed result, not an exception.

**Patterns:**
- Postgres constraint violations are pattern-matched by substring and translated to human messages (`mapShiftError()` in `actions/shifts.ts:9-20`, checking for `shifts_no_overlap`, `shifts_time_valid`, and a custom trigger-raised message)
- zod `safeParse()` (never `parse()`) is used in every Server Action so validation failures return `{ ok: false, error }` instead of throwing (e.g. `actions/shifts.ts:24-27`)
- `requireProfile()`/`requireManager()` use Next.js `redirect()` (not thrown errors) to bounce unauthenticated/unauthorized users, relying on Next's redirect-via-exception mechanism (`lib/auth.ts:63-73`)
- SQL RPCs (`request_shift_swap`, `respond_to_swap_request`, etc.) `raise exception` with Vietnamese messages directly — these bubble up as the Supabase client's `error.message`, so the RPC's error text is often shown to the user close to verbatim

## Cross-Cutting Concerns

**Logging:** No structured logging framework observed; errors surface only via `ActionResult` returned to the UI and Supabase's own error objects. No server-side log aggregation configured in-repo.

**Validation:** Centralized in `lib/validations/*.ts` zod schemas, shared between `react-hook-form` client validation and Server Action re-validation — see "Key Abstractions" above.

**Authentication:** Supabase Auth via `@supabase/ssr`, cookie-based session, refreshed per-request in `proxy.ts` and read (not re-verified) per-request in `lib/auth.ts` (deliberate optimization — see comment at `lib/auth.ts:38-43` explaining why a second `getUser()` network round trip is avoided).

**Authorization:** Two-layer — `lib/roles.ts` predicates gate UI and Server Action entry (fast, app-side, Vietnamese role hierarchy: `ceo > coo > training_director > hr > technical > teacher > collaborator > customer_care > operations_staff`); Postgres RLS + `SECURITY DEFINER` functions in `supabase/migrations/*.sql` are the actual enforcement boundary, keyed off `auth.uid()`.

---

*Architecture analysis: 2026-08-04*
