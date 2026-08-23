export const SWAP_STATUS_LABELS: Record<
  "pending" | "accepted" | "rejected" | "cancelled",
  string
> = {
  pending: "Đang chờ",
  accepted: "Đã đồng ý",
  rejected: "Đã từ chối",
  cancelled: "Đã huỷ",
};

export const LEAVE_STATUS_LABELS: Record<
  "pending" | "approved" | "rejected" | "cancelled",
  string
> = {
  pending: "Đang chờ",
  approved: "Đã duyệt",
  rejected: "Đã từ chối",
  cancelled: "Đã huỷ",
};

export const SHIFT_REQUEST_STATUS_LABELS: Record<
  "pending" | "approved" | "rejected" | "cancelled",
  string
> = {
  pending: "Đang chờ",
  approved: "Đã duyệt",
  rejected: "Đã từ chối",
  cancelled: "Đã huỷ",
};

export const ATTENDANCE_CORRECTION_STATUS_LABELS: Record<
  "pending" | "approved" | "rejected" | "cancelled",
  string
> = {
  pending: "Đang chờ",
  approved: "Đã duyệt",
  rejected: "Đã từ chối",
  cancelled: "Đã huỷ",
};

export const ATTENDANCE_CORRECTION_ISSUE_LABELS: Record<
  "missed_check_in" | "late_check_in" | "missed_check_out" | "adjust_check_out",
  string
> = {
  missed_check_in: "Quên chấm công",
  late_check_in: "Chấm công trễ",
  missed_check_out: "Quên chấm công ra",
  adjust_check_out: "Sửa giờ ra ca",
};

export const LEAVE_REQUEST_TYPE_LABELS: Record<
  "full_day" | "late_arrival" | "early_leave" | "hourly",
  string
> = {
  full_day: "Nghỉ cả ngày",
  late_arrival: "Đến muộn",
  early_leave: "Về sớm",
  hourly: "Nghỉ theo giờ",
};

// Business hours the calendar's week/day grid draws.
//
// CALENDAR_MIN_HOUR is the first labelled row. CALENDAR_MAX_HOUR is the LAST
// labelled row — NOT the grid's bottom edge. react-big-calendar's `max` prop
// is the bottom edge, so it gets the *end* of that hour via calendarGridEnd()
// and the grid runs through CALENDAR_MAX_HOUR + 1:00.
//
// Why 23:00 is a real labelled row: shifts are only ever registered up to
// 22:00, but a check-out can run past it on overtime ("tăng ca"). With the
// bottom edge sitting exactly on 22:00 those extra minutes had nowhere to
// render — getRange() clamps rangeEnd to `max`, so the block flattened onto
// the last gridline. The extra row is the headroom that lets a 22:30 finish
// draw where it actually falls.
export const CALENDAR_MIN_HOUR = 6;
export const CALENDAR_MAX_HOUR = 23;

// Bottom edge of the week/day grid on `day` — the last instant of
// CALENDAR_MAX_HOUR, so that hour renders as a full row.
//
// 23:59:59.999 rather than a bare 24:00 because setHours(24) rolls over to
// the next day, which would hand react-big-calendar a `max` that is no longer
// on the same day as its `min`. Ending the range on the hour's last instant
// keeps it inside the day and still yields a whole slot group: RBC derives
// its row count from ceil((totalMin - 1) / (step * timeslots))
// (utils/TimeSlots.js), so 06:00 → 23:59:59.999 with step=30/timeslots=2
// gives 18 groups of 60 minutes and a percentage denominator
// (step * numSlots) of exactly 1080 minutes — every hour label still lands on
// a whole multiple of the row pitch.
export function calendarGridEnd(day: Date): Date {
  const end = new Date(day);
  end.setHours(CALENDAR_MAX_HOUR, 59, 59, 999);
  return end;
}

export const SHIFT_TYPE_LABELS: Record<"morning" | "afternoon" | "evening" | "remote", string> = {
  morning: "Ca sáng",
  afternoon: "Ca chiều",
  evening: "Ca tối",
  remote: "Ca remote",
};

// Boundaries for auto-suggesting a shift type from the picked start time —
// still a plain editable dropdown afterwards, this only sets the default.
// <12:00 sáng, 12:00–17:00 chiều, ≥17:00 tối.
export function detectShiftType(startTime: string): "morning" | "afternoon" | "evening" {
  const [hour, minute] = startTime.split(":").map(Number);
  const minutes = hour * 60 + minute;
  if (minutes < 12 * 60) return "morning";
  if (minutes < 17 * 60) return "afternoon";
  return "evening";
}
