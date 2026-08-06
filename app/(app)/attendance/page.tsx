import Link from "next/link";
import { subHours, addHours } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, SectionHeading } from "@/components/layout/PageChrome";
import ClockWidget from "@/components/attendance/ClockWidget";
import AttendanceHistory from "@/components/attendance/AttendanceHistory";
import type { Attendance, Shift } from "@/types";

export default async function AttendancePage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const now = new Date();

  const [{ data }, { data: shiftRows }] = await Promise.all([
    supabase
      .from("attendance")
      .select("*")
      .eq("profile_id", profile.id)
      .order("check_in_at", { ascending: false })
      .limit(30),
    // Windowed by absolute instant, not calendar day — this server process
    // has no explicit TZ set, so a naive "today" (startOfDay) would resolve
    // against UTC, not Vietnam time, and silently miss the morning shift
    // for ~7 hours a day. clock_in()'s own window (start_at - 1h..end_at)
    // needs no day-boundary math either, for the same reason — comparing
    // timestamptz to timestamptz is timezone-agnostic. This fetch is UX
    // only (button enable/disable + messaging); clock_in() stays the
    // authoritative reject.
    supabase
      .from("shifts")
      .select("id, start_at, end_at")
      .eq("assignee_id", profile.id)
      .gte("start_at", subHours(now, 6).toISOString())
      .lte("start_at", addHours(now, 24).toISOString())
      .order("start_at"),
  ]);

  const records = (data as Attendance[]) ?? [];
  const open = records.find((r) => !r.check_out_at) ?? null;
  const shifts = (shiftRows as Pick<Shift, "id" | "start_at" | "end_at">[]) ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 overflow-y-auto p-4 sm:p-6">
      <PageHeader
        eyebrow="Chấm công"
        title="Vào ca, ra ca"
        description="Một nút bấm mỗi khi tới hoặc rời cơ sở."
      />

      <ClockWidget open={open} shifts={shifts} />

      <p className="text-sm text-muted-foreground">
        Quên chấm công hoặc chấm công trễ?{" "}
        <Link href="/attendance/explain" className="font-medium text-foreground underline underline-offset-4">
          Gửi giải trình
        </Link>
      </p>

      <section className="space-y-3">
        <SectionHeading title="Lịch sử của tôi" />
        <AttendanceHistory records={records} />
      </section>
    </div>
  );
}
