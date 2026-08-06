import { formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";
import { isManagerRole, isCeo } from "@/lib/roles";
import type {
  AttendanceCorrectionDetailed,
  LeaveRequestDetailed,
  Profile,
  ShiftRequestDetailed,
  SwapRequestDetailed,
} from "@/types";

export type AppNotification = {
  id: string;
  text: string;
  href: string;
  at: string;
  needsAction: boolean;
};

// Computed straight off data already fetched for other pages — no read/
// unread table. A notification only exists while its underlying row still
// matches (pending-for-you, or resolved-recently-for-you); it naturally
// disappears once the next page load re-derives the list.
export function buildNotifications({
  profile,
  swaps,
  leaves,
  shiftRequests,
  attendanceCorrections,
}: {
  profile: Pick<Profile, "id" | "role">;
  swaps: SwapRequestDetailed[];
  leaves: LeaveRequestDetailed[];
  shiftRequests: ShiftRequestDetailed[];
  attendanceCorrections: AttendanceCorrectionDetailed[];
}): AppNotification[] {
  const isManager = isManagerRole(profile.role);
  const ceo = isCeo(profile.role);
  const recentCutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const items: AppNotification[] = [];

  for (const s of swaps) {
    const isMine = s.requester_id === profile.id;
    const targetedAtMe = s.target_id === profile.id;
    if (s.status === "pending" && (targetedAtMe || isManager)) {
      items.push({
        id: `swap-${s.id}`,
        text: targetedAtMe
          ? `${s.requester.full_name} muốn đổi ca với bạn`
          : `${s.requester.full_name} gửi yêu cầu đổi ca đang chờ xử lý`,
        href: "/swaps",
        at: s.created_at,
        needsAction: true,
      });
    } else if (isMine && s.status !== "pending" && s.resolved_at && new Date(s.resolved_at).getTime() > recentCutoff) {
      items.push({
        id: `swap-resolved-${s.id}`,
        text:
          s.status === "accepted"
            ? "Yêu cầu đổi ca của bạn đã được nhận"
            : s.status === "rejected"
              ? "Yêu cầu đổi ca của bạn đã bị từ chối"
              : "Yêu cầu đổi ca của bạn đã bị huỷ",
        href: "/swaps",
        at: s.resolved_at,
        needsAction: false,
      });
    }
  }

  for (const l of leaves) {
    const isMine = l.profile_id === profile.id;
    if (l.status === "pending" && isManager) {
      items.push({
        id: `leave-${l.id}`,
        text: `${l.profile.full_name} gửi đơn xin nghỉ phép đang chờ duyệt`,
        href: "/leave",
        at: l.created_at,
        needsAction: true,
      });
    } else if (isMine && l.status !== "pending" && l.resolved_at && new Date(l.resolved_at).getTime() > recentCutoff) {
      items.push({
        id: `leave-resolved-${l.id}`,
        text:
          l.status === "approved"
            ? "Đơn xin nghỉ phép của bạn đã được duyệt"
            : "Đơn xin nghỉ phép của bạn đã bị từ chối",
        href: "/leave",
        at: l.resolved_at,
        needsAction: false,
      });
    }
  }

  for (const r of shiftRequests) {
    const isMine = r.profile_id === profile.id;
    if (r.status === "pending" && ceo) {
      items.push({
        id: `shift-request-${r.id}`,
        text: `${r.profile.full_name} đăng ký ca làm đang chờ bạn duyệt`,
        href: "/manager",
        at: r.created_at,
        needsAction: true,
      });
    } else if (isMine && r.status !== "pending" && r.resolved_at && new Date(r.resolved_at).getTime() > recentCutoff) {
      items.push({
        id: `shift-request-resolved-${r.id}`,
        text:
          r.status === "approved"
            ? "Đăng ký ca làm của bạn đã được duyệt"
            : "Đăng ký ca làm của bạn đã bị từ chối",
        href: "/calendar",
        at: r.resolved_at,
        needsAction: false,
      });
    }
  }

  for (const c of attendanceCorrections) {
    const isMine = c.profile_id === profile.id;
    if (c.status === "pending" && isManager) {
      items.push({
        id: `attendance-correction-${c.id}`,
        text: `${c.profile.full_name} gửi đơn giải trình công đang chờ duyệt`,
        href: "/manager",
        at: c.created_at,
        needsAction: true,
      });
    } else if (
      isMine &&
      c.status !== "pending" &&
      c.resolved_at &&
      new Date(c.resolved_at).getTime() > recentCutoff
    ) {
      items.push({
        id: `attendance-correction-resolved-${c.id}`,
        text:
          c.status === "approved"
            ? "Đơn giải trình công của bạn đã được duyệt"
            : "Đơn giải trình công của bạn đã bị từ chối",
        href: "/attendance/explain",
        at: c.resolved_at,
        needsAction: false,
      });
    }
  }

  return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 10);
}

export function formatNotificationTime(at: string): string {
  return formatDistanceToNow(new Date(at), { addSuffix: true, locale: vi });
}
