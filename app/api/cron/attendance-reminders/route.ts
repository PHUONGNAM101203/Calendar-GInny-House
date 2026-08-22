import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendPushToProfiles } from "@/lib/push";
import { emitNotifications, formatVietnamMoment } from "@/lib/notifications-emit";

type LateCheckinRow = { shift_id: string; profile_id: string; full_name: string; start_at: string };
type StaleCheckoutRow = {
  attendance_id: string;
  profile_id: string;
  full_name: string;
  check_in_at: string;
  shift_id: string | null;
};

// Runs hourly via Vercel Cron (see vercel.json) — now that the project is
// on Pro, not the once-daily ceiling Hobby forced (see git history for the
// 0063 migration this superseded). Catches two things Kỹ thuật needs to
// know about:
//  1. "quá giờ vào ca" — a registered shift started >15min ago with no
//     matching attendance row at all (a no-show, or someone who simply
//     forgot to clock in). Window is tied to end_at + 2h (0065) — narrowed
//     back down from 0063's flat 24h now that hourly runs don't need a
//     wide window to avoid missing shifts between cron firings.
//  2. "quá giờ ra ca" — an open (not checked out) attendance session that
//     should have ended by now: either a shiftless (trợ giảng) free
//     clock-in open >30min, or a shift-tied session still open >15min
//     past the shift's end_at. This replaces the old free-clock-in-only
//     check (0056) with one that covers every open session uniformly.
//
// Each shift/session is only ever notified about ONCE — see
// find_late_checkin_shifts()/find_stale_checkout_sessions() (0062/0063)
// and the late_checkin_notified_at/stale_checkout_notified_at columns
// (0061) — without this, a shift still uncorrected the next day would get
// re-flagged on every subsequent daily run.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` for any
// route listed in vercel.json's `crons` — this must match exactly, or
// anyone could trigger unlimited push sends by hitting this URL directly.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: technical } = await supabaseAdmin.from("profiles").select("id").eq("role", "technical");
  const technicalIds = (technical ?? []).map((p) => p.id);

  const [{ data: lateShifts, error: lateError }, { data: staleSessions, error: staleError }] = await Promise.all([
    supabaseAdmin.rpc("find_late_checkin_shifts"),
    supabaseAdmin.rpc("find_stale_checkout_sessions"),
  ]);

  if (lateError || staleError) {
    return NextResponse.json({ error: (lateError ?? staleError)!.message }, { status: 500 });
  }

  const late = (lateShifts as LateCheckinRow[]) ?? [];
  const stale = (staleSessions as StaleCheckoutRow[]) ?? [];

  if (technicalIds.length && late.length) {
    await sendPushToProfiles(technicalIds, {
      title: "Chưa chấm công vào ca",
      body:
        late.length === 1
          ? `${late[0].full_name} đã quá giờ vào ca mà chưa chấm công`
          : `${late.length} người đã quá giờ vào ca mà chưa chấm công`,
      url: "/manager",
      tag: "attendance-late-checkin",
    });
  }
  // The per-person half of the same detection. The digest above is oversight
  // tooling for Kỹ thuật and stays; this tells the staff member themselves,
  // which nothing did before. Both ride the SAME de-duplication — the
  // notified_at stamp below — so nobody is told twice about one shift.
  if (late.length) {
    const stored = await emitNotifications(
      late.map((s) => ({
        profileId: s.profile_id,
        kind: "missed_check_in" as const,
        title: "Bạn chưa chấm công vào ca",
        body: `Ca ${formatVietnamMoment(s.start_at)} đã bắt đầu nhưng bạn chưa chấm công vào`,
        url: "/attendance",
        relatedId: s.shift_id,
      }))
    );
    // Only stamp once the rows are actually stored. Stamping regardless would
    // burn the one-shot flag on a failed insert and lose these events
    // permanently; leaving it unstamped means the next hourly run retries
    // them. The cost is that Kỹ thuật may see its digest twice for the same
    // shift while the insert keeps failing — recoverable noise, and a louder
    // signal than silence.
    if (stored) {
      await supabaseAdmin
        .from("shifts")
        .update({ late_checkin_notified_at: new Date().toISOString() })
        .in(
          "id",
          late.map((s) => s.shift_id)
        );
    }
  }

  if (technicalIds.length && stale.length) {
    await sendPushToProfiles(technicalIds, {
      title: "Chưa chấm công ra",
      body:
        stale.length === 1
          ? `${stale[0].full_name} đã quá giờ ra ca mà chưa chấm công ra`
          : `${stale.length} phiên chấm công đang mở quá lâu`,
      url: "/manager",
      tag: "attendance-stale-checkout",
    });
  }
  // Per-person half, as above — same rows, same one-shot stamp.
  if (stale.length) {
    const stored = await emitNotifications(
      stale.map((s) => ({
        profileId: s.profile_id,
        kind: "stale_check_out" as const,
        title: "Bạn chưa chấm công ra",
        body: `Bạn đã chấm công vào lúc ${formatVietnamMoment(s.check_in_at)} nhưng chưa chấm công ra`,
        url: "/attendance",
        relatedId: s.attendance_id,
      }))
    );
    // Same retry-over-silent-loss tradeoff as the late-check-in stamp above.
    if (stored) {
      await supabaseAdmin
        .from("attendance")
        .update({ stale_checkout_notified_at: new Date().toISOString() })
        .in(
          "id",
          stale.map((s) => s.attendance_id)
        );
    }
  }

  return NextResponse.json({
    lateCheckinCount: late.length,
    staleCheckoutCount: stale.length,
    notified: technicalIds.length,
  });
}
