# Graph Report - Calendar-GInny-House  (2026-08-12)

## Corpus Check
- 231 files · ~148,396 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1297 nodes · 3088 edges · 137 communities (88 shown, 49 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 22 edges (avg confidence: 0.7)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `906e707b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- TechnicalDashboard.tsx
- CalendarDayHeader.tsx
- DESIGN.md — Ginny House Design System
- Thiết kế
- BrandMark.tsx
- requireProfile
- Global Constraints
- profile_branches join table
- Global Constraints
- TypeScript Config
- StaffRequestsDetailDialog.tsx
- Initial Database Schema
- shadcn Component Config
- UserMenu.tsx
- Dev Dependencies
- cn
- ShiftCalendar.tsx
- Runtime Dependencies
- skeleton.tsx
- Dynamic Group Permissions — Design
- branches.ts
- 0056_teaching_assistant_free_clock_in.sql
- actions/attendance.ts
- attendance-corrections.ts
- AccountForm.tsx
- app/layout.tsx
- PWA Manifest
- Package Manifest
- Student Affairs Slot Rule
- Leave Requests Schema
- HR Group Shift Approvals
- Attendance Corrections Schema
- vercel.json
- Attendance Clock Schema
- Shift Requests Schema
- Auth Proxy Middleware
- Group Scoped Visibility
- Branch Membership Visibility
- Key Design Facts From Research (read before starting — not in the original spec)
- Shift Type Migration
- Explicit Shift Branch
- Profile Branches Table
- Roster Visibility Helper
- 0052_shift_duty_role.sql
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
- lib/push.ts
- CalendarSidebar.tsx
- public.can_manage_shift_for
- MobileDayStrip.tsx
- Global Constraints
- StaffOverviewTable.tsx
- swaps.ts
- calendar/page.tsx
- ShiftFormDialog.tsx
- 0047_group_permissions.sql
- actions/leave.ts
- lib/auth.ts
- useIsMobile
- Nới luật "1 quản sinh / ca": chỉ chặn khi trùng giờ bắt đầu
- Spec: Daily Production Audit Routine
- index.ts
- createClient
- 0048_group_permissions_sql_functions.sql
- 0053_student_affairs_same_start_only.sql
- 0044_shift_and_swap_approval_scoping.sql
- roles.ts
- shift-requests.ts
- public.auto_checkout_expired_shifts
- public.profiles
- public.profiles
- public.profiles
- ShiftEventCell.tsx
- public.profiles

## God Nodes (most connected - your core abstractions)
1. `cn()` - 115 edges
2. `createClient()` - 77 edges
3. `requireProfile()` - 62 edges
4. `Button()` - 40 edges
5. `ShiftCalendar()` - 25 edges
6. `resolveColor()` - 22 edges
7. `requireManager()` - 22 edges
8. `isManagerRole()` - 21 edges
9. `Role` - 20 edges
10. `Profile` - 19 edges

## Surprising Connections (you probably didn't know these)
- `BandStat()` --calls--> `cn()`  [EXTRACTED]
  components/manager/ManagerDashboard.tsx → lib/utils.ts
- `QueueRow()` --calls--> `cn()`  [EXTRACTED]
  components/manager/ManagerDashboard.tsx → lib/utils.ts
- `unsubscribeFromPushAction()` --calls--> `requireProfile()`  [EXTRACTED]
  actions/push.ts → lib/auth.ts
- `AccountPage()` --calls--> `requireProfile()`  [EXTRACTED]
  app/(app)/account/page.tsx → lib/auth.ts
- `RegisterPage()` --calls--> `getBranches`  [EXTRACTED]
  app/(auth)/register/page.tsx → lib/branches.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Giải trình công end-to-end feature flow (migration → types → actions → UI → notifications)** — docs_superpowers_plans_2026_08_06_attendance_correction_task1_migration, docs_superpowers_plans_2026_08_06_attendance_correction_types, docs_superpowers_plans_2026_08_06_attendance_correction_actions, docs_superpowers_plans_2026_08_06_attendance_correction_card, docs_superpowers_plans_2026_08_06_attendance_correction_form_route, docs_superpowers_plans_2026_08_06_attendance_correction_manager_section, docs_superpowers_plans_2026_08_06_attendance_correction_notifications [EXTRACTED 0.95]
- **Multi-branch cutover: backfill → RLS rewrite → RPC → type flip → UI surfaces → drop legacy column** — docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_backfill, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_rls, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_set_profile_branches, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_profile_type, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_multiselect, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_stafftable, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_register, docs_superpowers_plans_2026_08_07_multi_branch_staff_cutover_drop_column [EXTRACTED 0.95]
- **Design token system shared by every on-brand surface** — design_color_tokens, design_typography, design_soft_tint_badges, design_per_person_color, design_reuse_checklist, app_icon [EXTRACTED 0.90]
- **Group-scoped manager dashboard: RLS policies + roles helper + page filter + copy map** — docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_getviewablegrouproles, docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_profiles_select_branch, docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_swaps_select_branch, docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_can_view_profile, docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_manager_page, docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_manager_group_meta, docs_superpowers_specs_2026_08_06_manager_dashboard_group_scope_design_defense_in_depth [EXTRACTED 0.90]
- **Single branch_id → profile_branches membership cutover (data, RPC, RLS, UI)** — docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_profile_branches, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_is_branch_member, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_current_branch_id, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_profiles_branch_id, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_set_profile_branches, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_handle_new_user, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_cutover_sequencing [EXTRACTED 0.90]
- **Multi-branch picker UI surface across register, staff table, and shift dialogs** — docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_multiselectbranches, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_registerform, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_stafftable, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_shiftformdialog, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_shiftrequestdialog, docs_superpowers_specs_2026_08_07_multi_branch_staff_cutover_design_management_tier_exemption [EXTRACTED 0.85]

## Communities (137 total, 49 thin omitted)

### Community 0 - "TechnicalDashboard.tsx"
Cohesion: 0.17
Nodes (14): CreateAttendanceManualDialog(), ManagerHolders, ROLE_PIE_COLORS, TechnicalDashboard(), aggregateStaffByRole(), GROUP_MANAGER_ROLES, GROUP_PERMISSION_LABELS, GROUP_PERMISSION_TYPES (+6 more)

### Community 2 - "DESIGN.md — Ginny House Design System"
Cohesion: 0.05
Nodes (73): AGENTS.md — Next.js Agent Rules, App Favicon — navy square with white line-art house/shield + book-ribbon mark, CLAUDE.md — Project Instructions, ActionResult<T> Discriminated Union, Architecture Overview, "use client" / "use server" Boundaries, Conventions (naming, code style, imports), Dual Source of Truth: lib/roles.ts ↔ SQL migrations (+65 more)

### Community 3 - "Thiết kế"
Cohesion: 0.15
Nodes (12): 1. Dữ liệu — migration `0052_shift_duty_role.sql`, 2. Duyệt theo nhiệm vụ của ca — không đổi chữ ký hàm TS, 3. SQL mirror — 3 hàm `security definer`, 4. Kiểu dữ liệu (`types/index.ts`), 5. Validation (`lib/validations/`), 6. UI, 7. Không đổi (ngoài phạm vi, nêu rõ để tránh hiểu nhầm khi review), Context (+4 more)

### Community 4 - "BrandMark.tsx"
Cohesion: 0.29
Nodes (6): AuthIllustration(), BACK_CELLS, FRONT_CELLS, BrandMark(), noopSubscribe(), useMounted()

### Community 5 - "requireProfile"
Cohesion: 0.13
Nodes (25): isValidColor(), updateBranchColorAction(), VALID_COLORS, followGroupAction(), followPersonAction(), isValidColor(), unfollowGroupAction(), unfollowPersonAction() (+17 more)

### Community 6 - "Global Constraints"
Cohesion: 0.18
Nodes (10): Dashboard Management Features Implementation Plan, Global Constraints, Task 0: Fix attendance-correction approval dialog not closing, Task 1: Migration 0050 — profiles.deactivated_at + request delete RLS policies, Task 2: Deactivate/reactivate staff — types, auth gate, server action, Task 3: Deactivate/reactivate UI in StaffTable, Task 4: Shift list + delete on `/manager`, Task 5: Delete pending requests — server actions (+2 more)

### Community 7 - "profile_branches join table"
Cohesion: 0.08
Nodes (34): Manager Dashboard Group Scoping — Design Spec, can_view_profile() RLS helper, Defense-in-depth: RLS outer boundary + app-level filter, getViewableGroupRoles(), HR_GROUP_ROLES (HR group), is_manager() RLS bypass, MANAGER_GROUP_META copy map, app/(app)/manager/page.tsx — scoped fetch layer (+26 more)

### Community 8 - "Global Constraints"
Cohesion: 0.33
Nodes (5): Global Constraints, Student-Affairs Same-Start-Only Rule — Implementation Plan, Task 1: Migration `0053_student_affairs_same_start_only.sql`, Task 2: Error-message allowlists, Task 3: Live verification and deploy

### Community 9 - "TypeScript Config"
Cohesion: 0.07
Nodes (28): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules (+20 more)

### Community 10 - "StaffRequestsDetailDialog.tsx"
Cohesion: 0.24
Nodes (13): AppShellLayout(), AttendanceCorrectionCard(), BandStat(), ManagerDashboard(), QueueRow(), aggregateHoursByDay(), buildNotifications(), isManagerRole() (+5 more)

### Community 11 - "Initial Database Schema"
Cohesion: 0.11
Nodes (19): auth.users, public, public.handle_new_user, public.protect_profile_privileges, public.sync_shift_branch, on_auth_user_created, profiles_protect_privileges, profiles_set_updated_at (+11 more)

### Community 12 - "shadcn Component Config"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 13 - "UserMenu.tsx"
Cohesion: 0.06
Nodes (36): mapSignUpError(), signInAction(), signOutAction(), signUpAction(), subscribeToPushAction(), PendingApprovalRow(), AppHeader(), NotificationsBell() (+28 more)

### Community 14 - "Dev Dependencies"
Cohesion: 0.10
Nodes (21): eslint, eslint-config-next, devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node (+13 more)

### Community 15 - "cn"
Cohesion: 0.06
Nodes (65): BRANCHES, Chip(), DAY_MOMENTS, HeroBoard(), LandingPage(), metadata, ISSUE_ICON, LoginForm() (+57 more)

### Community 16 - "ShiftCalendar.tsx"
Cohesion: 0.11
Nodes (32): maxTime, minTime, ShiftCalendar(), AttendanceCalendarEvent, AttendanceCorrectionPendingEvent, AttendanceSession, AUTO_COLOR_VARS, calendarFormats (+24 more)

### Community 17 - "Runtime Dependencies"
Cohesion: 0.11
Nodes (19): class-variance-authority, date-fns, lucide-react, next-themes, dependencies, class-variance-authority, date-fns, lucide-react (+11 more)

### Community 19 - "Dynamic Group Permissions — Design"
Cohesion: 0.22
Nodes (8): Context, Data Model, Dynamic Group Permissions — Design, Out of Scope, Scope, SQL Layer, TypeScript Layer, UI

### Community 20 - "branches.ts"
Cohesion: 0.40
Nodes (3): RegisterPage(), RegisterForm(), supabasePublic

### Community 21 - "0056_teaching_assistant_free_clock_in.sql"
Cohesion: 0.40
Nodes (4): public.attendance, public.clock_in(), public.create_attendance_manual(), public.profiles

### Community 22 - "actions/attendance.ts"
Cohesion: 0.35
Nodes (10): canCurrentUserManageAttendanceRow(), clockInAction(), clockOutAction(), createAttendanceManualAction(), deleteAttendanceAction(), mapAttendanceError(), mapManualAttendanceError(), revalidateAttendanceManagePaths() (+2 more)

### Community 23 - "attendance-corrections.ts"
Cohesion: 0.17
Nodes (16): AttendanceCorrectionsBatchResult, cancelAttendanceCorrectionAction(), CorrectionPreview, deleteAttendanceCorrectionAction(), getAttendanceCorrectionPreviewAction(), mapAttendanceCorrectionError(), requestAttendanceCorrectionsAction(), respondToAttendanceCorrectionAction() (+8 more)

### Community 24 - "AccountForm.tsx"
Cohesion: 0.33
Nodes (5): AccountPage(), AccountForm(), Separator(), ProfileInput, profileSchema

### Community 25 - "app/layout.tsx"
Cohesion: 0.28
Nodes (5): barlow, metadata, viewport, ThemeProvider(), Toaster()

### Community 26 - "PWA Manifest"
Cohesion: 0.20
Nodes (9): background_color, description, display, icons, lang, name, short_name, start_url (+1 more)

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

### Community 40 - "Key Design Facts From Research (read before starting — not in the original spec)"
Cohesion: 0.13
Nodes (14): Dynamic Group Permissions Implementation Plan, Global Constraints, Key Design Facts From Research (read before starting — not in the original spec), Task 10: End-to-end regression verification, Task 11: Deploy, Task 1: `group_permissions` table + RLS + seed migration, Task 2: Rewrite the 6 SQL predicate functions to read from `group_permissions`, Task 3: `lib/permissions.ts` — new TS module (+6 more)

### Community 41 - "Shift Type Migration"
Cohesion: 0.40
Nodes (4): public.request_shift(), public.respond_to_shift_request(), public.profiles, public.shift_requests

### Community 43 - "Profile Branches Table"
Cohesion: 0.50
Nodes (4): public.is_branch_member(), public.profile_branches, public.branches, public.profiles

### Community 44 - "Roster Visibility Helper"
Cohesion: 0.40
Nodes (4): public.is_visible_via_roster(), public.attendance, public.shift_swap_requests, public.shifts

### Community 45 - "0052_shift_duty_role.sql"
Cohesion: 0.09
Nodes (29): public.attendance_corrections, public.group_permissions, public.shift_requests, public.shift_swap_requests, public.shifts, public.validate_shift_duty_role, public.validate_shift_request_duty_role, public.can_approve_shift_request() (+21 more)

### Community 46 - "Brand Icon Assets"
Cohesion: 0.50
Nodes (4): Ginny House navy icon mark (no wordmark), Ginny House square app icon (512px, navy on white), Ginny House white/knockout icon variant for dark backgrounds, Ginny House full logo — navy outlined house/shield mark with wordmark

### Community 48 - "Custom Calendars Schema"
Cohesion: 0.67
Nodes (3): public.custom_calendars, public.custom_events, public.profiles

### Community 50 - "Swap Branch Check Fix"
Cohesion: 0.50
Nodes (3): public.respond_to_swap_request(), public.shift_swap_requests, public.shifts

### Community 105 - "lib/push.ts"
Cohesion: 0.19
Nodes (13): unsubscribeFromPushAction(), GET(), configured, isPushOversightRole(), LEAVE_APPROVER_CANDIDATE_ROLES, PushPayload, sendPushToLeaveApprovers(), sendPushToProfiles() (+5 more)

### Community 106 - "CalendarSidebar.tsx"
Cohesion: 0.09
Nodes (23): BranchRow(), CalendarCheckItem(), CalendarMobileMenu(), CalendarSidebar(), CustomCalendarRow(), EventTypeToggles, GroupSection(), PENDING_APPROVAL_ICON (+15 more)

### Community 109 - "MobileDayStrip.tsx"
Cohesion: 0.25
Nodes (5): VIEW_LABELS, MobileDayStrip(), VIEW_LABELS, WEEKDAY_LABELS, ShiftEvent

### Community 112 - "Global Constraints"
Cohesion: 0.20
Nodes (9): Global Constraints, Shift Duty Role Implementation Plan, Task 1: Database — migration `0052_shift_duty_role.sql`, Task 2: Types, Supabase select strings, and approval-routing call sites, Task 3: Validation schemas and Server Actions, Task 4: `ShiftFormDialog.tsx` — manager-side duty-role picker, Task 5: `ShiftRequestDialog.tsx` — self-service duty-role picker, Task 6: Display — `ShiftDetailDialog.tsx` and `ShiftsOverviewTable.tsx` (+1 more)

### Community 113 - "StaffOverviewTable.tsx"
Cohesion: 0.16
Nodes (21): CollapsibleGrid(), PERIOD_LABELS, normalizeForSearch(), RequestsOverviewTable(), formatHours(), normalizeForSearch(), StaffOverviewTable(), STATUS_LABEL (+13 more)

### Community 115 - "swaps.ts"
Cohesion: 0.36
Nodes (9): cancelSwapRequestAction(), createSwapRequestAction(), deleteSwapRequestAction(), mapSwapError(), respondToSwapRequestAction(), revalidateSwapPaths(), sendPushToProfile(), SwapRequestInput (+1 more)

### Community 116 - "calendar/page.tsx"
Cohesion: 0.19
Nodes (11): ShiftCalendar, useCalendarNav(), AttendanceWithProfileRole, CalendarView, getVisibleRange(), LeaveRequestWithRole, GroupPermissions, CustomCalendar (+3 more)

### Community 117 - "ShiftFormDialog.tsx"
Cohesion: 0.06
Nodes (72): AttendanceCorrectionForm(), canSubmitRow(), CorrectionRow, emptyRow(), ClockInGate, ClockWidget(), formatDuration(), getClockInGate() (+64 more)

### Community 119 - "actions/leave.ts"
Cohesion: 0.62
Nodes (6): cancelLeaveRequestAction(), deleteLeaveRequestAction(), mapLeaveError(), requestLeaveAction(), respondToLeaveRequestAction(), revalidateLeavePaths()

### Community 120 - "lib/auth.ts"
Cohesion: 0.26
Nodes (10): AttendanceExplainPage(), SwapRequestsPage(), EmptyState(), PageHeader(), SectionHeading(), LeaveRequestDialog(), ensureProfile(), getSessionProfile (+2 more)

### Community 121 - "useIsMobile"
Cohesion: 0.70
Nodes (4): getServerSnapshot(), getSnapshot(), subscribe(), useIsMobile()

### Community 123 - "Nới luật "1 quản sinh / ca": chỉ chặn khi trùng giờ bắt đầu"
Cohesion: 0.14
Nodes (13): 1. `student_affairs_slot_taken()` — đổi 2 điều kiện, giữ nguyên chữ ký, 2. `enforce_student_affairs_single_slot()` — cổng chặn hiểu nhiệm vụ ca, 3. `request_shift()` — cùng cách xử lý cho đường tự đăng ký, Context, File sẽ sửa, Hai lỗi của luật cũ, phát hiện khi rà soát — sửa luôn trong migration này, Không đổi (ngoài phạm vi), Migration `0053_student_affairs_same_start_only.sql` (+5 more)

### Community 125 - "Spec: Daily Production Audit Routine"
Cohesion: 0.14
Nodes (13): 1. Monitoring account, 2. Pages checked, 3. Speed measurement, 4. The routine, Context, Decisions already made with the user, Exclusion call sites, File changes (+5 more)

### Community 126 - "index.ts"
Cohesion: 0.11
Nodes (23): AttendanceHistory(), formatDuration(), AttendanceSession, DayBreakdownEntry, DayHours, MonthBreakdownEntry, RoleCount, StaffOverviewRow (+15 more)

### Community 127 - "createClient"
Cohesion: 0.18
Nodes (21): assertAssigneeAllowed(), createShiftAction(), deleteShiftAction(), mapShiftError(), updateShiftAction(), deactivateStaffAction(), mapStaffSecondaryRoleError(), updateStaffBranchesAction() (+13 more)

### Community 128 - "0048_group_permissions_sql_functions.sql"
Cohesion: 0.50
Nodes (8): public.can_approve_shift_request(), public.can_approve_swap_request(), public.can_manage_attendance_for(), public.can_manage_shift_for(), public.can_view_profile(), public.can_view_profile_calendar(), public.group_permissions, public.profiles

### Community 129 - "0053_student_affairs_same_start_only.sql"
Cohesion: 0.31
Nodes (7): public.enforce_student_affairs_single_slot(), public.student_affairs_slot_taken(), public.validate_shift_duty_role(), public.validate_shift_request_duty_role(), public.profiles, public.shift_requests, public.shifts

### Community 130 - "0044_shift_and_swap_approval_scoping.sql"
Cohesion: 0.33
Nodes (6): public.can_approve_shift_request(), public.can_approve_swap_request(), public.respond_to_swap_request(), public.profiles, public.shift_swap_requests, public.shifts

### Community 131 - "roles.ts"
Cohesion: 0.10
Nodes (29): ManagerPage(), ProfileRoleRef, AttendanceDetailDialog(), formatMinutes(), normalizeForSearch(), ShiftOverviewRow, ShiftsOverviewTable(), getGrantedTargetRoles() (+21 more)

### Community 132 - "shift-requests.ts"
Cohesion: 0.35
Nodes (10): cancelShiftRequestAction(), deleteShiftRequestAction(), mapShiftRequestError(), mapShiftRpcError(), requestShiftAction(), respondToShiftRequestAction(), revalidateShiftRequestPaths(), SHIFT_RPC_MESSAGES (+2 more)

### Community 137 - "ShiftEventCell.tsx"
Cohesion: 0.50
Nodes (3): LEAVE_ICON, ShiftEventCell(), CalendarEvent

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
- **258 isolated node(s):** `ProfileRoleRef`, `RelevantShift`, `ClockInGate`, `Person`, `PersonGroup` (+253 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **49 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

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
- **Why does `cn()` connect `cn` to `BrandMark.tsx`, `StaffRequestsDetailDialog.tsx`, `MobileDayStrip.tsx`, `UserMenu.tsx`, `ShiftCalendar.tsx`, `StaffOverviewTable.tsx`, `skeleton.tsx`, `ShiftFormDialog.tsx`, `lib/auth.ts`, `AccountForm.tsx`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Why does `createClient()` connect `createClient` to `roles.ts`, `shift-requests.ts`, `requireProfile`, `StaffRequestsDetailDialog.tsx`, `UserMenu.tsx`, `swaps.ts`, `attendance-corrections.ts`, `calendar/page.tsx`, `actions/attendance.ts`, `actions/leave.ts`, `lib/auth.ts`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._