import { formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";
import { isManagerRole, isLeaveApprover, canApproveShiftRequestFor } from "@/lib/roles";
import type { GroupPermissions } from "@/lib/permissions";
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
  permissions,
}: {
  profile: Pick<Profile, "id" | "role">;
  swaps: SwapRequestDetailed[];
  leaves: LeaveRequestDetailed[];
  shiftRequests: ShiftRequestDetailed[];
  attendanceCorrections: AttendanceCorrectionDetailed[];
  permissions: GroupPermissions;
}): AppNotification[] {
  const isManager = isManagerRole(profile.role);
  // Leave and giải trình công are the two things HR actually approves
  // (isLeaveApprover covers both — see its comment in lib/roles.ts), but HR
  // is not manager-tier, so gating those two branches on isManagerRole alone
  // hid from HR the very requests it is responsible for. Swap and shift
  // requests keep gating on isManager, which is correct for them.
  const seesPendingApprovals = isManager || isLeaveApprover(profile.role);
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
    if (l.status === "pending" && seesPendingApprovals) {
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
    if (r.status === "pending" && canApproveShiftRequestFor(profile.role, r.profile.role, permissions)) {
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
    if (c.status === "pending" && seesPendingApprovals) {
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

// A stored row from the notifications table (0077), as the bell needs it.
export type StoredNotification = {
  id: string;
  title: string;
  body: string;
  url: string | null;
  created_at: string;
};

// The second source. buildNotifications() derives its items from the four
// request tables and cannot represent an event whose row is gone (a deleted
// shift, a reassigned one); those arrive here instead, already composed in
// Vietnamese at write time.
export function mapStoredNotifications(rows: StoredNotification[]): AppNotification[] {
  return rows.map((row) => ({
    // Namespaced so a stored row's uuid can never collide with a derived
    // item's `swap-<id>` / `leave-<id>` key.
    id: `stored-${row.id}`,
    text: row.body,
    href: row.url ?? "/calendar",
    at: row.created_at,
    // Phase A emits informational events only — nothing here is an approval
    // waiting on the recipient.
    needsAction: false,
  }));
}

// Two sources, one shape. Kept identical to buildNotifications()'s own final
// sort-and-take-10 so the bell shows the ten most recent items overall
// regardless of which source they came from.
export function mergeNotifications(...groups: AppNotification[][]): AppNotification[] {
  return groups
    .flat()
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 10);
}

export function formatNotificationTime(at: string): string {
  return formatDistanceToNow(new Date(at), { addSuffix: true, locale: vi });
}
