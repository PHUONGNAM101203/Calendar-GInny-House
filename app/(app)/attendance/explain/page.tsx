import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, SectionHeading, EmptyState } from "@/components/layout/PageChrome";
import AttendanceCorrectionForm from "@/components/attendance/AttendanceCorrectionForm";
import AttendanceCorrectionCard from "@/components/attendance/AttendanceCorrectionCard";
import type { AttendanceCorrectionDetailed } from "@/types";

export default async function AttendanceExplainPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data } = await supabase
    .from("attendance_corrections")
    .select("*, profile:profiles!profile_id(id, full_name, role), shift:shifts!shift_id(id, start_at, end_at)")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false });

  const requests = (data as AttendanceCorrectionDetailed[]) ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 overflow-y-auto p-4 sm:p-6">
      <PageHeader
        eyebrow="Chấm công"
        title="Giải trình công"
        description="Quên chấm công hoặc chấm công trễ? Chọn ngày và gửi giải trình để quản lý duyệt."
      />

      <AttendanceCorrectionForm />

      <section className="space-y-3">
        <SectionHeading title="Đơn của tôi" />
        {requests.length === 0 ? (
          <EmptyState>Bạn chưa gửi đơn giải trình công nào.</EmptyState>
        ) : (
          <div className="space-y-3">
            {requests.map((r) => (
              <AttendanceCorrectionCard
                key={r.id}
                request={r}
                canRespond={false}
                canCancel={r.status === "pending"}
                canDelete={false}
                canRevert={false}
                showName={false}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
