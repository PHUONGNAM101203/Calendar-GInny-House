import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Nơi liên kết trong email khôi phục đáp xuống.
//
// Supabase gửi về một mã dùng một lần; phải đổi nó lấy phiên đăng nhập thì
// trang đặt mật khẩu mới mới sửa được mật khẩu. Không có bước này thì người
// dùng bấm liên kết xong sẽ rơi về /login mà không hiểu vì sao.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/calendar";

  // Chỉ nhận đường dẫn nội bộ. "//example.com" cũng là URL tuyệt đối dưới mắt
  // trình duyệt, nên chặn cả dấu gạch chéo kép — nếu không, một liên kết dựng
  // sẵn có thể đẩy người vừa bấm email sang tên miền của kẻ khác.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/calendar";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?loi=lien-ket`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?loi=lien-ket`);
  }

  return NextResponse.redirect(`${origin}${safeNext}`);
}
