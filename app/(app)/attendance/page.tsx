import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, SectionHeading } from "@/components/layout/PageChrome";
import ClockWidget from "@/components/attendance/ClockWidget";
import AttendanceHistory from "@/components/attendance/AttendanceHistory";
import type { Attendance } from "@/types";

export default async function AttendancePage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data } = await supabase
    .from("attendance")
    .select("*")
    .eq("profile_id", profile.id)
    .order("check_in_at", { ascending: false })
    .limit(30);

  const records = (data as Attendance[]) ?? [];
  const open = records.find((r) => !r.check_out_at) ?? null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 overflow-y-auto p-4 sm:p-6">
      <PageHeader
        eyebrow="Chấm công"
        title="Vào ca, ra ca"
        description="Một nút bấm mỗi khi tới hoặc rời cơ sở."
      />

      <ClockWidget open={open} />

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
