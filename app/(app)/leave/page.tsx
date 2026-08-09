import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { isLeaveApprover, canApproveLeaveFor } from "@/lib/roles";
import { getGroupPermissions } from "@/lib/permissions-server";
import { PageHeader, SectionHeading, EmptyState } from "@/components/layout/PageChrome";
import LeaveRequestDialog from "@/components/leave/LeaveRequestDialog";
import LeaveRequestCard from "@/components/leave/LeaveRequestCard";
import type { LeaveRequestDetailed, Profile } from "@/types";

export default async function LeavePage() {
  const profile = await requireProfile();
  const isApprover = isLeaveApprover(profile.role);
  const supabase = await createClient();
  const permissions = await getGroupPermissions();

  // RLS scopes this per can_view_profile() (0013): own rows always, plus
  // whatever the viewer's role can see — everyone for ceo/technical, just
  // the matching group for coo/training_director, nothing extra otherwise.
  const { data } = await supabase
    .from("leave_requests")
    .select("*, profile:profiles!profile_id(id, full_name, role)")
    .order("created_at", { ascending: false });

  const requests = (data as (LeaveRequestDetailed & { profile: Pick<Profile, "id" | "full_name" | "role"> })[]) ?? [];
  const canRespondTo = (r: (typeof requests)[number]) =>
    isApprover && canApproveLeaveFor(profile.role, r.profile.role, permissions);
  // RLS visibility (can_view_profile_calendar) is now a superset of who an
  // approver can actually act on (can_view_profile, via canApproveLeaveFor)
  // — e.g. training_director can see but not approve teaching_assistant's
  // leave. Filter these two sections down to rows the viewer can act on,
  // so nothing shows up under "Chờ bạn duyệt" with no working buttons.
  const pending = requests.filter(
    (r) =>
      r.status === "pending" &&
      r.profile_id !== profile.id &&
      (!isApprover || canApproveLeaveFor(profile.role, r.profile.role, permissions))
  );
  const mine = requests.filter((r) => r.profile_id === profile.id);
  const history = requests.filter(
    (r) =>
      r.status !== "pending" &&
      r.profile_id !== profile.id &&
      (!isApprover || canApproveLeaveFor(profile.role, r.profile.role, permissions))
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 overflow-y-auto p-4 sm:p-6">
      <PageHeader
        eyebrow="Nghỉ phép"
        title="Xin nghỉ phép"
        description="Chỉ bạn và người duyệt nhìn thấy đơn này."
        action={<LeaveRequestDialog />}
      />

      {isApprover && (
        <section className="space-y-3">
          <SectionHeading title="Chờ bạn duyệt" count={pending.length} />
          {pending.length === 0 ? (
            <EmptyState>Không có đơn nào đang chờ duyệt.</EmptyState>
          ) : (
            <div className="space-y-3">
              {pending.map((r) => (
                <LeaveRequestCard
                  key={r.id}
                  request={r}
                  canRespond={canRespondTo(r)}
                  canCancel={false}
                  canDelete={false}
                  showName
                />
              ))}
            </div>
          )}
        </section>
      )}

      <section className="space-y-3">
        <SectionHeading title="Đơn của tôi" />
        {mine.length === 0 ? (
          <EmptyState>Bạn chưa gửi đơn nghỉ phép nào — bấm &quot;Xin nghỉ phép&quot; ở trên để tạo đơn đầu tiên.</EmptyState>
        ) : (
          <div className="space-y-3">
            {mine.map((r) => (
              <LeaveRequestCard
                key={r.id}
                request={r}
                canRespond={false}
                canCancel={r.status === "pending"}
                canDelete={false}
                showName={false}
              />
            ))}
          </div>
        )}
      </section>

      {isApprover && (
        <section className="space-y-3">
          <SectionHeading title="Lịch sử cơ sở" />
          {history.length === 0 ? (
            <EmptyState>Chưa có đơn nghỉ phép nào khác.</EmptyState>
          ) : (
            <div className="space-y-3">
              {history.map((r) => (
                <LeaveRequestCard
                  key={r.id}
                  request={r}
                  canRespond={false}
                  canCancel={false}
                  canDelete={false}
                  showName
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
