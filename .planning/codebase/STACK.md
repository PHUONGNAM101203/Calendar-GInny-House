# Technology Stack

**Analysis Date:** 2026-08-04

## Languages

**Primary:**
- TypeScript 5.x (strict mode) - entire app (`app/`, `actions/`, `components/`, `lib/`, `hooks/`, `types/`)
- SQL (PostgreSQL dialect) - Supabase schema and RLS policies in `supabase/migrations/`

**Secondary:**
- CSS (Tailwind v4 syntax) - `app/globals.css`

## Runtime

**Environment:**
- Node.js v22.16.0 (local dev machine; no `.nvmrc`/`.node-version` file committed — pin is implicit)
- Next.js 16.2.9, App Router, **Turbopack** is the default dev/build bundler in this Next.js version (no separate `--turbo` flag needed)

**Package Manager:**
- npm (lockfile: `package-lock.json` present)

## Frameworks

**Core:**
- Next.js 16.2.9 - App Router, React Server Components, Server Actions (`"use server"` files in `actions/`)
- React 19.2.4 / React DOM 19.2.4

**IMPORTANT — non-standard Next.js conventions in this repo:**
This project pins a Next.js version whose conventions diverge from typical training-data knowledge (per `AGENTS.md` at repo root: "This is NOT the Next.js you know"). Confirmed divergence found during mapping:
- **`proxy.ts`** (repo root) replaces the traditional `middleware.ts` file convention. It exports a `proxy()` function (not `middleware()`) and delegates to `lib/supabase/proxy.ts`. Reference docs exist at `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` and `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md` — consult these before modifying request-interception logic.
- Before writing any new Next.js-specific code (routing, data fetching, caching, server actions, config), check `node_modules/next/dist/docs/` for the relevant guide rather than relying on prior Next.js knowledge.

**UI Component System:**
- shadcn/ui (`shadcn` package ^4.12.0, CLI-driven; component source lives in `components/ui/`)
- `components.json` - style: `radix-nova`, baseColor: `neutral`, iconLibrary: `lucide`, RSC: true, CSS variables enabled, no Tailwind prefix
- radix-ui ^1.6.0 (consolidated Radix primitives package, not individual `@radix-ui/react-*` packages)
- lucide-react ^1.21.0 - icon set
- next-themes ^0.4.6 - dark/light theme provider (`components/theme-provider.tsx` used in `app/layout.tsx`)
- sonner ^2.0.7 - toast notifications (`components/ui/sonner.tsx`, mounted in root layout)

**Forms & Validation:**
- react-hook-form ^7.80.0
- zod ^4.4.3 - schemas in `lib/validations/`
- @hookform/resolvers ^5.4.0 - connects zod schemas to react-hook-form

**Data Visualization / Scheduling UI:**
- react-big-calendar ^1.20.0 (+ `@types/react-big-calendar`) - core calendar UI in `components/calendar/`; CSS imported via `app/globals.css` (`react-big-calendar/lib/css/react-big-calendar.css`); registered in `next.config.ts` as `serverExternalPackages: ["react-big-calendar"]` (excluded from server bundling since it's a browser-only lib)
- recharts ^3.10.1 - charts, likely attendance/reporting views (`components/attendance/`, `components/manager/`)

**Styling:**
- Tailwind CSS v4 (`@tailwindcss/postcss` plugin, no separate `tailwind.config.*` — v4 uses CSS-first config via `@theme` in `app/globals.css`)
- tw-animate-css ^1.4.0 - animation utility classes
- class-variance-authority ^0.7.1 + clsx ^2.1.1 + tailwind-merge ^3.6.0 - the standard shadcn `cn()` utility stack (`lib/utils.ts` expected)
- shadcn's own base CSS imported directly: `@import "shadcn/tailwind.css"` in `app/globals.css`

**Fonts:**
- next/font/google: Fraunces (display/heading, weights 500/600) and Be_Vietnam_Pro (body, weights 400/500/600), both with `vietnamese` + `latin` subsets — loaded in `app/layout.tsx`. Only used weights are requested (documented rationale inline in that file and in `DESIGN.md`).

**Dates:**
- date-fns ^4.4.0

**Testing:**
- Not detected. No test runner, test config, or `*.test.*`/`*.spec.*` files found in the repo.

**Build/Dev:**
- Turbopack (Next.js 16 built-in bundler)
- ESLint 9 (flat config) - `eslint.config.mjs`, extends `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
- No Prettier config detected

## Key Dependencies

**Critical:**
- `@supabase/supabase-js` ^2.108.2 - Supabase JS client (used directly for admin/public clients)
- `@supabase/ssr` ^0.12.0 - cookie-aware SSR client creation for browser/server contexts and the `proxy.ts` session refresh flow
- `zod` ^4.4.3 - runtime validation boundary for all Server Actions (`lib/validations/`, consumed in `actions/*.ts`)

**Infrastructure:**
- Supabase Postgres - system of record (schema in `supabase/migrations/`)
- Supabase Auth (GoTrue) - authentication (email/password), used via `supabase.auth.*` in `actions/auth.ts`

## Configuration

**Environment:**
- Loaded via standard Next.js `.env.local` (present, not committed — gitignored) and `.env.sample` (committed template) at repo root.
- Required variables (from `.env.sample`):
  - `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL (public)
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon/public key (public, RLS-enforced)
  - `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (server-only, bypasses RLS — used only in `lib/supabase/admin.ts`)
  - `NEXT_PUBLIC_APP_URL` - app base URL (defaults to `http://localhost:3000` in the sample)
- `.env.local` file exists locally but its contents were not read (forbidden per security policy) — existence noted only.

**Build:**
- `next.config.ts` - minimal config; only sets `serverExternalPackages: ["react-big-calendar"]`
- `tsconfig.json` - `strict: true`, target ES2017, `moduleResolution: "bundler"`, path alias `@/*` → repo root, Next.js TS plugin enabled
- `postcss.config.mjs` - single plugin `@tailwindcss/postcss`
- `components.json` - shadcn/ui codegen config (see Frameworks section)

## Platform Requirements

**Development:**
- Node.js (v22.x confirmed on the mapping machine; no explicit engines/version pin committed to the repo)
- npm with `package-lock.json`
- Supabase CLI project linked locally (`supabase/.temp/` contains `linked-project.json`, `project-ref`, `pooler-url`, and version-pin files for `gotrue`, `postgres`, `rest`, `storage` — indicates active `supabase link`/`supabase db` CLI usage for this project)

**Production:**
- Deployment target: not explicitly declared in-repo (no `vercel.json`, Dockerfile, or CI config found). Given Next.js + Supabase stack, Vercel is the conventional target but this is inferred, not confirmed.

---

*Stack analysis: 2026-08-04*
