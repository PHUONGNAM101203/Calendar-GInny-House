// Shared "own ∪ approvable" scoping for pending-approval rows (leave,
// shift requests, swaps, attendance corrections) on the calendar page.
// Several tables' RLS policies already implement this exact shape
// server-side (see shift_requests_select in 0019_hr_group_student_
// affairs_teaching_assistant.sql), but leave_requests/attendance_
// corrections/shift_swap_requests grant broader *visibility* than
// *approval rights* (can_view_profile vs. can_approve), so the calendar's
// "Cần xét duyệt" sidebar still needs an app-level narrowing pass — this
// is that pass, generalized once instead of re-derived per row type.
export function scopeToOwnOrApprovable<T>(
  rows: T[],
  currentUserId: string,
  getOwnerId: (row: T) => string,
  canApprove: (row: T) => boolean
): T[] {
  return rows.filter((row) => getOwnerId(row) === currentUserId || canApprove(row));
}
