import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendPushToProfiles } from "@/lib/push";

// Runs once/day via Vercel Cron (see vercel.json) to catch trợ giảng free
// (shiftless) clock-ins (0056) left open — there's no shift end_at for
// auto_checkout_expired_shifts (0031) to close these against, so a
// forgotten check-out just stays open until someone notices. Same open
// session gets re-notified every day it's still unresolved; the dashboard
// list (TechnicalDashboard) is the source of truth either way, this is
// just the nudge to go look at it.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` for any
// route listed in vercel.json's `crons` — this must match exactly, or
// anyone could trigger unlimited push sends by hitting this URL directly.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: stale, error } = await supabaseAdmin
    .from("attendance")
    .select("id, check_in_at, profile:profiles!profile_id(full_name)")
    .is("shift_id", null)
    .is("check_out_at", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!stale?.length) {
    return NextResponse.json({ staleCount: 0 });
  }

  const { data: technical } = await supabaseAdmin.from("profiles").select("id").eq("role", "technical");
  const technicalIds = (technical ?? []).map((p) => p.id);

  if (technicalIds.length) {
    await sendPushToProfiles(technicalIds, {
      title: "Chấm công trợ giảng chưa chấm ra",
      body:
        stale.length === 1
          ? "Có 1 phiên chấm công tự do đang mở quá lâu"
          : `Có ${stale.length} phiên chấm công tự do đang mở quá lâu`,
      url: "/manager",
      tag: "attendance-reminder",
    });
  }

  return NextResponse.json({ staleCount: stale.length, notified: technicalIds.length });
}
