// Server-only — writes rows into the `notifications` table (0077) and mirrors
// each one as a web push, so the minority of staff who did opt into push get
// both channels and everyone else still sees it in the bell.
//
// Every export here is best-effort by contract: a notification that fails to
// write must never fail the action that triggered it. Creating a shift has to
// succeed even if this whole module is broken, so each entry point swallows
// its own errors rather than propagating them to the caller. Callers should
// still wrap the call in after() (next/server) — see the rationale comment in
// actions/leave.ts about Vercel cutting off in-flight work once the response
// is sent.
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendPushToProfile } from "@/lib/push";

export type NotificationKind =
  | "shift_assigned"
  | "shift_updated"
  | "shift_unassigned"
  | "shift_deleted"
  | "missed_check_in"
  | "stale_check_out";

export type NotificationDraft = {
  profileId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  url?: string;
  relatedId?: string | null;
};

// Intl rather than date-fns, and the zone pinned explicitly, for the same
// reason as formatInVietnamDate in actions/attendance-corrections.ts: this
// server process has no TZ of its own, so a late-evening shift formatted
// without an explicit zone resolves to the wrong calendar day.
const VN_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
});

const VN_DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

// "08:00–12:00 ngày 22/08/2026". Baked into the stored body so the
// notification still says which shift it meant after the shift row is gone.
export function formatShiftWindow(startAt: string, endAt: string): string {
  return `${VN_TIME.format(new Date(startAt))}–${VN_TIME.format(new Date(endAt))} ngày ${VN_DATE.format(new Date(startAt))}`;
}

// "08:00 ngày 22/08/2026" — for the two cron events, which know one instant
// (shift start / check-in) rather than a window.
export function formatVietnamMoment(iso: string): string {
  return `${VN_TIME.format(new Date(iso))} ngày ${VN_DATE.format(new Date(iso))}`;
}

export async function emitNotifications(drafts: NotificationDraft[]): Promise<void> {
  if (!drafts.length) return;

  try {
    await supabaseAdmin.from("notifications").insert(
      drafts.map((draft) => ({
        profile_id: draft.profileId,
        kind: draft.kind,
        title: draft.title,
        body: draft.body,
        url: draft.url ?? null,
        related_id: draft.relatedId ?? null,
      }))
    );
  } catch {
    // Swallowed on purpose — see the module comment. The push below is still
    // worth attempting: a failed insert is no reason to also drop the push.
  }

  try {
    await Promise.all(
      drafts.map((draft) =>
        sendPushToProfile(draft.profileId, {
          title: draft.title,
          body: draft.body,
          url: draft.url,
          // Same tag collapses repeats of one kind into a single OS
          // notification instead of stacking duplicates.
          tag: draft.kind,
        })
      )
    );
  } catch {
    // Same contract as above.
  }
}

export async function emitNotification(draft: NotificationDraft): Promise<void> {
  await emitNotifications([draft]);
}
