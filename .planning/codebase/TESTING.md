# Testing Patterns

**Analysis Date:** 2026-08-04

## Test Framework

**Status: No test suite or testing framework is configured in this codebase.**

This is stated plainly and should not be papered over: there is no Jest, Vitest, Playwright, Cypress, or any other test runner installed. Confirmed by:

- `package.json` has no test-related dependency (no `jest`, `vitest`, `@testing-library/*`, `playwright`, `cypress`, `supertest`, etc. in either `dependencies` or `devDependencies`).
- `package.json` scripts are limited to `dev`, `build`, `start`, `lint` — there is no `test` script.
- No `jest.config.*`, `vitest.config.*`, `playwright.config.*`, or `cypress.config.*` file exists anywhere in the repo.
- No `*.test.ts`, `*.test.tsx`, `*.spec.ts`, or `*.spec.tsx` files exist anywhere under the repo (excluding `node_modules`).
- No `__tests__/` or `tests/` directory exists.

**Runner:** None.

**Assertion Library:** None.

**Run Commands:**
```bash
npm run dev     # Start dev server (Next.js 16, Turbopack)
npm run build   # Production build
npm run start   # Start production server
npm run lint    # eslint (flat config, eslint-config-next core-web-vitals + typescript)
```
There is no `npm run test` / `npm test` command. `npm run lint` is currently the only automated code-quality check in this repository — it performs static linting, not runtime testing.

## Test File Organization

Not applicable — no tests exist to establish a convention for location or naming.

## Test Structure

Not applicable.

## Mocking

Not applicable — no mocking library (`jest.mock`, `vi.mock`, `msw`, etc.) is present or used.

## Fixtures and Factories

Not applicable — no test fixtures or factory functions exist. Seed/reference data that does exist is production seed data for Supabase, not test fixtures: see `supabase/migrations/0001_init.sql` (branch seed rows referenced in `DESIGN.md`'s color-token table) and other files under `supabase/migrations/`.

## Coverage

**Requirements:** None enforced — there is no coverage tool configured and no CI pipeline found that would run one. Do not report or assume any coverage percentage; there is nothing to measure.

**View Coverage:**
Not applicable.

## Test Types

**Unit Tests:** None present.

**Integration Tests:** None present.

**E2E Tests:** None present. Given the app is a Next.js Server Actions + Supabase RLS/RPC architecture (see `CONVENTIONS.md` for the `ActionResult<T>` pattern), an E2E framework like Playwright would be the most direct way to validate the auth → RLS → RPC → revalidate flow end-to-end if a suite is introduced later, since a large share of business logic lives in Postgres functions (`supabase/migrations/`) rather than in testable pure TypeScript.

## Manual/Alternative Verification

In the absence of automated tests, the project currently relies on:

- **TypeScript strict mode** (`tsconfig.json`: `"strict": true`) to catch type errors at compile time (`next build` / editor).
- **ESLint** (`eslint.config.mjs`, `eslint-config-next` core-web-vitals + typescript configs) via `npm run lint` to catch common React/Next.js correctness issues.
- **Postgres-level constraints and RLS policies** (`supabase/migrations/`) enforcing data integrity and authorization rules that would otherwise need integration-test coverage — e.g. `can_view_profile()` referenced in `app/(app)/leave/page.tsx`'s query comment.
- **Zod schema validation** (`lib/validations/*.ts`) providing runtime input validation as a substitute for (not equivalent to) input-handling unit tests.

## Recommendations for Introducing Tests

If a test suite is added to this codebase in a future phase, align it with existing conventions rather than introducing new patterns:

- **Framework choice**: Vitest is the lower-friction choice given Next.js 16 + Turbopack + no existing Jest config to migrate; Playwright for E2E given the Server Actions + Supabase RLS architecture is hard to unit-test meaningfully in isolation.
- **Priority targets**: `lib/validations/*.ts` (pure Zod schemas — easiest, highest-value unit tests, no mocking needed), `lib/roles.ts` and `lib/calendar.ts` (pure logic helpers), then `actions/*.ts` error-mapping functions (`mapLeaveError`, `mapSignUpError` — pure string-matching functions, easy to unit test in isolation from Supabase).
- **Naming**: follow the existing file-naming convention from `CONVENTIONS.md` — colocate as `<name>.test.ts` next to the module under test (e.g. `lib/validations/leave.test.ts`) rather than a separate `__tests__/` tree, to match this repo's otherwise flat, colocated file organization.

---

*Testing analysis: 2026-08-04*
