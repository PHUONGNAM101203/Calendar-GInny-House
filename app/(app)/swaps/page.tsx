import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader, SectionHeading, EmptyState } from "@/components/layout/PageChrome";
import SwapRequestCard from "@/components/swaps/SwapRequestCard";
import type { SwapRequestDetailed } from "@/types";

const SELECT = `
  *,
  requester:profiles!requester_id(id, full_name),
  target:profiles!target_id(id, full_name),
  requester_shift:shifts!requester_shift_id(id, start_at, end_at, duty_role),
  target_shift:shifts!target_shift_id(id, start_at, end_at, duty_role)
`;

export default async function SwapRequestsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data } = await supabase
    .from("shift_swap_requests")
    .select(SELECT)
    .order("created_at", { ascending: false });

  const requests = (data as SwapRequestDetailed[]) ?? [];

  const awaitingMe = requests.filter(
    (r) =>
      r.status === "pending" &&
      r.requester_id !== profile.id &&
      (r.target_id === profile.id || r.target_id === null)
  );
  const mine = requests.filter((r) => r.requester_id === profile.id);
  const history = requests.filter(
    (r) =>
      r.status !== "pending" &&
      r.requester_id !== profile.id &&
      r.target_id !== profile.id
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 overflow-y-auto p-4 sm:p-6">
      <PageHeader
        eyebrow="Đổi ca"
        title="Xin đổi ca"
        description="Chọn ca của bạn, chọn ca muốn đổi, gửi cho đồng nghiệp."
      />

      <section className="space-y-3">
        <SectionHeading title="Chờ bạn phản hồi" count={awaitingMe.length} />
        {awaitingMe.length === 0 ? (
          <EmptyState>Không có yêu cầu nào đang chờ bạn.</EmptyState>
        ) : (
          <div className="space-y-3">
            {awaitingMe.map((r) => (
              <SwapRequestCard key={r.id} request={r} canRespond canCancel={false} canDelete={false} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeading title="Yêu cầu của tôi" />
        {mine.length === 0 ? (
          <EmptyState>Bạn chưa gửi yêu cầu đổi ca nào — mở lịch, chọn một ca của bạn để bắt đầu.</EmptyState>
        ) : (
          <div className="space-y-3">
            {mine.map((r) => (
              <SwapRequestCard key={r.id} request={r} canRespond={false} canCancel canDelete={false} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeading title="Lịch sử cơ sở" />
        {history.length === 0 ? (
          <EmptyState>Chưa có yêu cầu đổi ca nào khác.</EmptyState>
        ) : (
          <div className="space-y-3">
            {history.map((r) => (
              <SwapRequestCard key={r.id} request={r} canRespond={false} canCancel={false} canDelete={false} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
