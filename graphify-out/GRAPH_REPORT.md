# Graph Report - Calendar-GInny-House  (2026-08-08)

## Corpus Check
- 199 files · ~108,410 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1087 nodes · 2604 edges · 107 communities (65 shown, 42 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 23 edges (avg confidence: 0.69)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b3ef1aef`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- dialog.tsx
- ShiftCalendar.tsx
- Project Docs & Conventions
- roles.ts
- createClient
- CalendarSidebar.tsx
- RegisterForm.tsx
- Manager Group Scoping
- cn
- TypeScript Config
- actions/attendance.ts
- Initial Database Schema
- shadcn Component Config
- AppHeader.tsx
- Dev Dependencies
- lib/auth.ts
- ShiftFormDialog.tsx
- Runtime Dependencies
- ShiftRequestDialog.tsx
- shift-requests.ts
- shifts.ts
- calendar/page.tsx
- lib/push.ts
- Route Loading Skeletons
- button.tsx
- app/layout.tsx
- PWA Manifest
- swaps.ts
- Package Manifest
- Student Affairs Slot Rule
- Leave Requests Schema
- HR Group Shift Approvals
- Attendance Corrections Schema
- useIsMobile
- Attendance Clock Schema
- Shift Requests Schema
- Auth Proxy Middleware
- Group Scoped Visibility
- Branch Membership Visibility
- Shift Type Migration
- Explicit Shift Branch
- Profile Branches Table
- Roster Visibility Helper
- 0044_shift_and_swap_approval_scoping.sql
- Brand Icon Assets
- Status Cast Fix
- Custom Calendars Schema
- Swap Branch Check Fix
- Shared Branch Fix
- Role Hierarchy Migration
- Calendar Follows Table
- Leave Request Types
- Student Affairs Visibility
- Branch Color Overrides
- Shift Request Status Cast
- Calendar Visibility Roles
- Clock-In Shift Window
- Auto Checkout Expired Shifts
- Attendance Manage Permissions
- Push Subscriptions Table
- clsx Utility
- ESLint Config
- Hook Form Resolvers
- Next.js Framework
- Next.js Config
- Radix UI Primitives
- React Library
- React Big Calendar
- Recharts Library
- shadcn CLI
- Supabase SSR Client
- Supabase JS Client
- Tailwind Animate CSS
- Web Push Library
- PostCSS Config
- Attendance Table
- Leave Requests Table
- Profiles Table
- Leave Requests Table
- Calendar Follows Table
- Calendar Follows Table
- Profiles Table
- Calendar Follows Table
- Shifts Table
- Profiles Table Schema
- CalendarDayHeader.tsx
- public.can_manage_shift_for
- index.ts

## God Nodes (most connected - your core abstractions)
1. `cn()` - 111 edges
2. `createClient()` - 64 edges
3. `requireProfile()` - 57 edges
4. `Button()` - 37 edges
5. `ShiftCalendar()` - 25 edges
6. `resolveColor()` - 22 edges
7. `isManagerRole()` - 19 edges
8. `DESIGN.md — Ginny House Design System` - 19 edges
9. `Profile` - 18 edges
10. `Role` - 16 edges

## Surprising Connections (you probably didn't know these)
- `BandStat()` --calls--> `cn()`  [EXTRACTED]
  components/manager/ManagerDashboard.tsx → lib/utils.ts
- `QueueRow()` --calls--> `cn()`  [EXTRACTED]
  components/manager/ManagerDashboard.tsx → lib/utils.ts
- `CustomEventDetailDialog()` --calls--> `resolveColor()`  [EXTRACTED]
  components/calendar/CustomEventDetailDialog.tsx → lib/calendar.ts
- `ShiftRequestDetailDialog()` --calls--> `resolveColor()`  [EXTRACTED]
  components/calendar/ShiftRequestDetailDialog.tsx → lib/calendar.ts
- `AccountPage()` --calls--> `requireProfile()`  [EXTRACTED]
  app/(app)/account/page.tsx → lib/auth.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Giải trình công end-to-end feature flow (migration → types → actions → UI → notifications)** — docs_superpowers_plans_2026_08_06_attendance_correction_task1_migration, docs_superpowers_plans_2026_08_06_attendance_correction_types, docs_superpowers_plans_2026_08_06_attendance_correction_actions, docs_superpowers_plans_2026_08_06_attendance_correction_card, docs_superpowers_plans_2026_08_06_attendance_correction_form_route, docs_superpowers_plans_2026_08_06_attendance_correction_manager_section, docs_superpowers_plans_2026_08_06_attendance_correction_notifications [EXTRACTED 0.95]
- **Multi-branch cutover: backfill → RLS rewrite → RPC → type flip → UI surfaces → drop legacy column** — docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_backfill, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_rls, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_set_profile_branches, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_profile_type, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_multiselect, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_stafftable, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_register, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_drop_column [EXTRACTED 0.95]
- **Design token system shared by every on-brand surface** — design_color_tokens, design_typography, design_soft_tint_badges, design_per_person_color, design_reuse_checklist, app_icon [EXTRACTED 0.90]
- **Group-scoped manager dashboard: RLS policies + roles helper + page filter + copy map** — docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_getviewablegrouproles, docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_profiles_select_branch, docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_swaps_select_branch, docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_can_view_profile, docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_manager_page, docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_manager_group_meta, docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_defense_in_depth [EXTRACTED 0.90]
- **Single branch_id → profile_branches membership cutover (data, RPC, RLS, UI)** — docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_profile_branches, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_is_branch_member, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_current_branch_id, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_profiles_branch_id, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_set_profile_branches, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_handle_new_user, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_cutover_sequencing [EXTRACTED 0.90]
- **Multi-branch picker UI surface across register, staff table, and shift dialogs** — docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_multiselectbranches, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_registerform, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_stafftable, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_shiftformdialog, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_shiftrequestdialog, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_management_tier_exemption [EXTRACTED 0.85]

## Communities (107 total, 42 thin omitted)

### Community 0 - "dialog.tsx"
Cohesion: 0.12
Nodes (27): ColorPickerDialog(), CustomEventDetailDialog(), CustomEventFormDialog(), endDateTouched(), formatRange(), formatTimeOfDay(), LeaveDetailDialog(), TYPE_ICON (+19 more)

### Community 1 - "ShiftCalendar.tsx"
Cohesion: 0.08
Nodes (42): CalendarMobileMenu(), CalendarSidebar(), PendingApprovalItem, VIEW_LABELS, maxTime, minTime, ShiftCalendar(), LEAVE_ICON (+34 more)

### Community 2 - "Project Docs & Conventions"
Cohesion: 0.05
Nodes (73): AGENTS.md — Next.js Agent Rules, App Favicon — navy square with white line-art house/shield + book-ribbon mark, CLAUDE.md — Project Instructions, ActionResult<T> Discriminated Union, Architecture Overview, "use client" / "use server" Boundaries, Conventions (naming, code style, imports), Dual Source of Truth: lib/roles.ts ↔ SQL migrations (+65 more)

### Community 3 - "roles.ts"
Cohesion: 0.09
Nodes (33): LeavePage(), ManagerPage(), AttendanceDetailDialog(), formatMinutes(), CALENDAR_COLLABORATOR_ONLY, CALENDAR_MANAGEMENT_ROLES, CALENDAR_STUDENT_AFFAIRS_ONLY, CALENDAR_TEACHER_ONLY (+25 more)

### Community 4 - "createClient"
Cohesion: 0.19
Nodes (21): AttendanceCorrectionsBatchResult, cancelAttendanceCorrectionAction(), getAttendanceCorrectionPreviewAction(), mapAttendanceCorrectionError(), requestAttendanceCorrectionsAction(), respondToAttendanceCorrectionAction(), revalidateAttendanceCorrectionPaths(), createCustomEventAction() (+13 more)

### Community 5 - "CalendarSidebar.tsx"
Cohesion: 0.10
Nodes (32): isValidColor(), updateBranchColorAction(), VALID_COLORS, followGroupAction(), followPersonAction(), isValidColor(), unfollowGroupAction(), unfollowPersonAction() (+24 more)

### Community 6 - "RegisterForm.tsx"
Cohesion: 0.05
Nodes (53): CorrectionPreview, mapSignUpError(), signInAction(), signUpAction(), AccountPage(), AccountForm(), AttendanceCorrectionCard(), ISSUE_ICON (+45 more)

### Community 7 - "Manager Group Scoping"
Cohesion: 0.08
Nodes (34): Manager Dashboard Group Scoping — Design Spec, can_view_profile() RLS helper, Defense-in-depth: RLS outer boundary + app-level filter, getViewableGroupRoles(), HR_GROUP_ROLES (HR group), is_manager() RLS bypass, MANAGER_GROUP_META copy map, app/(app)/manager/page.tsx — scoped fetch layer (+26 more)

### Community 8 - "cn"
Cohesion: 0.10
Nodes (26): BRANCHES, Chip(), DAY_MOMENTS, HeroBoard(), LandingPage(), metadata, Reveal(), TiltCard() (+18 more)

### Community 9 - "TypeScript Config"
Cohesion: 0.07
Nodes (28): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules (+20 more)

### Community 10 - "actions/attendance.ts"
Cohesion: 0.23
Nodes (13): canCurrentUserManageAttendanceRow(), clockInAction(), clockOutAction(), deleteAttendanceAction(), mapAttendanceError(), revalidateAttendanceManagePaths(), updateAttendanceAction(), ClockInGate (+5 more)

### Community 11 - "Initial Database Schema"
Cohesion: 0.11
Nodes (19): auth.users, public, public.handle_new_user, public.protect_profile_privileges, public.sync_shift_branch, on_auth_user_created, profiles_protect_privileges, profiles_set_updated_at (+11 more)

### Community 12 - "shadcn Component Config"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 13 - "AppHeader.tsx"
Cohesion: 0.07
Nodes (33): signOutAction(), AuthIllustration(), BACK_CELLS, FRONT_CELLS, BrandMark(), noopSubscribe(), useMounted(), PendingApprovalRow() (+25 more)

### Community 14 - "Dev Dependencies"
Cohesion: 0.10
Nodes (21): eslint, eslint-config-next, devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node (+13 more)

### Community 15 - "lib/auth.ts"
Cohesion: 0.35
Nodes (7): EmptyState(), PageHeader(), SectionHeading(), LeaveRequestDialog(), ensureProfile(), ProfileRow, toProfile()

### Community 16 - "ShiftFormDialog.tsx"
Cohesion: 0.22
Nodes (14): formSchema, FormValues, ShiftFormDialog(), ShiftRequestDialog(), AlertDialog(), AlertDialogAction(), AlertDialogCancel(), AlertDialogContent() (+6 more)

### Community 17 - "Runtime Dependencies"
Cohesion: 0.11
Nodes (19): class-variance-authority, date-fns, lucide-react, next-themes, dependencies, class-variance-authority, date-fns, lucide-react (+11 more)

### Community 18 - "ShiftRequestDialog.tsx"
Cohesion: 0.25
Nodes (13): formatMinutes(), StaffAttendanceDetailDialog(), StaffRow, formatRange(), SwapRequestDialog(), Select(), SelectContent(), SelectItem() (+5 more)

### Community 19 - "shift-requests.ts"
Cohesion: 0.29
Nodes (11): cancelShiftRequestAction(), mapShiftRequestError(), mapShiftRpcError(), requestShiftAction(), respondToShiftRequestAction(), revalidateShiftRequestPaths(), SHIFT_RPC_MESSAGES, formatRange() (+3 more)

### Community 20 - "shifts.ts"
Cohesion: 0.19
Nodes (14): assertAssigneeAllowed(), createShiftAction(), deleteShiftAction(), mapShiftError(), updateShiftAction(), updateStaffBranchesAction(), updateStaffRoleAction(), RoleAndBranchCells() (+6 more)

### Community 21 - "calendar/page.tsx"
Cohesion: 0.19
Nodes (13): RegisterPage(), RegisterForm(), ShiftCalendar, ShiftCalendarLoader(), getBranches, AttendanceWithProfileRole, CalendarView, LeaveRequestWithRole (+5 more)

### Community 22 - "lib/push.ts"
Cohesion: 0.15
Nodes (19): cancelLeaveRequestAction(), mapLeaveError(), requestLeaveAction(), respondToLeaveRequestAction(), revalidateLeavePaths(), configured, LEAVE_APPROVER_CANDIDATE_ROLES, PushPayload (+11 more)

### Community 24 - "button.tsx"
Cohesion: 0.13
Nodes (19): MiniMonth(), WEEKDAY_LABELS, MobileDayStrip(), VIEW_LABELS, WEEKDAY_LABELS, APPS, TYPE_OPTIONS, Badge() (+11 more)

### Community 25 - "app/layout.tsx"
Cohesion: 0.28
Nodes (5): barlow, metadata, viewport, ThemeProvider(), Toaster()

### Community 26 - "PWA Manifest"
Cohesion: 0.20
Nodes (9): background_color, description, display, icons, lang, name, short_name, start_url (+1 more)

### Community 27 - "swaps.ts"
Cohesion: 0.42
Nodes (7): cancelSwapRequestAction(), createSwapRequestAction(), mapSwapError(), respondToSwapRequestAction(), revalidateSwapPaths(), SwapRequestInput, swapRequestSchema

### Community 28 - "Package Manifest"
Cohesion: 0.22
Nodes (8): name, private, scripts, build, dev, lint, start, version

### Community 29 - "Student Affairs Slot Rule"
Cohesion: 0.25
Nodes (7): public.enforce_student_affairs_single_slot, public.enforce_student_affairs_single_slot(), public.student_affairs_slot_taken(), public.profiles, public.shift_requests, public.shifts, trg_student_affairs_single_slot

### Community 30 - "Leave Requests Schema"
Cohesion: 0.25
Nodes (6): leave_requests_set_updated_at, public.leave_requests, public.request_leave(), public.branches, public.profiles, public.set_updated_at

### Community 31 - "HR Group Shift Approvals"
Cohesion: 0.36
Nodes (7): public.can_approve_shift_request(), public.can_view_profile(), public.cancel_shift_request(), public.is_leave_approver(), public.respond_to_shift_request(), public.profiles, public.shift_requests

### Community 32 - "Attendance Corrections Schema"
Cohesion: 0.36
Nodes (5): public.attendance_corrections, public.request_attendance_correction(), public.attendance, public.profiles, public.shifts

### Community 33 - "useIsMobile"
Cohesion: 0.70
Nodes (4): getServerSnapshot(), getSnapshot(), subscribe(), useIsMobile()

### Community 34 - "Attendance Clock Schema"
Cohesion: 0.38
Nodes (5): public.attendance, public.clock_in(), public.branches, public.profiles, public.shifts

### Community 35 - "Shift Requests Schema"
Cohesion: 0.33
Nodes (3): public.is_ceo(), public.is_shift_manager(), public.profiles

### Community 36 - "Auth Proxy Middleware"
Cohesion: 0.53
Nodes (4): PUBLIC_PATHS, updateSession(), config, proxy()

### Community 38 - "Group Scoped Visibility"
Cohesion: 0.47
Nodes (5): public.can_view_profile(), public.is_leave_approver(), public.respond_to_leave_request(), public.leave_requests, public.profiles

### Community 39 - "Branch Membership Visibility"
Cohesion: 0.33
Nodes (4): public.is_visible_via_roster(), public.attendance, public.shift_swap_requests, public.shifts

### Community 41 - "Shift Type Migration"
Cohesion: 0.40
Nodes (4): public.request_shift(), public.respond_to_shift_request(), public.profiles, public.shift_requests

### Community 43 - "Profile Branches Table"
Cohesion: 0.50
Nodes (4): public.is_branch_member(), public.profile_branches, public.branches, public.profiles

### Community 44 - "Roster Visibility Helper"
Cohesion: 0.40
Nodes (4): public.is_visible_via_roster(), public.attendance, public.shift_swap_requests, public.shifts

### Community 45 - "0044_shift_and_swap_approval_scoping.sql"
Cohesion: 0.25
Nodes (7): public.shift_swap_requests, public.shifts, public.can_approve_shift_request(), public.can_approve_swap_request(), public.respond_to_swap_request(), public.profiles, public.auto_checkout_expired_shifts()

### Community 46 - "Brand Icon Assets"
Cohesion: 0.50
Nodes (4): Ginny House navy icon mark (no wordmark), Ginny House square app icon (512px, navy on white), Ginny House white/knockout icon variant for dark backgrounds, Ginny House full logo — navy outlined house/shield mark with wordmark

### Community 48 - "Custom Calendars Schema"
Cohesion: 0.67
Nodes (3): public.custom_calendars, public.custom_events, public.profiles

### Community 50 - "Swap Branch Check Fix"
Cohesion: 0.50
Nodes (3): public.respond_to_swap_request(), public.shift_swap_requests, public.shifts

### Community 109 - "index.ts"
Cohesion: 0.07
Nodes (55): AppShellLayout(), ProfileRoleRef, AttendanceHistory(), formatDuration(), BandStat(), ManagerDashboard(), QueueRow(), normalizeForSearch() (+47 more)

## Ambiguous Edges - Review These
- `Technology Stack (Next.js 16 + Supabase + Tailwind v4)` → `README.md — create-next-app Boilerplate`  [AMBIGUOUS]
  README.md · relation: conceptually_related_to
- `Task 3: set_profile_branches RPC + handle_new_user + request_leave` → `Shift type auto-detection boundaries (<12 / 12-17 / ≥17)`  [AMBIGUOUS]
  docs/superpowers/plans/2026-08-07-multi-branch-staff-cutover.md · relation: shares_data_with
- `Manager Dashboard Group Scoping — Design Spec` → `Multi-Branch Staff — Cutover Design Spec`  [AMBIGUOUS]
  docs/superpowers/specs/2026-08-07-multi-branch-staff-cutover-design.md · relation: conceptually_related_to
- `profiles_select_branch RLS policy` → `profiles.branch_id single-branch column (dropped)`  [AMBIGUOUS]
  docs/superpowers/specs/2026-08-07-multi-branch-staff-cutover-design.md · relation: shares_data_with
- `app/(app)/manager/page.tsx — scoped fetch layer` → `StaffTable.tsx branch cell`  [AMBIGUOUS]
  docs/superpowers/specs/2026-08-07-multi-branch-staff-cutover-design.md · relation: conceptually_related_to

## Knowledge Gaps
- **189 isolated node(s):** `minTime`, `maxTime`, `ShiftCalendar`, `metadata`, `DAY_MOMENTS` (+184 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **42 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Technology Stack (Next.js 16 + Supabase + Tailwind v4)` and `README.md — create-next-app Boilerplate`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Task 3: set_profile_branches RPC + handle_new_user + request_leave` and `Shift type auto-detection boundaries (<12 / 12-17 / ≥17)`?**
  _Edge tagged AMBIGUOUS (relation: shares_data_with) - confidence is low._
- **What is the exact relationship between `Manager Dashboard Group Scoping — Design Spec` and `Multi-Branch Staff — Cutover Design Spec`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `profiles_select_branch RLS policy` and `profiles.branch_id single-branch column (dropped)`?**
  _Edge tagged AMBIGUOUS (relation: shares_data_with) - confidence is low._
- **What is the exact relationship between `app/(app)/manager/page.tsx — scoped fetch layer` and `StaffTable.tsx branch cell`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `cn()` connect `cn` to `dialog.tsx`, `ShiftCalendar.tsx`, `RegisterForm.tsx`, `index.ts`, `AppHeader.tsx`, `lib/auth.ts`, `ShiftFormDialog.tsx`, `ShiftRequestDialog.tsx`, `Route Loading Skeletons`, `button.tsx`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **Why does `Button()` connect `button.tsx` to `dialog.tsx`, `ShiftCalendar.tsx`, `CalendarSidebar.tsx`, `RegisterForm.tsx`, `cn`, `actions/attendance.ts`, `AppHeader.tsx`, `ShiftFormDialog.tsx`, `ShiftRequestDialog.tsx`, `shift-requests.ts`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._