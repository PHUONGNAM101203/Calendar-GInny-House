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
  | "operations_staff";
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
  duty_role: Role | null;
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
  duty_role: Role | null;
};

export type ShiftRequestDetailed = ShiftRequest & {
  profile: Pick<Profile, "id" | "full_name" | "role">;
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
  requester_shift: Pick<Shift, "id" | "start_at" | "end_at" | "duty_role">;
  target_shift: Pick<Shift, "id" | "start_at" | "end_at" | "duty_role"> | null;
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
export type AttendanceCorrectionIssue = "missed_check_in" | "late_check_in";

export type AttendanceCorrection = {
  id: string;
  profile_id: string;
  shift_id: string;
  attendance_id: string | null;
  issue_type: AttendanceCorrectionIssue;
  actual_check_in_at: string | null;
  requested_check_in_at: string;
  reason: string;
  status: AttendanceCorrectionStatus;
  responder_id: string | null;
  resolved_at: string | null;
  created_at: string;
};

export type AttendanceCorrectionDetailed = AttendanceCorrection & {
  profile: Pick<Profile, "id" | "full_name" | "role">;
  shift: Pick<Shift, "id" | "start_at" | "end_at" | "duty_role">;
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
  created_at: string;
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

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };
