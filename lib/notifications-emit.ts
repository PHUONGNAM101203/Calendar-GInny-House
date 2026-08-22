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

// Returns whether the rows were actually stored. Callers that own a
// "already notified" flag MUST check it before stamping that flag — see the
// attendance-reminders cron. Never throws: a caller that ignores the result
// still cannot be broken by a notification failure.
export async function emitNotifications(drafts: NotificationDraft[]): Promise<boolean> {
  if (!drafts.length) return true;

  // Enough context to identify what was lost without dumping message bodies
  // into the logs. Recipients are ids, not names.
  const context = {
    count: drafts.length,
    kinds: [...new Set(drafts.map((draft) => draft.kind))],
    recipients: drafts.map((draft) => draft.profileId),
  };

  let stored = false;
  try {
    // Supabase resolves with { error } instead of throwing, so this has to be
    // inspected explicitly. Discarding it meant a kind typo, a dropped column
    // or a rotated service-role key would silently break every notification
    // in the app with nothing in the logs — the first signal being a staff
    // member saying they were never told.
    const { error } = await supabaseAdmin.from("notifications").insert(
      drafts.map((draft) => ({
        profile_id: draft.profileId,
        kind: draft.kind,
        title: draft.title,
        body: draft.body,
        url: draft.url ?? null,
        related_id: draft.relatedId ?? null,
      }))
    );
    if (error) {
      console.error("[notifications] insert failed", { ...context, code: error.code, message: error.message });
    } else {
      stored = true;
    }
  } catch (error) {
    // Network-level failure — the client rejected rather than resolving.
    console.error("[notifications] insert threw", { ...context, error });
  }

  try {
    // Attempted even when the insert failed: a lost row is no reason to also
    // drop the push, which may be the only channel that still reaches them.
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
  } catch (error) {
    console.error("[notifications] push failed", { ...context, error });
  }

  return stored;
}

export async function emitNotification(draft: NotificationDraft): Promise<boolean> {
  return emitNotifications([draft]);
}
