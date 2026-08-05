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

export const LEAVE_REQUEST_TYPE_LABELS: Record<
  "full_day" | "late_arrival" | "early_leave" | "hourly",
  string
> = {
  full_day: "Nghỉ cả ngày",
  late_arrival: "Đến muộn",
  early_leave: "Về sớm",
  hourly: "Nghỉ theo giờ",
};

// Business hours the calendar clamps its day/week view to.
export const CALENDAR_MIN_HOUR = 6;
export const CALENDAR_MAX_HOUR = 23;
