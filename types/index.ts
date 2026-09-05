export type Role =
  | "ceo"
  | "coo"
  | "training_director"
  | "hr"
  | "technical"
  | "teacher"
  | "student_affairs"
  | "teaching_assistant"
  | "collaborator"
  | "customer_care"
  | "operations_staff"
  // Secondary-role-only value (see lib/roles.ts's SECONDARY_ROLE_BY_PRIMARY,
  // supabase/migrations/0067/0068) — never a primary role, so it's
  // deliberately absent from ROLE_HIERARCHY's pickable list.
  | "receptionist";
export type SwapStatus = "pending" | "accepted" | "rejected" | "cancelled";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export type Branch = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  color_token: string;
  sort_order: number;
};

export type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  role: Role;
  /** "Kiêm nhiệm" — display/grouping only, never authorization. Restricted
   * by a DB CHECK constraint to teaching_assistant, and only when `role`
   * is teacher or student_affairs. See supabase/migrations/0051. */
  secondary_role: Role | null;
  /** "Kiêm lễ tân" — trực quầy, tách khỏi secondary_role vì một người có thể
   * vừa kiêm trợ giảng vừa kiêm lễ tân (quản sinh thì thành 3 vai trò). Giới
   * hạn bởi CHECK ở 0085 cho student_affairs / customer_care / hr. */
  covers_reception: boolean;
  branch_ids: string[];
  color: string | null;
  /** When this person last opened the notification bell; null = never. */
  notifications_seen_at: string | null;
  /** Soft-delete: blocks login, reversible. null = active account. */
  deactivated_at: string | null;
  /** The daily audit routine's dedicated login — excluded from staff
   * listings/aggregates. See supabase/migrations/0054. */
  is_monitoring_account: boolean;
};

export type ShiftType = "morning" | "afternoon" | "evening" | "remote";

export type Shift = {
  id: string;
  branch_id: string;
  assignee_id: string;
  start_at: string;
  end_at: string;
  note: string | null;
  created_by: string | null;
  shift_type: ShiftType;
  /** Vai trò của riêng ca này. null = theo vai trò gốc của người được gán —
   * đúng hành vi cũ với mọi người không kiêm lễ tân. CHECK ở 0085 chỉ cho
   * phép null hoặc "receptionist"; đây KHÔNG phải hệ thống vai-trò-theo-ca
   * tổng quát (0052 làm vậy và 0055 đã gỡ). */
  covering_role: Role | null;
  // Set when the shift was materialised from a "ca cố định" rule (0078).
  // Nullable both because most shifts aren't recurring and because the rule
  // can be deleted out from under an occurrence (ON DELETE SET NULL).
  series_id: string | null;
};

// The recurrence RULE, not its occurrences — see shift_series in
// 0078_shift_series.sql. weekdays uses 0 = Chủ nhật … 6 = Thứ Bảy, matching
// both Postgres's extract(dow) and JS's getDay(). start_time/end_time are
// local Vietnam wall-clock times ("18:00:00"); end_time <= start_time means
// the shift ends the next day, the same convention ShiftFormDialog uses.
export type ShiftSeries = {
  id: string;
  branch_id: string;
  // Null once Đợt 3 (0079) allowed a rule to be planned before anyone is put
  // on it. A null-assignee series materialises into `shift_slots`, not
  // `shifts`, so nothing downstream ever reads a shift without an assignee.
  assignee_id: string | null;
  shift_type: ShiftType;
  note: string | null;
  weekdays: number[];
  interval_weeks: number;
  start_time: string;
  end_time: string;
  starts_on: string;
  ends_on: string | null;
  created_by: string | null;
  created_at: string;
};

export type ShiftSeriesDetailed = ShiftSeries & {
  // Null in step with assignee_id — an unassigned rule has nobody to join to.
  assignee: Pick<Profile, "id" | "full_name" | "role"> | null;
  branch: Pick<Branch, "id" | "name">;
};

// An occurrence of a rule that nobody is on yet — Đợt 3, table `shift_slots`
// (0079). Deliberately NOT a `shifts` row with a null assignee: see the long
// note at the top of that migration. Staff never see these; RLS gives them no
// policy at all, so they are invisible below the app layer too.
export type ShiftSlot = {
  id: string;
  branch_id: string;
  series_id: string | null;
  shift_type: ShiftType;
  note: string | null;
  start_at: string;
  end_at: string;
  created_by: string | null;
  created_at: string;
};

export type ShiftSlotDetailed = ShiftSlot & {
  branch: Pick<Branch, "id" | "name">;
};

export type ShiftWithAssignee = Shift & {
  assignee: Pick<Profile, "id" | "full_name" | "color" | "role">;
};

export type ShiftRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export type ShiftRequest = {
  id: string;
  profile_id: string;
  branch_id: string | null;
  start_at: string;
  end_at: string;
  note: string | null;
  status: ShiftRequestStatus;
  responder_id: string | null;
  resolved_at: string | null;
  created_at: string;
  shift_type: ShiftType;
  /** Vai trò của ca được đăng ký — xem Shift.covering_role. */
  covering_role: Role | null;
};

