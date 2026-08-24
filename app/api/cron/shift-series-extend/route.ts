import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Đợt 2 của "ca cố định": tops every open-ended series up to 12 weeks ahead.
//
// A series with no end date only ever materialises its first window at
// creation time; without this run it would quietly stop producing shifts
// twelve weeks later, which is the failure mode that kept "Không kết thúc"
// disabled until now (see the block comment in 0079's create_shift_series).
//
// Once a day is enough — the horizon is 84 days, so even several consecutive
// failed runs leave months of slack. 17:00 UTC is midnight in Vietnam, so the
// window advances at the start of the local day rather than mid-shift.
//
// Idempotent by construction: extend_shift_series() only ever moves forward
// from shift_series.materialised_through, so a retry within the same day
// creates nothing. That matters because Vercel Cron can fire a route more than
// once.
//
// The RPC is granted to service_role only, never to authenticated — it skips
// every per-user permission check (it has to, running without a session), so
// supabaseAdmin is the only client that may call it.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` for any route
// listed in vercel.json's `crons` — this must match exactly, or anyone could
// trigger unbounded shift creation by hitting this URL directly.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin.rpc("extend_shift_series");

  if (error) {
    // Logged and surfaced as a 500 rather than swallowed: unlike a missed
    // notification, a silent failure here means the roster simply stops
    // filling in, and nobody finds out until a week turns up empty.
    console.error("[cron/shift-series-extend] failed", {
      code: error.code,
      message: error.message,
    });
    return NextResponse.json({ error: "extend_shift_series failed" }, { status: 500 });
  }

  const result = (data ?? {}) as { series?: number; created?: number; through?: string };
  console.log("[cron/shift-series-extend] done", result);

  return NextResponse.json({
    ok: true,
    seriesExtended: result.series ?? 0,
    shiftsCreated: result.created ?? 0,
    through: result.through ?? null,
  });
}
