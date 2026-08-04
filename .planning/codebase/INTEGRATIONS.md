# External Integrations

**Analysis Date:** 2026-08-04

## APIs & External Services

**Backend-as-a-Service:**
- Supabase (single integrated provider for auth + database) - project linked via Supabase CLI (`supabase/.temp/linked-project.json`, `project-ref`, `pooler-url`)
  - SDK/Client: `@supabase/supabase-js` ^2.108.2, `@supabase/ssr` ^0.12.0
  - Auth: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

No other third-party APIs (payment, SMS, email delivery, maps, analytics SDKs, etc.) were found in `package.json` dependencies or import statements across `app/`, `actions/`, `components/`, `lib/`.

## Data Storage

**Databases:**
- Supabase Postgres (managed Postgres + `pgcrypto`, `btree_gist` extensions enabled — see `supabase/migrations/0001_init.sql`)
  - Connection: via Supabase client libraries, not a raw connection string; pooler URL recorded in `supabase/.temp/pooler-url` (local CLI artifact only)
  - Client: four distinct Supabase client factories in `lib/supabase/`:
    - `lib/supabase/client.ts` - `createBrowserClient` (browser components, anon key)
    - `lib/supabase/server.ts` - `createServerClient` (Server Components/Actions, cookie-bound via `next/headers`, anon key)
    - `lib/supabase/proxy.ts` - `createServerClient` for the `proxy.ts` session-refresh flow (anon key, request-cookie-bound)
    - `lib/supabase/admin.ts` - plain `createClient` from `@supabase/supabase-js` using `SUPABASE_SERVICE_ROLE_KEY` — bypasses Row Level Security; server-only, must never be imported into client components
    - `lib/supabase/public.ts` - plain `createClient` with anon key, no cookie binding; explicitly documented (inline comment) for use with `unstable_cache` and other cacheable server helpers where request-scoped cookies would break caching
  - Schema managed via 16 sequential SQL migrations in `supabase/migrations/` (`0001_init.sql` through `0016_calendar_follows_keep_color.sql`), plus `supabase/seed.sql` for local seed data
  - Row Level Security (RLS) is enabled on multiple tables (confirmed `enable row level security` statements in `0001_init.sql` (x4), `0003_attendance.sql`, `0004_leave_requests.sql`, `0008_calendar_follows.sql`, `0010_shift_requests.sql`, `0015_custom_calendars.sql` (x2)) — RLS is the primary authorization boundary; the anon-key clients (`client.ts`, `server.ts`, `proxy.ts`, `public.ts`) rely on it, while `admin.ts` intentionally bypasses it for privileged server-side operations (e.g., staff management, manager actions)

**Domain schema (from `0001_init.sql`):**
- `public.branches` - company branches/locations (`code`, `name`, `address`, `color_token`)
- `public.profiles` - extends `auth.users` (1:1 via `id` FK with `on delete cascade`), holds `role` (`employee` | `manager` enum `public.user_role`), `branch_id`
- `public.shifts` - shift assignments with `start_at`/`end_at`, exclusion constraint `shifts_no_overlap` (GiST, prevents double-booking the same `assignee_id` for overlapping time ranges) and `shifts_time_valid` check
- Later migrations add: manager/staff management, attendance tracking, leave requests (with typed leave categories), role hierarchy expansion, "global manager" scope, an "operations" role, calendar-follow subscriptions, custom profile colors (later expanded palette), shift-swap requests, custom/user-defined calendars

**File Storage:**
- Not detected. No Supabase Storage bucket references (`storage.buckets`/`storage.objects`) found in migrations, and no storage client usage found in `lib/` or `actions/`. Static brand assets are committed directly to `public/` (`public/LOGO-01.png`, `public/brand/icon-navy.png`, `icon-square.png`, `icon-white.png`) rather than uploaded to a storage bucket.

**Caching:**
- Next.js built-in caching only (`unstable_cache`, referenced by the doc comment in `lib/supabase/public.ts`). No external cache service (Redis, etc.) detected.

## Authentication & Identity

**Auth Provider:**
- Supabase Auth (GoTrue) - email + password authentication only
  - Implementation: `actions/auth.ts` (Server Actions, `"use server"`)
    - `signInAction` → `supabase.auth.signInWithPassword()`
    - `signUpAction` → `supabase.auth.signUp()` with `options.data` carrying `full_name` and `branch_id` as user metadata (consumed by a Postgres trigger/function to populate `public.profiles`, per the `handle_new_user()` teardown/recreation pattern visible in `0001_init.sql`)
    - `signOutAction` → `supabase.auth.signOut()`
  - Error messages from Supabase (English) are explicitly translated to Vietnamese for end users via `mapSignUpError()` in `actions/auth.ts` — new auth error paths should follow this same mapping pattern rather than surfacing raw Supabase error strings
  - Session/route protection: `proxy.ts` (root) + `lib/supabase/proxy.ts` (`updateSession()`) run on every non-static request (matcher excludes `_next/static`, `_next/image`, `favicon.ico`, and common image extensions). Logic: unauthenticated users hitting a non-public path are redirected to `/login`; authenticated users hitting `/`, `/login`, or `/register` are redirected to `/calendar`. Public paths are hardcoded in `PUBLIC_PATHS = ["/", "/login", "/register"]` in `lib/supabase/proxy.ts` — new public routes must be added to this list.
  - No OTP/magic-link/social-login/MFA integration detected — password-only auth.

## Monitoring & Observability

**Error Tracking:**
- Not detected. No Sentry, Bugsnag, or similar SDK in `package.json`.

**Logs:**
- Not detected. No structured logging library found; presumed console/platform-native logging only.

## CI/CD & Deployment

**Hosting:**
- Not detected. No `vercel.json`, Dockerfile, or hosting-specific config found. No `.github/workflows/` CI pipeline found.

**CI Pipeline:**
- None detected.

## Environment Configuration

**Required env vars** (from `.env.sample`):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL` (defaults to `http://localhost:3000`)

**Secrets location:**
- Local development: `.env.local` (exists on disk, gitignored, contents not read per security policy)
- Production secrets store: not detected in-repo (would be configured in the hosting platform, e.g., Vercel project env vars — not confirmed)

## Webhooks & Callbacks

**Incoming:**
- None detected (no API route handlers found under `app/api/`, no webhook-signature-verification code found).

**Outgoing:**
- None detected.

---

*Integration audit: 2026-08-04*
