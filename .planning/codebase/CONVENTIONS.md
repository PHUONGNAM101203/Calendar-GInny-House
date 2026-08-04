# Coding Conventions

**Analysis Date:** 2026-08-04

## Naming Patterns

**Files:**
- `actions/*.ts` (Server Actions): lowercase, feature-named — `leave.ts`, `shifts.ts`, `swaps.ts`, `custom-calendars.ts`. Each exports one or more `*Action` functions.
- `lib/validations/*.ts`: lowercase, singular, matches the entity — `leave.ts`, `shift.ts`, `custom-event.ts`, `auth.ts`, `profile.ts`, `swap.ts`, `shift-request.ts`.
- `components/ui/*` (shadcn primitives): kebab-case — `date-picker-field.tsx`, `alert-dialog.tsx`, `dropdown-menu.tsx`.
- `components/<feature>/*` (app-specific components): **PascalCase** filenames — `LeaveRequestDialog.tsx`, `ShiftCalendar.tsx`, `AppHeader.tsx`. This is the opposite convention from `components/ui/`; do not kebab-case a new feature component, and do not PascalCase a new shadcn primitive.
- `lib/*.ts` top-level helpers: lowercase, domain-named — `roles.ts`, `calendar.ts`, `color.ts`, `constants.ts`, `time-options.ts`, `holidays.ts`, `notifications.ts`.
- `app/(app)/<route>/page.tsx` and `app/(auth)/<route>/page.tsx`: Next.js App Router file conventions (route groups `(app)` and `(auth)` don't affect the URL).

**Functions:**
- Server Actions: `camelCase` ending in `Action` — `requestLeaveAction`, `respondToLeaveRequestAction`, `cancelLeaveRequestAction`, `signInAction`, `signUpAction`, `signOutAction`.
- Private module-level helpers: `camelCase`, no suffix — `mapLeaveError`, `mapSignUpError`, `revalidateLeavePaths`, `ensureProfile`.
- React components: `PascalCase`, exported as `default function ComponentName()` in feature components (see `components/leave/LeaveRequestDialog.tsx`).

**Variables:**
- `camelCase` throughout TypeScript/TSX.
- Database/Supabase field names stay `snake_case` even in TS (they mirror Postgres columns) — e.g. `start_date`, `branch_id`, `request_type`, `resolved_at`. Do not camelCase these; they are passed straight through to/from Supabase queries and RPC params (`p_start_date`, `p_end_date`, etc. for RPC args).
- Constants: `SCREAMING_SNAKE_CASE` for module-level literal arrays/objects — `LEAVE_REQUEST_TYPES`, `TYPE_OPTIONS`, `PROFILE_COLUMNS`.

**Types:**
- `PascalCase` for all type/interface names, defined centrally in `types/index.ts` (domain entities: `Profile`, `Shift`, `LeaveRequest`, `SwapRequest`, `CustomEvent`, etc.) plus a generic `ActionResult<T>`.
- Per-feature input types are inferred from Zod schemas and exported alongside the schema: `export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>` in `lib/validations/leave.ts`.
- "Detailed"/joined variants use a suffix: `LeaveRequestDetailed`, `SwapRequestDetailed`, `ShiftRequestDetailed`, `ShiftWithAssignee`, `AttendanceWithProfile` — these extend the base type with `Pick<...>` relations.

## Code Style

**Formatting:**
- No `.prettierrc` present — formatting relies on editor defaults / `eslint-config-next` conventions. Double quotes, semicolons, 2-space indent observed consistently across the codebase (not enforced by a dedicated formatter config file).

**Linting:**
- `eslint.config.mjs` uses flat config: `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`, with default Next ignores (`.next/**`, `out/**`, `build/**`, `next-env.d.ts`).
- No custom rule overrides — the project relies entirely on Next's recommended config.
- Run via `npm run lint` (`"lint": "eslint"` in `package.json`).

## Import Organization

**Order (observed, not enforced by tooling):**
1. Framework/directive pragma (`"use client"` / `"use server"`) as the literal first line, followed by a blank line.
2. React / Next built-ins (`react`, `next/navigation`, `next/cache`, `next/image`).
3. Third-party libraries (`zod`, `react-hook-form`, `@hookform/resolvers/zod`, `sonner`, `lucide-react`).
4. Internal `@/` absolute imports: actions → lib → components/ui → components/feature → types, roughly in that order.
5. `type` imports for local types are typically the last import line (`import type { ActionResult } from "@/types"`, `import type { LeaveRequestType } from "@/types"`).

**Path Aliases:**
- Single alias `@/*` → repo root, configured in `tsconfig.json` (`"paths": { "@/*": ["./*"] }`). All internal imports use this — no relative `../../` chains observed in `actions/`, `lib/`, or `components/`.

## Server Actions Pattern (`actions/*.ts`)

Every Server Action file starts with `"use server";` as the first line. Actions follow this shape:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { leaveRequestSchema } from "@/lib/validations/leave";
import type { ActionResult } from "@/types";

export async function requestLeaveAction(input: unknown): Promise<ActionResult> {
  await requireProfile();                              // 1. auth guard
  const parsed = leaveRequestSchema.safeParse(input);   // 2. validate untyped input
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_leave", { /* p_-prefixed params */ });
  if (error) return { ok: false, error: mapLeaveError(error.message) };  // 3. map raw errors

  revalidateLeavePaths();                               // 4. revalidate affected paths
  return { ok: true, data: undefined };                 // 5. success shape
}
```

Rules to follow when adding a new Server Action:
- **Input is always `unknown`**, validated with `schema.safeParse(input)` inside the action — never trust the caller's TypeScript type across the client/server boundary.
- **Return type is always `Promise<ActionResult>`** (or `Promise<ActionResult<T>>` when returning data), defined in `types/index.ts`:
  ```typescript
  export type ActionResult<T = undefined> =
    | { ok: true; data: T }
    | { ok: false; error: string };
  ```
- **Auth guard first**: call `requireProfile()` (any authenticated user) or `requireManager()` (manager-role only) from `lib/auth.ts` before touching Supabase, unless the action is itself the auth entry point (`signInAction`, `signUpAction`).
- **Raw Supabase/Postgres errors are never surfaced directly** — each action module defines a private `map<Feature>Error(message: string): string` function that matches known substrings and returns a Vietnamese, user-facing message, falling back to a generic message (`mapLeaveError`) or the raw message (`mapSignUpError`, intentionally, per its own comment) if unrecognized.
- **Business logic lives in Postgres**, invoked via `supabase.rpc("<postgres_function>", { p_param: value })`. Actions are thin: validate → call RPC → map error → revalidate → return. See `supabase/migrations/` for the RPC definitions this pattern depends on.
- **Revalidate every path the mutated data appears on** via a small private helper (e.g. `revalidateLeavePaths()` hits both `/leave` and `/manager`), not ad hoc `revalidatePath()` calls scattered through the action body.
- Actions that redirect on success (`signInAction`, `signUpAction`, `signOutAction`) call `redirect()` from `next/navigation` instead of returning `{ ok: true }` — `redirect()` throws, so no return statement follows it.

## Validation Schemas (`lib/validations/*.ts`)

- Built with Zod (`v4`, per `package.json` — note `z.uuid()`/`z.email()` top-level helpers rather than `z.string().uuid()`, and `.pipe()` chaining, which are Zod v4 APIs).
- All user-facing validation messages are **in Vietnamese**, written as the second argument to Zod checks (`z.string().min(1, "Vui lòng chọn ngày bắt đầu")`).
- Multi-field/cross-field rules use `.refine()` chains with an explicit `path: [...]` so the error attaches to the right form field, not a top-level error:
  ```typescript
  .refine((v) => v.end_date >= v.start_date, {
    message: "Ngày kết thúc phải sau ngày bắt đầu",
    path: ["end_date"],
  })
  ```
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

**Patterns:**
- **Server Action layer**: Supabase/Postgres errors are caught via `const { error } = await supabase.rpc(...)`, never thrown — checked immediately (`if (error) return { ok: false, error: mapXError(error.message) }`). No `try/catch` used for the expected-error path; `error` is a return value from the Supabase client, not a thrown exception.
- **Error message mapping**: each `actions/*.ts` file with Supabase-originated errors defines a private `map<Domain>Error(message: string): string` that does substring matching against a list of known raw Postgres/RPC error strings (thrown by `RAISE EXCEPTION` in the SQL functions) and returns the matching Vietnamese string, with a safe Vietnamese fallback for unrecognized errors — never leak a raw Postgres error string to the user for domain actions like leave (`mapLeaveError`). The auth mapper (`mapSignUpError`) is an intentional exception — see its inline comment: unmapped Supabase auth errors fall through as-is because they're already reasonably safe/informative.
- **Client-side surfacing**: components call the action, check `result.ok`, and on failure set local `serverError` state rendered as `<p className="text-sm text-destructive">{serverError}</p>` beneath the form — no global error boundary or toast for validation-class failures; `toast.success(...)` (via `sonner`) is used only for success confirmations.
- **Form-level validation errors** (Zod, client-side via `zodResolver`) render inline per-field via `errors.<field>?.message` from `react-hook-form`'s `formState`, styled the same `text-sm text-destructive` as server errors.
- **Auth redirect guarding**: `lib/auth.ts`'s `requireProfile()`/`requireManager()` call `redirect()` (throws) rather than returning an error value — these are guards for entire routes/actions, not recoverable per-field errors.
- No global `try/catch` wrapper, error boundary component, or centralized logger was found — errors are handled locally at the point of the Supabase call.

## Comments

**When to Comment:**
- Comments are used sparingly but purposefully to explain **why**, not what — especially around non-obvious business rules, workarounds for framework bugs, and RLS/security assumptions. Examples: the `ensureProfile` self-heal note in `lib/auth.ts`, the `getSessionProfile` note about avoiding a redundant `getUser()` round trip, the `react-big-calendar` SSR workaround in `DESIGN.md`/`ShiftCalendarLoader.tsx`.
- Inline comments directly above a Zod `.refine()` or RPC call explain the business rule being encoded, especially when it isn't obvious from the code alone (see `lib/validations/leave.ts`, `actions/auth.ts`'s `mapSignUpError`).
- No JSDoc/TSDoc block-comment convention observed on exported functions — types are expected to be self-documenting via TypeScript signatures instead.

## Function Design

**Size:** Server Actions are kept short (typically 10–25 lines): validate → call → map error → revalidate → return. Business logic itself lives in Postgres RPC functions, not in the action body.

**Parameters:** Actions taking form data accept a single `input: unknown` parameter (validated internally); actions taking an identifier accept typed scalar params directly (e.g. `respondToLeaveRequestAction(requestId: string, approve: boolean)`).

**Return Values:** Every Server Action returns `Promise<ActionResult<T>>` (or triggers a `redirect()`), never a bare boolean/void, so the calling client component always has a discriminated `ok`/`error` shape to branch on.

## Module Design

**Exports:** Named exports throughout `actions/`, `lib/`, and `types/` (no default exports for logic modules). Feature components under `components/<feature>/` use a single `export default function ComponentName()` per file. `components/ui/*` primitives export named symbols (component + its `cva` variants object, e.g. `export { Badge, badgeVariants }`).

**Barrel Files:** None found — no `index.ts` re-export barrels in `lib/`, `actions/`, or `components/`. Types are centralized in a single `types/index.ts` file rather than split per-domain files re-exported from a barrel.

## Design System Conventions (see `DESIGN.md`)

These are UI-specific conventions worth following for any new component work, documented in full in `DESIGN.md` at the repo root:

- **Color tokens**: OKLCH-based theme in `app/globals.css`, all neutrals tinted to the brand hue (251°) rather than pure gray. Custom tokens beyond shadcn defaults: `--gold`/`--gold-foreground` and `--success`/`--success-foreground`, mapped into `@theme inline` so they work as Tailwind utilities (`bg-gold`, `text-success-foreground`) and as `Badge` variants.
- **Status badges use a soft-tint convention, not solid fill**: low-opacity background + colored (not white) text, e.g. `bg-gold/15 text-gold-foreground dark:bg-gold/20`, `bg-success/12 text-success dark:bg-success/18`, `bg-destructive/10 text-destructive dark:bg-destructive/20` — see `components/ui/badge.tsx`. Apply this pattern to any new status-pill variant rather than a solid background.
- **Status → badge variant mapping**: `pending` → `gold`, `accepted`/`approved` → `success`, `rejected`/`cancelled` → `outline`. Central label maps live in `lib/constants.ts` (`SWAP_STATUS_LABELS`, `LEAVE_STATUS_LABELS`, `SHIFT_REQUEST_STATUS_LABELS`).
- **Typography**: three-role system via CSS variables set in `app/layout.tsx` (`next/font/google`) and mapped in `app/globals.css`'s `@theme inline` block — Fraunces (`--font-heading`) for display/titles, Be Vietnam Pro (`--font-sans`) for body/UI text, JetBrains Mono (`--font-mono`) reserved for tabular/time data. Change the font mapping only in `globals.css`, never per-component.
- **Utility helper**: `cn(...)` in `lib/utils.ts` wraps `clsx` + `tailwind-merge` — use this for all conditional/merged className logic instead of manual string concatenation.
- **UI text language**: all user-facing strings (labels, validation errors, toasts, headings) are in Vietnamese; code identifiers, comments, and commit-style documentation are in English.

---

*Convention analysis: 2026-08-04*
