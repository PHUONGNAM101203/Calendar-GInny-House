import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendPushToProfiles } from "@/lib/push";
import { canAccessManagerPage } from "@/lib/roles";

// Runs Sunday night via Vercel Cron (see vercel.json) — a weekly digest for
// everyone who can already see /manager (ceo/coo/training_director/hr/
// technical, see canAccessManagerPage), summarizing how many requests of
// each kind came in this week and how many hours the whole org worked.
// Deliberately a single org-wide number, not per-person — this is a
// heartbeat check ("did this week look normal"), not a payroll report;
// per-person totals already live in /manager's own overview table.
//
// Auth: same CRON_SECRET Bearer pattern as attendance-reminders.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Vietnam has no DST and is always UTC+7 — shift "now" into that offset
  // purely to read ICT calendar fields (day-of-week, date) off the UTC
  // getters, then convert the resulting ICT-midnight-Monday back to the
  // real UTC instant for the actual query bounds. Same reasoning as the
  // attendance page's own note on avoiding local-timezone date math.
  const nowUtc = new Date();
  const ictNow = new Date(nowUtc.getTime() + 7 * 60 * 60 * 1000);
  const ictDay = ictNow.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const daysSinceMonday = ictDay === 0 ? 6 : ictDay - 1;
  const ictMondayMidnight = Date.UTC(
    ictNow.getUTCFullYear(),
    ictNow.getUTCMonth(),
    ictNow.getUTCDate() - daysSinceMonday
  );
  const weekStart = new Date(ictMondayMidnight - 7 * 60 * 60 * 1000);
  const weekEnd = nowUtc;

  const [
    { count: leaveCount, error: leaveError },
    { count: swapCount, error: swapError },
    { count: shiftRequestCount, error: shiftRequestError },
    { count: correctionCount, error: correctionError },
    { data: attendanceRows, error: attendanceError },
    { data: profiles, error: profilesError },
  ] = await Promise.all([
    supabaseAdmin
      .from("leave_requests")
      .select("id", { count: "exact", head: true })
      .gte("created_at", weekStart.toISOString())
      .lte("created_at", weekEnd.toISOString()),
    supabaseAdmin
      .from("shift_swap_requests")
      .select("id", { count: "exact", head: true })
      .gte("created_at", weekStart.toISOString())
      .lte("created_at", weekEnd.toISOString()),
    supabaseAdmin
      .from("shift_requests")
      .select("id", { count: "exact", head: true })
      .gte("created_at", weekStart.toISOString())
      .lte("created_at", weekEnd.toISOString()),
    supabaseAdmin
      .from("attendance_corrections")
      .select("id", { count: "exact", head: true })
      .gte("created_at", weekStart.toISOString())
      .lte("created_at", weekEnd.toISOString()),
    // Any session that could overlap the week at all: started before it
    // ended (or is still open) and, if closed, didn't close before it
    // started — the exact same overlap shape buildStaffOverview() uses,
    // just summed across everyone instead of grouped per profile.
    supabaseAdmin
      .from("attendance")
      .select("check_in_at, check_out_at")
      .lte("check_in_at", weekEnd.toISOString())
      .or(`check_out_at.is.null,check_out_at.gte.${weekStart.toISOString()}`),
    supabaseAdmin.from("profiles").select("id, role"),
  ]);

  const firstError = leaveError ?? swapError ?? shiftRequestError ?? correctionError ?? attendanceError ?? profilesError;
  if (firstError) {
    return NextResponse.json({ error: firstError.message }, { status: 500 });
  }

  let totalMinutes = 0;
  for (const r of attendanceRows ?? []) {
    const checkIn = new Date(r.check_in_at);
    const effectiveEnd = r.check_out_at ? new Date(r.check_out_at) : nowUtc;
    const overlapStart = checkIn > weekStart ? checkIn : weekStart;
    const overlapEnd = effectiveEnd < weekEnd ? effectiveEnd : weekEnd;
    if (overlapEnd > overlapStart) {
      totalMinutes += (overlapEnd.getTime() - overlapStart.getTime()) / 60000;
    }
  }
  const totalHours = Math.round(totalMinutes / 60);

  const recipientIds = (profiles ?? []).filter((p) => canAccessManagerPage(p.role)).map((p) => p.id);

  if (recipientIds.length) {
    await sendPushToProfiles(recipientIds, {
      title: "Tổng kết tuần",
      body: `Tuần này: ${leaveCount ?? 0} nghỉ phép, ${swapCount ?? 0} đổi ca, ${shiftRequestCount ?? 0} đăng ký ca, ${correctionCount ?? 0} giải trình · ${totalHours} giờ làm toàn hệ thống`,
      url: "/manager",
      tag: "weekly-summary",
    });
  }

  return NextResponse.json({
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    leaveCount: leaveCount ?? 0,
    swapCount: swapCount ?? 0,
    shiftRequestCount: shiftRequestCount ?? 0,
    correctionCount: correctionCount ?? 0,
    totalHours,
    notified: recipientIds.length,
  });
}
