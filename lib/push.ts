// Server-only — sends real OS-level web push notifications (browser +
// installed PWA), independent of the in-app notification bell. Called
// fire-and-forget (`void sendPush...(...)`) from Server Actions right after
// a mutation succeeds, so a slow/failed push never blocks or fails the
// actual request/response flow the user is waiting on.
import webpush from "web-push";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { canApproveLeaveFor, canApproveShiftRequestFor, isManagerRole } from "@/lib/roles";
import { getGroupPermissions } from "@/lib/permissions-server";
import type { Role } from "@/types";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

// Missing keys just means push is silently disabled (e.g. a fresh clone
// without VAPID configured yet) — never crash the calling action over it.
const configured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
if (configured) {
  webpush.setVapidDetails(VAPID_SUBJECT!, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  // Same tag replaces a still-unread OS notification instead of stacking a
  // duplicate — e.g. two leave-approval pushes in a row show as one.
  tag?: string;
};

type SubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string };

async function sendToSubscription(sub: SubscriptionRow, payload: PushPayload): Promise<void> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
  } catch (error) {
    // 404/410 = the browser unsubscribed or the subscription expired —
    // stop trying it going forward instead of erroring on every future send.
    const statusCode = (error as { statusCode?: number } | null)?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
    }
  }
}

export async function sendPushToProfile(profileId: string, payload: PushPayload): Promise<void> {
  if (!configured) return;
  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("profile_id", profileId);
  if (!subs?.length) return;
  await Promise.all(subs.map((sub) => sendToSubscription(sub, payload)));
}

export async function sendPushToProfiles(profileIds: string[], payload: PushPayload): Promise<void> {
  await Promise.all(profileIds.map((id) => sendPushToProfile(id, payload)));
}

// Same approver-candidate-role pattern as canApproveLeaveFor/
// canApproveShiftRequestFor in lib/roles.ts — fetch everyone in a role that
// *could* approve this kind of request, then keep only the ones the
// existing predicate actually grants for this specific target role.
const LEAVE_APPROVER_CANDIDATE_ROLES: Role[] = ["ceo", "coo", "training_director", "hr", "technical"];
const SHIFT_REQUEST_APPROVER_CANDIDATE_ROLES: Role[] = [
  "ceo",
  "coo",
  "training_director",
  "hr",
  "technical",
];

// Push mirrors the in-app notification bell, rather than the approval
// predicates it used to gate on.
//
// The bell shows a pending request to every oversight role
// (buildNotifications() gates on isManagerRole(), which includes technical),
// but push only went to whoever could actually *approve* it. So people
// watched notifications pile up in the header with their phone silent —
// worst for technical, which approves nothing by design and therefore
// received zero pushes ever.
//
// Anyone in an oversight role now gets the push. This grants no authority:
// every real permission check still runs through canApprove*For and the SQL
// predicates, so seeing a request and being able to act on it stay separate.
function isPushOversightRole(role: Role): boolean {
  return isManagerRole(role) || role === "hr" || role === "technical";
}

export async function sendPushToLeaveApprovers(targetRole: Role, payload: PushPayload): Promise<void> {
  if (!configured) return;
  const permissions = await getGroupPermissions();
  const { data } = await supabaseAdmin.from("profiles").select("id, role").in("role", LEAVE_APPROVER_CANDIDATE_ROLES);
  const ids = (data ?? [])
    .filter((p) => isPushOversightRole(p.role) || canApproveLeaveFor(p.role, targetRole, permissions))
    .map((p) => p.id);
  await sendPushToProfiles(ids, payload);
}

export async function sendPushToShiftRequestApprovers(targetRole: Role, payload: PushPayload): Promise<void> {
  if (!configured) return;
  const permissions = await getGroupPermissions();
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .in("role", SHIFT_REQUEST_APPROVER_CANDIDATE_ROLES);
  const ids = (data ?? [])
    .filter((p) => isPushOversightRole(p.role) || canApproveShiftRequestFor(p.role, targetRole, permissions))
    .map((p) => p.id);
  await sendPushToProfiles(ids, payload);
}
