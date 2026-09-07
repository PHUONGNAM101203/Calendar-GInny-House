import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { emitNotifications } from "@/lib/notifications-emit";
import { canAccessManagerPage } from "@/lib/roles";

// Tổng kết tháng, gửi lúc 22:00 ngày cuối tháng (giờ Việt Nam) — cùng nhóm
// người nhận và cùng các con số như bản tuần, chỉ khác cửa sổ thời gian.
//
// Cron KHÔNG diễn đạt được "ngày cuối tháng": số ngày mỗi tháng khác nhau và
// tháng 2 còn đổi theo năm nhuận. Nên vercel.json hẹn chạy các ngày 28–31 rồi
// route tự thoát sớm nếu hôm nay chưa phải ngày cuối. Đây là cách làm chuẩn
// cho bài toán này, và nó tự đúng với cả tháng 28, 29, 30 lẫn 31 ngày mà
// không cần bảng tra nào.
//
// Mọi phép tính ngày đều quy về giờ Việt Nam trước, y như bản tuần: tiến trình
// chạy ở UTC nên đọc thẳng ngày từ nó sẽ lệch 7 tiếng — đúng cái bẫy đã làm
// sai giờ của sự kiện lịch cá nhân trước đây.
//
// Auth: cùng kiểu Bearer CRON_SECRET như các cron khác.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nowUtc = new Date();
  const ictNow = new Date(nowUtc.getTime() + 7 * 60 * 60 * 1000);
  const ictYear = ictNow.getUTCFullYear();
  const ictMonth = ictNow.getUTCMonth();
  const ictDate = ictNow.getUTCDate();

  // Ngày cuối tháng theo lịch Việt Nam. Date.UTC(y, m + 1, 0) trả về "ngày 0"
  // của tháng sau, tức ngày cuối của tháng này.
  const lastDateOfMonth = new Date(Date.UTC(ictYear, ictMonth + 1, 0)).getUTCDate();
  if (ictDate !== lastDateOfMonth) {
    // Không phải lỗi — cron cố ý chạy mỗi ngày 28–31 và chỉ một trong số đó
    // là ngày thật. Trả 200 để Vercel không đánh dấu run này là thất bại.
    return NextResponse.json({ skipped: true, reason: "chưa phải ngày cuối tháng" });
  }

  const monthStart = new Date(Date.UTC(ictYear, ictMonth, 1) - 7 * 60 * 60 * 1000);
  const monthEnd = nowUtc;

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
      .gte("created_at", monthStart.toISOString())
      .lte("created_at", monthEnd.toISOString()),
    supabaseAdmin
      .from("shift_swap_requests")
      .select("id", { count: "exact", head: true })
      .gte("created_at", monthStart.toISOString())
      .lte("created_at", monthEnd.toISOString()),
    supabaseAdmin
      .from("shift_requests")
      .select("id", { count: "exact", head: true })
      .gte("created_at", monthStart.toISOString())
      .lte("created_at", monthEnd.toISOString()),
    supabaseAdmin
      .from("attendance_corrections")
      .select("id", { count: "exact", head: true })
      .gte("created_at", monthStart.toISOString())
      .lte("created_at", monthEnd.toISOString()),
    // Cùng hình dạng "có giao nhau với khoảng" mà bản tuần dùng: bắt đầu
    // trước khi khoảng kết thúc, và nếu đã đóng thì không đóng trước khi
    // khoảng bắt đầu.
    supabaseAdmin
      .from("attendance")
      .select("check_in_at, check_out_at")
      .lte("check_in_at", monthEnd.toISOString())
      .or(`check_out_at.is.null,check_out_at.gte.${monthStart.toISOString()}`),
    supabaseAdmin.from("profiles").select("id, role"),
  ]);

  const firstError =
    leaveError ??
    swapError ??
    shiftRequestError ??
    correctionError ??
    attendanceError ??
    profilesError;
  if (firstError) {
    console.error("[cron/monthly-summary] query failed", firstError.message);
    return NextResponse.json({ error: firstError.message }, { status: 500 });
  }

  // Chỉ tính phần giờ nằm TRONG tháng: một phiên bắc cầu qua đầu tháng không
  // được tính trọn vào tháng này.
  let totalMinutes = 0;
  for (const row of attendanceRows ?? []) {
    const checkIn = new Date(row.check_in_at);
    const effectiveEnd = row.check_out_at ? new Date(row.check_out_at) : nowUtc;
    const overlapStart = checkIn > monthStart ? checkIn : monthStart;
    const overlapEnd = effectiveEnd < monthEnd ? effectiveEnd : monthEnd;
    if (overlapEnd > overlapStart) {
      totalMinutes += (overlapEnd.getTime() - overlapStart.getTime()) / 60000;
    }
  }
  const totalHours = Math.round(totalMinutes / 60);

  const recipientIds = (profiles ?? []).filter((p) => canAccessManagerPage(p.role)).map((p) => p.id);

  const monthLabel = `${String(ictMonth + 1).padStart(2, "0")}/${ictYear}`;
  const body =
    `Tháng ${monthLabel}: ${leaveCount ?? 0} nghỉ phép, ${swapCount ?? 0} đổi ca, ` +
    `${shiftRequestCount ?? 0} đăng ký ca, ${correctionCount ?? 0} giải trình · ` +
    `${totalHours} giờ làm toàn hệ thống`;

  if (recipientIds.length) {
    // emitNotifications chứ không phải sendPushToProfiles: nó vừa lưu hàng vào
    // bảng notifications vừa mirror thành push, nên bản tổng kết còn đọc được
    // trong chuông. Push là kênh gần như không ai bật (xem thiết kế thông báo
    // 2026-08-22), nên chỉ push thôi thì gần như không tới được ai.
    await emitNotifications(
      recipientIds.map((profileId) => ({
        profileId,
        kind: "monthly_summary" as const,
        title: "Tổng kết tháng",
        body,
        url: "/manager",
      }))
    );
  }

  console.log("[cron/monthly-summary] sent", { monthLabel, recipients: recipientIds.length });

  return NextResponse.json({
    monthStart: monthStart.toISOString(),
    monthEnd: monthEnd.toISOString(),
    leaveCount: leaveCount ?? 0,
    swapCount: swapCount ?? 0,
    shiftRequestCount: shiftRequestCount ?? 0,
    correctionCount: correctionCount ?? 0,
    totalHours,
    recipients: recipientIds.length,
  });
}
