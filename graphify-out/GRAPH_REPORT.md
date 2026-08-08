# Graph Report - Calendar-GInny-House  (2026-08-08)

## Corpus Check
- 198 files · ~105,801 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1086 nodes · 2602 edges · 115 communities (73 shown, 42 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 23 edges (avg confidence: 0.69)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `15630d70`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- LeaveRequestCard.tsx
- ShiftCalendar.tsx
- Project Docs & Conventions
- roles.ts
- CalendarSidebar.tsx
- createClient
- RegisterForm.tsx
- Manager Group Scoping
- index.ts
- TypeScript Config
- actions/attendance.ts
- Initial Database Schema
- shadcn Component Config
- AppHeader.tsx
- Dev Dependencies
- server.ts
- shifts.ts
- Runtime Dependencies
- cn
- shift-requests.ts
- StaffOverviewTable.tsx
- button.tsx
- lib/push.ts
- Route Loading Skeletons
- SwapRequestDialog.tsx
- Root Layout & Providers
- PWA Manifest
- swaps.ts
- Package Manifest
- Student Affairs Slot Rule
- Leave Requests Schema
- HR Group Shift Approvals
- Attendance Corrections Schema
- AttendanceCorrectionForm.tsx
- Attendance Clock Schema
- Shift Requests Schema
- Auth Proxy Middleware
- Group Scoped Visibility
- Branch Membership Visibility
- MobileDayStrip.tsx
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
- useIsMobile
- ShiftEventCell.tsx
- CalendarDayHeader.tsx
- public.can_manage_shift_for
- lib/attendance.ts
- lib/auth.ts
- ShiftFormDialog.tsx
- ShiftRequestDialog.tsx
- attendance-corrections.ts
- ColorPickerDialog

## God Nodes (most connected - your core abstractions)
1. `cn()` - 109 edges
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
- `AddOtherCalendarMenu()` --calls--> `createCustomCalendarAction()`  [EXTRACTED]
  components/calendar/CalendarSidebar.tsx → actions/custom-calendars.ts
- `unsubscribeFromPushAction()` --calls--> `requireProfile()`  [EXTRACTED]
  actions/push.ts → lib/auth.ts
- `AccountPage()` --calls--> `requireProfile()`  [EXTRACTED]
  app/(app)/account/page.tsx → lib/auth.ts
- `MobileDayStrip()` --calls--> `cn()`  [EXTRACTED]
  components/calendar/MobileDayStrip.tsx → lib/utils.ts
- `BandStat()` --calls--> `cn()`  [EXTRACTED]
  components/manager/ManagerDashboard.tsx → lib/utils.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Giải trình công end-to-end feature flow (migration → types → actions → UI → notifications)** — docs_superpowers_plans_2026_08_06_attendance_correction_task1_migration, docs_superpowers_plans_2026_08_06_attendance_correction_types, docs_superpowers_plans_2026_08_06_attendance_correction_actions, docs_superpowers_plans_2026_08_06_attendance_correction_card, docs_superpowers_plans_2026_08_06_attendance_correction_form_route, docs_superpowers_plans_2026_08_06_attendance_correction_manager_section, docs_superpowers_plans_2026_08_06_attendance_correction_notifications [EXTRACTED 0.95]
- **Multi-branch cutover: backfill → RLS rewrite → RPC → type flip → UI surfaces → drop legacy column** — docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_backfill, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_rls, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_set_profile_branches, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_profile_type, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_multiselect, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_stafftable, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_register, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_drop_column [EXTRACTED 0.95]
- **Design token system shared by every on-brand surface** — design_color_tokens, design_typography, design_soft_tint_badges, design_per_person_color, design_reuse_checklist, app_icon [EXTRACTED 0.90]
- **Group-scoped manager dashboard: RLS policies + roles helper + page filter + copy map** — docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_getviewablegrouproles, docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_profiles_select_branch, docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_swaps_select_branch, docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_can_view_profile, docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_manager_page, docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_manager_group_meta, docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_defense_in_depth [EXTRACTED 0.90]
- **Single branch_id → profile_branches membership cutover (data, RPC, RLS, UI)** — docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_profile_branches, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_is_branch_member, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_current_branch_id, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_profiles_branch_id, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_set_profile_branches, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_handle_new_user, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_cutover_sequencing [EXTRACTED 0.90]
- **Multi-branch picker UI surface across register, staff table, and shift dialogs** — docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_multiselectbranches, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_registerform, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_stafftable, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_shiftformdialog, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_shiftrequestdialog, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_management_tier_exemption [EXTRACTED 0.85]

## Communities (115 total, 42 thin omitted)

### Community 0 - "LeaveRequestCard.tsx"
Cohesion: 0.13
Nodes (24): AttendanceCorrectionCard(), ISSUE_ICON, formatRange(), formatTimeOfDay(), formatTypeDetail(), LeaveRequestCard(), TYPE_ICON, formatRange() (+16 more)

### Community 1 - "ShiftCalendar.tsx"
Cohesion: 0.10
Nodes (35): maxTime, minTime, ShiftCalendar(), useCalendarNav(), AttendanceCalendarEvent, AttendanceCorrectionPendingEvent, AttendanceSession, AUTO_COLOR_VARS (+27 more)

### Community 2 - "Project Docs & Conventions"
Cohesion: 0.05
Nodes (73): AGENTS.md — Next.js Agent Rules, App Favicon — navy square with white line-art house/shield + book-ribbon mark, CLAUDE.md — Project Instructions, ActionResult<T> Discriminated Union, Architecture Overview, "use client" / "use server" Boundaries, Conventions (naming, code style, imports), Dual Source of Truth: lib/roles.ts ↔ SQL migrations (+65 more)

### Community 3 - "roles.ts"
Cohesion: 0.10
Nodes (31): LeavePage(), ManagerPage(), ProfileRoleRef, AttendanceDetailDialog(), formatMinutes(), CALENDAR_COLLABORATOR_ONLY, CALENDAR_MANAGEMENT_ROLES, CALENDAR_STUDENT_AFFAIRS_ONLY (+23 more)

### Community 4 - "CalendarSidebar.tsx"
Cohesion: 0.09
Nodes (24): AddOtherCalendarMenu(), BranchRow(), CalendarCheckItem(), CalendarMobileMenu(), CalendarSidebar(), CustomCalendarRow(), EventTypeToggles, PENDING_APPROVAL_ICON (+16 more)

### Community 5 - "createClient"
Cohesion: 0.19
Nodes (24): isValidColor(), updateBranchColorAction(), VALID_COLORS, followGroupAction(), followPersonAction(), isValidColor(), unfollowGroupAction(), unfollowPersonAction() (+16 more)

### Community 6 - "RegisterForm.tsx"
Cohesion: 0.12
Nodes (21): mapSignUpError(), signInAction(), signUpAction(), RegisterPage(), LoginForm(), RegisterForm(), CardAction(), CardDescription() (+13 more)

### Community 7 - "Manager Group Scoping"
Cohesion: 0.08
Nodes (34): Manager Dashboard Group Scoping — Design Spec, can_view_profile() RLS helper, Defense-in-depth: RLS outer boundary + app-level filter, getViewableGroupRoles(), HR_GROUP_ROLES (HR group), is_manager() RLS bypass, MANAGER_GROUP_META copy map, app/(app)/manager/page.tsx — scoped fetch layer (+26 more)

### Community 8 - "index.ts"
Cohesion: 0.16
Nodes (20): AppShellLayout(), ShiftCalendar, AttendanceWithProfileRole, LeaveRequestWithRole, buildNotifications(), isManagerRole(), MANAGER_ROLES, AttendanceCorrectionDetailed (+12 more)

### Community 9 - "TypeScript Config"
Cohesion: 0.07
Nodes (28): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules (+20 more)

### Community 10 - "actions/attendance.ts"
Cohesion: 0.17
Nodes (18): canCurrentUserManageAttendanceRow(), clockInAction(), clockOutAction(), deleteAttendanceAction(), mapAttendanceError(), revalidateAttendanceManagePaths(), updateAttendanceAction(), AttendancePage() (+10 more)

### Community 11 - "Initial Database Schema"
Cohesion: 0.11
Nodes (19): auth.users, public, public.handle_new_user, public.protect_profile_privileges, public.sync_shift_branch, on_auth_user_created, profiles_protect_privileges, profiles_set_updated_at (+11 more)

### Community 12 - "shadcn Component Config"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 13 - "AppHeader.tsx"
Cohesion: 0.05
Nodes (41): signOutAction(), subscribeToPushAction(), unsubscribeFromPushAction(), AuthIllustration(), BACK_CELLS, FRONT_CELLS, BrandMark(), noopSubscribe() (+33 more)

### Community 14 - "Dev Dependencies"
Cohesion: 0.10
Nodes (21): eslint, eslint-config-next, devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node (+13 more)

### Community 15 - "server.ts"
Cohesion: 0.38
Nodes (6): AttendanceExplainPage(), SwapRequestsPage(), EmptyState(), PageHeader(), SectionHeading(), LeaveRequestDialog()

### Community 16 - "shifts.ts"
Cohesion: 0.26
Nodes (13): assertAssigneeAllowed(), createShiftAction(), deleteShiftAction(), mapShiftError(), updateShiftAction(), updateStaffBranchesAction(), updateStaffRoleAction(), RoleAndBranchCells() (+5 more)

### Community 17 - "Runtime Dependencies"
Cohesion: 0.11
Nodes (19): class-variance-authority, date-fns, lucide-react, next-themes, dependencies, class-variance-authority, date-fns, lucide-react (+11 more)

### Community 18 - "cn"
Cohesion: 0.10
Nodes (27): BRANCHES, Chip(), DAY_MOMENTS, HeroBoard(), LandingPage(), metadata, Reveal(), StaffRow (+19 more)

### Community 19 - "shift-requests.ts"
Cohesion: 0.27
Nodes (11): cancelShiftRequestAction(), mapShiftRequestError(), mapShiftRpcError(), requestShiftAction(), respondToShiftRequestAction(), revalidateShiftRequestPaths(), SHIFT_RPC_MESSAGES, isShiftRequestApprover() (+3 more)

### Community 20 - "StaffOverviewTable.tsx"
Cohesion: 0.15
Nodes (21): BandStat(), ManagerDashboard(), QueueRow(), normalizeForSearch(), RequestsOverviewTable(), formatHours(), normalizeForSearch(), StaffOverviewTable() (+13 more)

### Community 21 - "button.tsx"
Cohesion: 0.16
Nodes (17): MiniMonth(), WEEKDAY_LABELS, APPS, TYPE_OPTIONS, Button(), buttonVariants, DatePickerField(), Input() (+9 more)

### Community 22 - "lib/push.ts"
Cohesion: 0.17
Nodes (18): cancelLeaveRequestAction(), mapLeaveError(), requestLeaveAction(), respondToLeaveRequestAction(), revalidateLeavePaths(), configured, LEAVE_APPROVER_CANDIDATE_ROLES, PushPayload (+10 more)

### Community 24 - "SwapRequestDialog.tsx"
Cohesion: 0.27
Nodes (13): formatRange(), formatTimeOfDay(), LeaveDetailDialog(), TYPE_ICON, formatRange(), SwapRequestDialog(), Dialog(), DialogContent() (+5 more)

### Community 25 - "Root Layout & Providers"
Cohesion: 0.24
Nodes (6): beVietnamPro, fraunces, metadata, viewport, ThemeProvider(), Toaster()

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

### Community 33 - "AttendanceCorrectionForm.tsx"
Cohesion: 0.18
Nodes (11): CorrectionPreview, AttendanceCorrectionForm(), canSubmitRow(), CorrectionRow, emptyRow(), AttendanceCorrectionInput, attendanceCorrectionSchema, AttendanceCorrectionsInput (+3 more)

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

### Community 40 - "MobileDayStrip.tsx"
Cohesion: 0.25
Nodes (5): VIEW_LABELS, MobileDayStrip(), VIEW_LABELS, WEEKDAY_LABELS, ShiftEvent

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

### Community 104 - "useIsMobile"
Cohesion: 0.70
Nodes (4): getServerSnapshot(), getSnapshot(), subscribe(), useIsMobile()

### Community 105 - "ShiftEventCell.tsx"
Cohesion: 0.50
Nodes (3): LEAVE_ICON, ShiftEventCell(), CalendarEvent

### Community 109 - "lib/attendance.ts"
Cohesion: 0.12
Nodes (20): formatMinutes(), StaffAttendanceDetailDialog(), StaffRequestsDetailDialog(), AttendanceSession, buildDayBreakdown(), buildMonthBreakdown(), DayBreakdownEntry, DayHours (+12 more)

### Community 110 - "lib/auth.ts"
Cohesion: 0.20
Nodes (10): updateProfileAction(), AccountPage(), AccountForm(), ensureProfile(), getSessionProfile, ProfileRow, toProfile(), supabaseAdmin (+2 more)

### Community 111 - "ShiftFormDialog.tsx"
Cohesion: 0.28
Nodes (11): formSchema, FormValues, AlertDialog(), AlertDialogAction(), AlertDialogCancel(), AlertDialogContent(), AlertDialogDescription(), AlertDialogFooter() (+3 more)

### Community 112 - "ShiftRequestDialog.tsx"
Cohesion: 0.24
Nodes (8): ShiftFormDialog(), ShiftRequestDialog(), DialogTrigger(), Textarea(), detectShiftType(), SHIFT_TYPES, ShiftInput, ShiftType

### Community 113 - "attendance-corrections.ts"
Cohesion: 0.46
Nodes (7): AttendanceCorrectionsBatchResult, cancelAttendanceCorrectionAction(), getAttendanceCorrectionPreviewAction(), mapAttendanceCorrectionError(), requestAttendanceCorrectionsAction(), respondToAttendanceCorrectionAction(), revalidateAttendanceCorrectionPaths()

### Community 114 - "ColorPickerDialog"
Cohesion: 0.50
Nodes (4): ColorPickerDialog(), hexToHsv(), Hsv, hsvToHex()

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
- **190 isolated node(s):** `ProfileRoleRef`, `minTime`, `maxTime`, `AUTO_COLOR_VARS`, `HolidayEvent` (+185 more)
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
- **Why does `cn()` connect `cn` to `LeaveRequestCard.tsx`, `ShiftCalendar.tsx`, `RegisterForm.tsx`, `MobileDayStrip.tsx`, `AppHeader.tsx`, `server.ts`, `ShiftFormDialog.tsx`, `ShiftRequestDialog.tsx`, `StaffOverviewTable.tsx`, `button.tsx`, `Route Loading Skeletons`, `SwapRequestDialog.tsx`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Why does `Button()` connect `button.tsx` to `LeaveRequestCard.tsx`, `AttendanceCorrectionForm.tsx`, `CalendarSidebar.tsx`, `RegisterForm.tsx`, `MobileDayStrip.tsx`, `actions/attendance.ts`, `AppHeader.tsx`, `lib/auth.ts`, `ShiftFormDialog.tsx`, `ShiftRequestDialog.tsx`, `cn`, `SwapRequestDialog.tsx`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._