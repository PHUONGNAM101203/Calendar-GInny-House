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

// Was 10, back when the bell only ever showed the five derived kinds. The
// stored half (0077) since added roughly a dozen purely informational kinds
// (shift assigned/changed/deleted, missed check-in, stale check-out,
// attendance edited, role changed, ...), any one of which can fire several
// times a day. Ten slots no longer covers a normal day's traffic, so a person
// opening the bell saw only the last few hours of it. Fifteen matches the
// per-source `.limit(15)` in app/(app)/layout.tsx, so the cap is now the same
// number everywhere in the pipeline instead of two different ones.
const NOTIFICATION_LIMIT = 15;

// Actionable items must never be pushed out by informational ones.
//
// The bug this fixes: the list was capped purely by recency, so a manager who
// also works shifts would accumulate ten informational notifications over a
// couple of days and a leave request that had been pending for five days —
// old by `created_at`, and therefore last in a recency sort — fell off the
// bell entirely and stopped being chased. The longer something waits for
// approval the more it matters, and the further down a recency sort it goes.
//
// So: keep every actionable item first, then fill whatever slots remain with
// the most recent informational ones. Each group stays newest-first
// internally, which is what people expect when they read down the list.
//
// If actionable items alone ever exceed the cap the oldest are still cut —
// unavoidable with a fixed-size list — but at ~17 staff and 15 rows fetched
// per source that would take an approval queue far past the point where a
// bell is the right tool anyway.
function prioritiseNotifications(items: AppNotification[], limit: number): AppNotification[] {
  const byNewest = (a: AppNotification, b: AppNotification) =>
    new Date(b.at).getTime() - new Date(a.at).getTime();
  const actionable = items.filter((n) => n.needsAction).sort(byNewest);
  const informational = items.filter((n) => !n.needsAction).sort(byNewest);
  return [...actionable, ...informational.slice(0, Math.max(0, limit - actionable.length))].slice(
    0,
    limit
  );
}

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

  // Prioritised here as well as in mergeNotifications(), not only there: this
  // function used to truncate to the ten most recent before the merge ever
  // saw the items, so a long-pending approval was already gone by the time
  // the two sources met. Both truncation points now use the same rule.
  return prioritiseNotifications(items, NOTIFICATION_LIMIT);
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
// truncation so the same item wins a slot regardless of which source it came
// from — actionable first, then the most recent informational ones.
export function mergeNotifications(...groups: AppNotification[][]): AppNotification[] {
  return prioritiseNotifications(groups.flat(), NOTIFICATION_LIMIT);
}

export function formatNotificationTime(at: string): string {
  return formatDistanceToNow(new Date(at), { addSuffix: true, locale: vi });
}
