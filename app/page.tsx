import type { Metadata } from "next";
import Link from "next/link";
import BrandMark from "@/components/brand/BrandMark";
import Reveal from "@/components/landing/Reveal";
import TiltCard from "@/components/landing/TiltCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Ginny House · Lịch làm việc cho đội ngũ",
  description:
    "Một lịch chung cho cả nhà Ginny — xếp ca, chấm công, đổi ca và nghỉ phép cho 3 cơ sở, trong một ứng dụng nội bộ.",
};

/* Chip trên bảng lịch hero — nói đúng ngôn ngữ màu của sản phẩm thật: ca của
   mình xanh đặc, đồng nghiệp là tint theo người, chờ đổi ca viền gạch vàng.
   Dựng bằng CSS chứ không phải ảnh chụp, nên sắc nét ở mọi độ phân giải và tự
   đúng theo dark mode. */
function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "block truncate rounded-[6px] px-1.5 py-1 text-[10px] leading-tight font-semibold",
        className
      )}
    >
      {children}
    </span>
  );
}

const DAY_MOMENTS = [
  {
    time: "08:00",
    title: "Chấm công vào ca",
    body: "Tới nơi, bấm một nút là xong. Quên checkout hôm qua? Hệ thống chặn sẵn — mỗi người chỉ có một ca đang mở, không bấm trùng được.",
  },
  {
    time: "08:05",
    title: "Xem lịch cả cơ sở",
    body: "Mở lịch ra là biết hôm nay làm với ai. Mỗi người một màu, riêng ca của bạn lúc nào cũng xanh đậm — liếc qua thấy ngay.",
  },
  {
    time: "12:30",
    title: "Xin đổi ca",
    body: "Bận đột xuất? Chọn ca của mình, chọn ca muốn đổi, gửi thẳng cho đồng nghiệp. Hai bên bấm đồng ý là lịch tự đổi, khỏi nhắn nhóm.",
  },
  {
    time: "14:00",
    title: "Xin nghỉ phép",
    body: "Đơn nghỉ là chuyện riêng — chỉ bạn và người duyệt nhìn thấy. Chờ duyệt hay đã duyệt, mở app là biết, không phải hỏi lại.",
  },
  {
    time: "17:30",
    title: "Quản lý chốt sổ",
    body: "Cuối ngày mở dashboard: ai đang trong ca, mấy đơn chờ duyệt, tổng giờ làm cả tuần — đủ cả trên một màn hình.",
  },
] as const;

const BRANCHES = [
  { code: "CS1", bar: "bg-primary" },
  { code: "CS2", bar: "bg-gold" },
  { code: "CS3", bar: "bg-destructive" },
] as const;

