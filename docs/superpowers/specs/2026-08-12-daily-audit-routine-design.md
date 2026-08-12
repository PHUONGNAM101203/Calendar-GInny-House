# Spec: Daily Production Audit Routine

## Context

The app has no monitoring today — no error tracking, no performance
baseline, no recurring health check. The user wants a routine that runs
every day, crawls the live production site (both public and logged-in
pages), flags errors and slow pages, and leaves a report the user can read
without hunting for it — report-only, no auto-fix, so every change to the
app still goes through a normal reviewed session.

This is implemented as a **claude.ai cloud routine** (via the `schedule`
skill / `RemoteTrigger` API), not application code — it is a fully
independent cloud session on a cron schedule, isolated from this repo's
runtime. The only application code involved is what keeps the routine's
dedicated login account out of the real staff data.

## Decisions already made with the user

- Report-only: the routine never edits app code or opens a PR for fixes.
  Found issues get triaged in a normal session later.
- Report delivery: a dated Markdown file committed straight to `main`.
- Authenticated-page coverage: yes, via a dedicated monitoring account —
  most of the app requires login, and a public-pages-only audit would
  miss the pages staff actually use daily.
- Schedule: 08:30 Asia/Saigon daily → `30 1 * * *` UTC.

## 1. Monitoring account

One permanent Supabase Auth user, created once (not by the routine):
- `full_name`: `"🔍 Giám sát hệ thống (đừng xoá)"` — self-explanatory if a
  manager ever sees it despite the exclusions below.
- `role`: `technical` (closest existing semantic fit — read-only/analytics
  role already exists in the 10-value `staff_role` enum) — the value
  barely matters since it's excluded from every listing that would act on
  role, but a role must be set (not nullable).
- No `profile_branches` rows — same convention already used for
  management-tier accounts that aren't scoped to one branch.
- Credentials generated once, stored in the routine's prompt config (see
  §4) — this is the only place they live, since cloud routines cannot
  read `.env.local` or any other local secret.

### Schema change: `profiles.is_monitoring_account`

`supabase/migrations/0054_monitoring_account_flag.sql`:

```sql
alter table public.profiles
  add column if not exists is_monitoring_account boolean not null default false;
```

No RLS policy changes needed — existing policies aren't column-scoped.

### Exclusion call sites

Add `.eq("is_monitoring_account", false)` to the three queries that build
staff-facing lists a manager actually looks at:

| File | Query | Why |
|---|---|---|
| `app/(app)/manager/page.tsx` | `staffList` select (~line 120) | Feeds `StaffTable`, `StaffOverviewTable`, `RequestsOverviewTable` |
| `lib/attendance.ts` | `aggregateStaffByRole` input / its caller's select | Feeds `TechnicalDashboard`'s role pie chart — an uncounted extra role would visibly skew it |
| `app/(app)/calendar/page.tsx` | `people` select (~line 103) | Feeds the calendar sidebar's follow-color groups |

`types/index.ts`'s `Profile` type gains `is_monitoring_account: boolean`.

The monitoring account is never assigned shifts, never submits requests,
and the routine's prompt explicitly forbids clicking any create/submit/
approve control — so no RLS/RPC-layer change is needed; `group_permissions`
and the approval RPCs simply never get invoked for this account.

## 2. Pages checked

**Public** (no login): `/`, `/login`, `/register`
**Authenticated** (as the monitoring account): `/calendar`, `/manager`,
`/attendance`, `/leave`, `/swaps`, `/account`

For each: HTTP status code, and any `console.error`/uncaught-exception
events captured during a Playwright page load (navigate, wait for
network-idle, collect console messages — no clicking beyond opening the
page).

## 3. Speed measurement

- **Public `/`**: `npx lighthouse` against the production URL, once with
  `--preset=desktop` and once with the default mobile preset. Report:
  Performance score, LCP, CLS, TBT for each.
- **Authenticated pages**: Lighthouse-through-a-logged-in-session is
  meaningfully harder to wire up reliably in a headless cron job (needs
  the Node API with an authenticated Puppeteer page rather than the CLI).
  Given this only needs to run unattended once a day, the simpler and
  more reliable choice is a Playwright timing measurement per page: TTFB,
  `DOMContentLoaded`, `load`, and LCP (via a short injected
  `PerformanceObserver` script). This is real data on the pages staff
  actually use, but a different metric family than the Lighthouse score —
  the report keeps them in clearly separate sections so they're never
  compared as if equivalent.

## 4. The routine

Created via the `schedule` skill (`RemoteTrigger`, `action: "create"`):

- `cron_expression`: `"30 1 * * *"` (08:30 Asia/Saigon)
- `environment_id`: the "Ginny House" cloud environment
- Repo: `https://github.com/PHUONGNAM101203/Calendar-GInny-House`
- `allowed_tools`: `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep` (needs
  `Bash` for `npx lighthouse`/`playwright` and for `git commit`/`push`)
- The prompt is self-contained (the cloud session starts with zero
  context) and explicitly states:
  - Target URL: `https://calendar-ginny-house.vercel.app`
  - The monitoring account's email/password (only place these are
    stored — see §1)
  - The exact route list from §2, and that only navigation/reading is
    allowed — no form submission, no approve/reject clicks
  - Read yesterday's `docs/audits/YYYY-MM-DD.md` (if present) to compute
    a delta section
  - Write today's report to `docs/audits/YYYY-MM-DD.md` (format below)
  - Commit and push directly to `main` with message
    `chore: daily audit report YYYY-MM-DD` — and touch no other file, add
    no dependency, run no other mutating command

### Report format (`docs/audits/YYYY-MM-DD.md`)

```markdown
# Audit YYYY-MM-DD

## Summary
<N routes checked, M issues flagged>

## Routes
| Route | Status | Console errors |
|---|---|---|
| / | 200 | none |
| ... | ... | ... |

## Lighthouse — / (public)
| | Desktop | Mobile |
|---|---|---|
| Performance | | |
| LCP | | |
| CLS | | |
| TBT | | |

## Authenticated page timing
| Route | TTFB | DOMContentLoaded | Load | LCP |
|---|---|---|---|---|
| /calendar | | | | |
| ... | | | | |

## Flagged issues
- <bullet list, empty if none>

## Vs. yesterday
- <deltas, or "no prior report to compare">
```

## Risks flagged to the user (both accepted)

1. The monitoring account's plaintext password lives in the routine's
   stored config — visible only to whoever can see the user's claude.ai
   routines page.
2. Each run costs ~1–2 minutes installing `lighthouse`/`playwright` fresh
   in the cloud sandbox (routines don't persist a node_modules cache
   between runs) — acceptable for a once-daily job.

## Out of scope (explicitly, per user's own decomposition)

- Any actual performance optimization work on the app — this routine only
  reports; a separate sub-project handles fixes.
- The tablet-matches-mobile UI redesign — a separate sub-project.
- Auto-fix or PR-opening behavior — user chose report-only.

## File changes

- `supabase/migrations/0054_monitoring_account_flag.sql` (new)
- `types/index.ts` — add `is_monitoring_account` to `Profile`
- `app/(app)/manager/page.tsx` — exclude from `staffList` select
- `app/(app)/calendar/page.tsx` — exclude from `people` select
- `lib/attendance.ts` — exclude from `aggregateStaffByRole` input
- One-time: create the monitoring Supabase Auth user + profile row
  (script, not a migration — it's account creation with a real password,
  not schema)
- One-time: create the routine via `RemoteTrigger`