export type ShiftRequestDetailed = ShiftRequest & {
  profile: Pick<Profile, "id" | "full_name" | "role">;
  branch: Pick<Branch, "id" | "name"> | null;
};

export type SwapRequest = {
  id: string;
  branch_id: string;
  requester_id: string;
  requester_shift_id: string;
  target_id: string | null;
  target_shift_id: string | null;
  status: SwapStatus;
  message: string | null;
  responder_id: string | null;
  resolved_at: string | null;
  created_at: string;
};

export type SwapRequestDetailed = SwapRequest & {
  requester: Pick<Profile, "id" | "full_name" | "role">;
  target: Pick<Profile, "id" | "full_name" | "role"> | null;
  requester_shift: Pick<Shift, "id" | "start_at" | "end_at">;
  target_shift: Pick<Shift, "id" | "start_at" | "end_at"> | null;
};

export type Attendance = {
  id: string;
  profile_id: string;
  branch_id: string;
  shift_id: string | null;
  check_in_at: string;
  check_out_at: string | null;
  created_at: string;
};

export type AttendanceWithProfile = Attendance & {
  profile: Pick<Profile, "id" | "full_name">;
};

export type AttendanceCorrectionStatus = "pending" | "approved" | "rejected" | "cancelled";
export type AttendanceCorrectionIssue =
  | "missed_check_in"
  | "late_check_in"
  | "missed_check_out"
  | "adjust_check_out";
// Generated in Postgres from issue_type (0071) — never set from the client.
export type AttendanceCorrectionKind = "check_in" | "check_out";

export type AttendanceCorrection = {
  id: string;
  profile_id: string;
  shift_id: string;
  attendance_id: string | null;
  issue_type: AttendanceCorrectionIssue;
  kind: AttendanceCorrectionKind;
  // attendance_corrections_time_by_issue (0071) only guarantees that the
  // requested_* column matching this row's issue_type is NOT NULL. It says
  // nothing about the other pair, so null-check before reading either.
  actual_check_in_at: string | null;
  requested_check_in_at: string | null;
  actual_check_out_at: string | null;
  requested_check_out_at: string | null;
  reason: string;
  status: AttendanceCorrectionStatus;
  responder_id: string | null;
  resolved_at: string | null;
  created_at: string;
};

export type AttendanceCorrectionDetailed = AttendanceCorrection & {
  profile: Pick<Profile, "id" | "full_name" | "role">;
  shift: Pick<Shift, "id" | "start_at" | "end_at">;
};

export type LeaveRequestType = "full_day" | "late_arrival" | "early_leave" | "hourly";

export type LeaveRequest = {
  id: string;
  profile_id: string;
  branch_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: LeaveStatus;
  request_type: LeaveRequestType;
  start_time: string | null;
  end_time: string | null;
  responder_id: string | null;
  resolved_at: string | null;
  created_at: string;
};

export type LeaveRequestDetailed = LeaveRequest & {
  profile: Pick<Profile, "id" | "full_name">;
};

export type CustomCalendar = {
  id: string;
  owner_id: string;
  name: string;
  color: string;
  /** Owner opted this calendar into "Duyệt lịch có sẵn trong công ty" (0081). */
  is_shared: boolean;
  created_at: string;
};

// Shape returned by the list_shared_custom_calendars() RPC (0081) — a plain
// embedded join to profiles would lose the owner's name for anyone the viewer
// cannot see under profiles_select_branch, so the browse dialog reads this
// SECURITY DEFINER view of the shared set instead.
export type SharedCustomCalendar = {
  id: string;
  owner_id: string;
  owner_name: string;
  name: string;
  color: string;
  created_at: string;
  is_subscribed: boolean;
};

export type CustomEvent = {
  id: string;
  calendar_id: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  created_at: string;
};

export type PushSubscriptionRow = {
  id: string;
  profile_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
};

// Mirrors public.notifications (0077). Written only by the service-role
// client via lib/notifications-emit.ts; read back by the recipient alone,
// enforced by policy notifications_select_own.
export type NotificationRow = {
  id: string;
  profile_id: string;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  related_id: string | null;
  read_at: string | null;
  created_at: string;
};

// A Vietnamese public holiday, table `holidays` (0080). Both ends are
// INCLUSIVE — Quốc khánh running 29/08 "đến hết" 02/09 is start_date
// 2025-08-29, end_date 2025-09-02. toHolidayEvents() in lib/calendar.ts is
// the one place that converts this to react-big-calendar's exclusive end.
//
// Display-only: no business rule (leave validation, shift creation, late
// detection, either cron route) reads holidays, and none should start to
// without a deliberate decision.
export type Holiday = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  // half_day = false is the default and what every pre-0082 row is: the
  // calendar shades the whole visible day. half_day = true pairs with a
  // start_time ("HH:MM:SS") and shades only from that hour onward — on the
  // FIRST day of the range, the remaining days staying full (see
  // toHolidayBackgroundEvents in lib/calendar.ts). The pairing is enforced by
  // holidays_half_day_time_valid in 0082.
  half_day: boolean;
  start_time: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };
