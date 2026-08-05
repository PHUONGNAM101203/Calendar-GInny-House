# Ginny House Calendar — UI Modernization

## What This Is

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

## Core Value

Every remaining screen should feel as considered and "on-brand" as the
calendar and manager dashboard already are — nothing left should read as
default shadcn scaffolding.

## Requirements

### Validated

<!-- Shipped and confirmed working — inferred from the existing codebase. -->

- ✓ Role-based shift creation vs. registration, shift swaps, leave requests, attendance — full business logic, `actions/*.ts` + Supabase RLS
- ✓ Calendar UI (`/calendar`, `components/calendar/*`) — Google-Calendar-style shell, per-person follow colors, custom calendars, holiday overlay — **locked, out of scope for this project**
- ✓ Manager dashboard (`components/manager/ManagerDashboard.tsx`, `TechnicalDashboard.tsx`) — redesigned in a prior session: tone-accented stat cards, real recharts (area chart w/ peak callout, role pie, horizontal bar), single-scroll grid layout (tabs removed). **Will be revisited under the new direction from this project (see Active) — not re-locked.**
- ✓ Login/Register (`components/auth/*`) — redesigned in a prior session: icon-in-field inputs, frosted glass card over a two-blob glow on the navy brand panel. **Will be revisited under the new direction from this project (see Active) — not re-locked.**
- ✓ Design system documented in `DESIGN.md` — OKLCH navy/gold/sage palette, Fraunces (display) + Be Vietnam Pro (body) + JetBrains Mono (data/captions), soft-tint badge convention

### Active

<!-- Current scope for this UI modernization project. -->

- [ ] Propose a brand-new visual direction (palette/style), not constrained to matching the existing Dashboard/Login redesigns — presented to the user for approval before implementation
- [ ] Back-apply the approved new direction to the already-redesigned Dashboard (`ManagerDashboard.tsx`, `TechnicalDashboard.tsx`) and Login/Register (`components/auth/*`) so the whole app is visually consistent under one direction
- [ ] Nghỉ phép (leave) — `LeaveRequestCard`, `LeaveRequestDialog` — modernize card/form visuals
- [ ] Đổi ca (swap) — `SwapRequestCard`, `SwapRequestDialog` — modernize card/form visuals
- [ ] Đăng ký ca (shift request) — `ShiftRequestCard.tsx` — structurally identical to the leave/swap cards; folded into the same request-card pattern work for consistency
- [ ] Bảng nhân viên — `StaffTable.tsx` — modernize the roster/role/branch-editing table
- [ ] Tài khoản — `AccountForm.tsx` — modernize
- [ ] Thông báo — `NotificationsBell.tsx` dropdown — modernize
- [ ] Sweep any remaining non-calendar screens/components not explicitly listed above
- [ ] Small, justified UX improvements are allowed alongside restyling (e.g. better empty states, small interaction polish) — not a hard "visual-only" constraint, but not a feature-expansion project either

### Out of Scope

- `/calendar` and everything under `components/calendar/*` — already redesigned in a prior session, explicitly locked, do not touch
- New business features unrelated to visual/UX polish (new role types, new request types, new integrations) — this project is scoped to modernizing existing screens, not adding new domains
- Automated test suite — `TESTING.md` confirms none exists; out of scope unless the user opens a separate project for it

## Context

- Brownfield app, actively used, many rapid iterative feature passes already shipped (see `.planning/codebase/` — mapped 2026-08-04).
- Existing design identity (`DESIGN.md`) is deliberate and well-reasoned (navy sampled from the real logo file, Vietnamese-subset Google Fonts, soft-tint badges) — a new direction should *extend* this system's rigor, not necessarily its exact palette, since the user is open to a new look for the remaining screens.
- The user has previously reacted concretely to visual references (a Shopify-style dense analytics dashboard, a pastel medical dashboard, a navy split-panel auth screen) and each time asked for the underlying *structural/interaction* idea (chart style, spacing, icon density) rather than a literal copy — any new direction should be presented as a proposal before implementation, same pattern.
- `CONCERNS.md` (codebase map) flags real, unrelated tech debt (missing tests, unchecked Supabase query errors, duplicated role logic between `lib/roles.ts` and SQL) — noted for awareness, not blocking this UI project.

## Constraints

- **Tech stack**: Must stay within existing Next.js 16 App Router + Tailwind + shadcn/ui + Supabase stack — no new UI framework.
- **Locked surface**: `/calendar` route and its components must not be modified by this project.
- **Language**: All UI copy is Vietnamese; keep existing tone/labels unless a screen is being meaningfully rewritten.
- **Verification**: No test suite exists — every phase must be manually verified via `tsc --noEmit`, `eslint`, and a real dev-server check before being considered done.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Scope excludes `/calendar` | User explicitly locked it after a prior redesign session | ✓ Good |
| New visual direction to be proposed by Claude, not pre-specified | User was open-ended ("hướng mới") and asked Claude to propose | — Pending |
| Restyle-first, small UX features allowed if justified | User's own framing — not a strict "no logic changes" project | — Pending |
| New direction back-applied to already-redone Dashboard/Login too | Research flagged cross-screen visual drift as a real risk; user chose full consistency over leaving 2 screens on the old direction | — Pending |
| `ShiftRequestCard` folded into the request-card phase | Structurally identical to Leave/Swap cards; research recommended pulling it forward given near-zero marginal cost | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-04 after project initialization (brownfield, informed by `.planning/codebase/` map)*