function HeroBoard() {
  return (
    <TiltCard className="relative mx-auto w-full max-w-md lg:max-w-none">
      {/* Thẻ chấm công nổi cao hơn mặt bảng — độ sâu thật bằng translateZ chứ
          không phải đổ bóng giả. Khi nghiêng theo con trỏ nó dịch nhiều hơn mặt
          bảng bên dưới, và chính độ lệch đó khiến mắt đọc ra "có lớp". */}
      <div className="tilt-lift-2 absolute -top-10 right-8 z-20 hidden rounded-xl border bg-card p-3 shadow-[0_12px_32px_rgb(10_18_48/0.12)] sm:block">
        <p className="text-[10px] font-extrabold tracking-wider text-muted-foreground uppercase">
          Chấm công
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-sm font-bold tabular-nums">
          <span className="size-2 rounded-full bg-success" />
          Đã vào ca · 08:02
        </p>
      </div>

      <div className="tilt-lift-1 relative z-10 rounded-2xl border bg-card p-4 shadow-[0_12px_32px_rgb(10_18_48/0.12)]">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-extrabold">Tuần này · CS1</p>
          <p className="text-[10px] font-extrabold tracking-wider text-muted-foreground uppercase">
            Th 8 · 2026
          </p>
        </div>

        <div className="relative grid grid-cols-5 gap-1.5">
          {/* vạch "bây giờ" — dấu hiệu sống của một cuốn lịch thật */}
          <span className="pointer-events-none absolute top-[63%] right-0 left-0 z-20 h-0.5 bg-destructive/80">
            <span className="absolute top-1/2 -left-1 size-2 -translate-y-1/2 rounded-full bg-destructive" />
          </span>

          {(["T2", "T3", "T4", "T5", "T6"] as const).map((d, i) => (
            <p
              key={d}
              className={cn(
                "pb-1 text-center text-[10px] font-bold",
                i === 2 ? "text-primary" : "text-muted-foreground"
              )}
            >
              {d}
            </p>
          ))}

          <div className="space-y-1.5">
            <Chip className="bg-primary text-primary-foreground">Nam · 8–12</Chip>
            <Chip className="bg-chart-4/20 text-chart-4">Vy · 13–17</Chip>
          </div>
          <div className="space-y-1.5">
            <Chip className="bg-chart-2/25 text-gold-foreground">Trang · 8–12</Chip>
            <Chip className="bg-primary text-primary-foreground">Nam · 13–17</Chip>
          </div>
          <div className="space-y-1.5">
            <Chip className="bg-success/15 text-success">Quốc khánh</Chip>
            <Chip className="bg-chart-6/30 text-chart-1">Huy · 8–12</Chip>
          </div>
          <div className="space-y-1.5">
            <Chip className="bg-primary text-primary-foreground outline-2 outline-offset-1 outline-gold outline-dashed">
              Chờ đổi ca
            </Chip>
            <Chip className="bg-chart-5/20 text-chart-5">Linh · 13–17</Chip>
          </div>
          <div className="space-y-1.5">
            <Chip className="bg-chart-4/20 text-chart-4">Vy · 8–12</Chip>
            <Chip className="bg-primary text-primary-foreground">Nam · 17–21</Chip>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t pt-3">
          <p className="text-xs text-muted-foreground">Mỗi người một màu — của bạn luôn là xanh.</p>
          <span className="flex -space-x-1.5">
            <span className="size-4 rounded-full bg-chart-4 ring-2 ring-card" />
            <span className="size-4 rounded-full bg-chart-2 ring-2 ring-card" />
            <span className="size-4 rounded-full bg-chart-5 ring-2 ring-card" />
            <span className="size-4 rounded-full bg-primary ring-2 ring-card" />
          </span>
        </div>
      </div>
    </TiltCard>
  );
}

export default function LandingPage() {
  return (
    <div className="relative flex-1 overflow-x-clip">
      {/* Watermark thương hiệu — cùng thủ pháp với màn hình đăng nhập. Giữ ở 4%
          để nó là kết cấu nền, không phải một hình minh hoạ. */}
      <BrandMark className="pointer-events-none absolute -top-24 -right-32 -z-10 size-[30rem] opacity-[0.04]" />

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <div className="flex items-center gap-2.5">
          <BrandMark className="size-7" priority />
          <span className="text-lg font-extrabold tracking-tight">Ginny House</span>
        </div>
        <nav className="flex items-center gap-2">
          <Button variant="ghost" asChild>
            <Link href="/register">Tạo tài khoản</Link>
          </Button>
          <Button variant="cta" asChild>
            <Link href="/login">Đăng nhập</Link>
          </Button>
        </nav>
      </header>

      {/* Hero — scene-3d đặt ở section chứ không ở từng thẻ, để bảng lịch và thẻ
          chấm công dùng chung một điểm tụ thay vì mỗi khối một phối cảnh riêng. */}
      <section className="scene-3d mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-10 pb-20 sm:px-6 lg:grid-cols-[minmax(0,1fr)_1.05fr] lg:gap-8 lg:pt-16">
        <div className="animate-in fade-in slide-in-from-bottom-4 fill-mode-both duration-300 motion-reduce:animate-none">
          <p className="text-xs font-extrabold tracking-[0.2em] text-primary uppercase">
            Nội bộ Ginny House · 3 cơ sở
          </p>
          <h1 className="mt-4 text-4xl leading-[1.05] font-black tracking-tight text-balance sm:text-5xl lg:text-[3.4rem]">
            Một lịch chung
            <br />
            cho cả nhà <span className="text-primary">Ginny</span>.
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed font-medium text-muted-foreground">
            Hết cảnh nhắn nhóm hỏi «mai ai trực?». Ca của cả ba cơ sở nằm sẵn ở đây — ai làm, chỗ
            nào, mấy giờ. Đổi ca hay xin nghỉ cũng chỉ vài chạm.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" variant="cta" asChild>
              <Link href="/login">Vào lịch của bạn</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/register">Tạo tài khoản</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Dành riêng cho đội ngũ Ginny House — tài khoản do trung tâm cấp quyền.
          </p>
        </div>

        <div className="animate-in fade-in slide-in-from-bottom-6 fill-mode-both delay-150 duration-300 motion-reduce:animate-none">
          <HeroBoard />
        </div>
      </section>

      {/* Một ngày ở Ginny House — tính năng kể theo trình tự thật của một ca làm.
          content-visibility: trình duyệt bỏ qua layout/paint của section còn nằm
          dưới màn hình cho tới khi cuộn gần tới — lazy render không cần JS. */}
      <section className="scene-3d border-y bg-muted/50 [contain-intrinsic-size:auto_620px] [content-visibility:auto]">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <Reveal>
            <h2 className="max-w-lg text-3xl font-extrabold tracking-tight text-balance">
              Một ngày làm việc, từ lúc vào ca đến lúc chốt sổ
            </h2>
          </Reveal>

          <ol className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-5">
            {DAY_MOMENTS.map((m, i) => (
              <li key={m.time} className="relative">
                {/* Trồi lên về phía người đọc thay vì trượt ngang — dùng chung
                    observer với Reveal thường nên thừa hưởng luôn xử lý
                    prefers-reduced-motion và cơ chế chạy-một-lần. */}
                <Reveal depth delay={i * 70}>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-black text-primary tabular-nums">{m.time}</span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <h3 className="mt-3 text-base font-extrabold">{m.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{m.body}</p>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 3 cơ sở — đúng bảng màu chi nhánh trong sản phẩm */}
      <section className="scene-3d mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 [contain-intrinsic-size:auto_320px] [content-visibility:auto]">
        <div className="grid gap-6 lg:grid-cols-[1fr_2fr] lg:items-center">
          <Reveal>
            <h2 className="text-2xl font-extrabold tracking-tight">Ba cơ sở, một nhịp làm việc</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Mỗi cơ sở một màu riêng trên lịch. Bạn nhìn đúng chỗ mình làm, quản lý nhìn được cả ba
              cùng lúc.
            </p>
          </Reveal>
          <div className="grid grid-cols-3 gap-3">
            {BRANCHES.map((b, i) => (
              <Reveal depth key={b.code} delay={i * 80}>
                <TiltCard intensity={0.6}>
                  <div className="overflow-hidden rounded-xl border bg-card">
                    <span className={cn("block h-1.5", b.bar)} />
                    <div className="p-4">
                      <p className="text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase">
                        Cơ sở
                      </p>
                      <p className="mt-1 text-2xl font-black">{b.code}</p>
                    </div>
                  </div>
                </TiltCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA cuối — nền xanh, không phải đỏ. Guideline giới hạn đỏ ở ~10% diện
          tích và loại thẳng "đỏ làm nền lớn"; một panel cỡ này phủ đỏ là vi phạm
          rõ ràng. Đỏ ở đây chỉ nằm trên nút. */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6 [contain-intrinsic-size:auto_360px] [content-visibility:auto]">
        <Reveal>
          <div className="relative overflow-hidden rounded-2xl bg-primary px-6 py-12 text-primary-foreground sm:px-12 dark:border dark:bg-card dark:text-card-foreground">
            <BrandMark
              variant="white"
              className="pointer-events-none absolute -right-16 -bottom-20 size-72 opacity-[0.07]"
            />
            <div className="relative max-w-xl">
              <h2 className="text-3xl font-extrabold tracking-tight text-balance">
                Ca tiếp theo của bạn đã ở trên lịch
              </h2>
              <p className="mt-2 text-sm text-primary-foreground/80 dark:text-muted-foreground">
                Đăng nhập là thấy ngay tuần này của bạn — chấm công, xin nghỉ, đổi ca, gói gọn trong
                vài chạm.
              </p>
              <Button size="lg" variant="cta" className="mt-6" asChild>
                <Link href="/login">Đăng nhập ngay</Link>
              </Button>
            </div>
          </div>
        </Reveal>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 sm:px-6">
          <div className="flex items-center gap-2">
            <BrandMark className="size-5" />
            <span className="text-sm text-muted-foreground">
              Ginny House — ứng dụng vận hành nội bộ
            </span>
          </div>
          <p className="text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase">
            Asia/Ho_Chi_Minh · GMT+7
          </p>
        </div>
      </footer>
    </div>
  );
}
