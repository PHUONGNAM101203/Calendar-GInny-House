import type { Metadata } from "next";
import Link from "next/link";
import BrandMark from "@/components/brand/BrandMark";
import Reveal from "@/components/landing/Reveal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Ginny House · Lịch làm việc cho đội ngũ",
  description:
    "Một lịch chung cho cả nhà Ginny — xếp ca, chấm công, đổi ca và nghỉ phép cho 3 cơ sở, trong một ứng dụng nội bộ.",
};

/* Chip trên bảng lịch hero — dùng đúng ngôn ngữ màu của sản phẩm thật:
   ca của mình = navy đặc, đồng nghiệp = tint theo người, chờ đổi ca = viền
   gạch vàng, ngày lễ = teal. Không phải screenshot — dựng lại bằng CSS để
   sắc nét ở mọi độ phân giải và tự đổi theo dark mode. */
function Chip({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "block truncate rounded-[5px] px-1.5 py-1 text-[10px] leading-tight font-medium",
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
    body: "Mở lịch ra là biết hôm nay làm với ai. Mỗi người một màu, riêng ca của bạn lúc nào cũng navy — liếc qua thấy ngay.",
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
  { code: "CS3", bar: "bg-success" },
] as const;

function HeroBoard() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none">
      {/* Thẻ chấm công nhỏ phía sau — lớp thứ hai tạo chiều sâu thật thay vì blur trang trí */}
      <div className="absolute -top-12 right-10 z-0 hidden rotate-2 rounded-xl border bg-card p-3 shadow-lg sm:block">
        <p className="text-[10px] font-extrabold tracking-wider text-muted-foreground uppercase">
          Chấm công
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
          <span className="size-2 rounded-full bg-success" />
          Đã vào ca · 08:02
        </p>
      </div>

      <div className="relative z-10 -rotate-1 rounded-2xl border bg-card p-4 shadow-2xl shadow-primary/15">
        <div className="mb-3 flex items-center justify-between">
          <p className="font-heading text-sm font-semibold">Tuần này · CS1</p>
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
                "pb-1 text-center text-[10px] font-medium",
                i === 2 ? "text-primary" : "text-muted-foreground"
              )}
            >
              {d}
            </p>
          ))}

          <div className="space-y-1.5">
            <Chip className="bg-primary text-primary-foreground">Nam · 8–12</Chip>
            <Chip className="bg-chart-3/18 text-chart-3">Vy · 13–17</Chip>
          </div>
          <div className="space-y-1.5">
            <Chip className="bg-chart-4/18 text-chart-4">Trang · 8–12</Chip>
            <Chip className="bg-primary text-primary-foreground">Nam · 13–17</Chip>
          </div>
          <div className="space-y-1.5">
            <Chip className="bg-success/15 font-semibold text-success">Quốc khánh</Chip>
            <Chip className="bg-chart-6/18 text-chart-6">Huy · 8–12</Chip>
          </div>
          <div className="space-y-1.5">
            <Chip className="bg-primary text-primary-foreground outline-2 outline-offset-1 outline-gold outline-dashed">
              Chờ đổi ca
            </Chip>
            <Chip className="bg-chart-5/18 text-chart-5">Linh · 13–17</Chip>
          </div>
          <div className="space-y-1.5">
            <Chip className="bg-chart-3/18 text-chart-3">Vy · 8–12</Chip>
            <Chip className="bg-primary text-primary-foreground">Nam · 17–21</Chip>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t pt-3">
          <p className="text-xs text-muted-foreground">Mỗi người một màu — của bạn luôn là navy.</p>
          <span className="flex -space-x-1.5">
            <span className="size-4 rounded-full bg-chart-3 ring-2 ring-card" />
            <span className="size-4 rounded-full bg-chart-4 ring-2 ring-card" />
            <span className="size-4 rounded-full bg-chart-5 ring-2 ring-card" />
            <span className="size-4 rounded-full bg-primary ring-2 ring-card" />
          </span>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="relative flex-1 overflow-x-clip">
      {/* watermark thương hiệu — cùng thủ pháp với màn hình đăng nhập */}
      <BrandMark className="pointer-events-none absolute -top-24 -right-32 -z-10 size-[30rem] opacity-[0.04]" />

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <div className="flex items-center gap-2.5">
          <BrandMark className="size-7" priority />
          <span className="font-heading text-lg font-semibold tracking-tight">Ginny House</span>
        </div>
        <nav className="flex items-center gap-2">
          <Button variant="ghost" asChild>
            <Link href="/register">Tạo tài khoản</Link>
          </Button>
          <Button asChild>
            <Link href="/login">Đăng nhập</Link>
          </Button>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-10 pb-20 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:gap-8 lg:pt-16">
        <div className="animate-in fade-in slide-in-from-bottom-4 fill-mode-both duration-700 motion-reduce:animate-none">
          <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Nội bộ Ginny House · 3 cơ sở
          </p>
          <h1 className="mt-4 font-heading text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl lg:text-[3.4rem]">
            Một lịch chung
            <br />
            cho cả nhà <span className="text-primary italic">Ginny</span>.
          </h1>
          <p className="mt-5 max-w-md text-base text-muted-foreground sm:text-lg">
            Hết cảnh nhắn nhóm hỏi «mai ai trực?». Ca của cả ba cơ sở nằm sẵn ở đây — ai làm, chỗ
            nào, mấy giờ. Đổi ca hay xin nghỉ cũng chỉ vài chạm.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" asChild>
              <Link href="/login">Vào lịch của bạn</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/register">Lần đầu dùng? Tạo tài khoản</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Dành riêng cho đội ngũ Ginny House — tài khoản do trung tâm cấp quyền.
          </p>
        </div>

        <div className="animate-in fade-in slide-in-from-bottom-6 fill-mode-both delay-150 duration-700 motion-reduce:animate-none">
          <HeroBoard />
        </div>
      </section>

      {/* Một ngày ở Ginny House — tính năng kể theo trình tự thật của một ca làm.
          content-visibility: trình duyệt bỏ qua layout/paint của section còn
          nằm dưới màn hình cho tới khi cuộn gần tới — lazy render không cần JS. */}
      <section className="border-y bg-muted/40 [content-visibility:auto] [contain-intrinsic-size:auto_620px]">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <Reveal>
            <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
              Tính năng
            </p>
            <h2 className="mt-3 max-w-lg font-heading text-3xl font-semibold tracking-tight text-balance">
              Một ngày làm việc, từ lúc vào ca đến lúc chốt sổ
            </h2>
          </Reveal>

          <ol className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-5">
            {DAY_MOMENTS.map((m, i) => (
              <li key={m.time} className="relative">
                <Reveal delay={i * 90}>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-primary tabular-nums">
                      {m.time}
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <h3 className="mt-3 font-heading text-base font-semibold">{m.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{m.body}</p>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 3 cơ sở — đúng bảng màu chi nhánh trong sản phẩm */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 [content-visibility:auto] [contain-intrinsic-size:auto_320px]">
        <div className="grid gap-6 lg:grid-cols-[1fr_2fr] lg:items-center">
          <Reveal>
            <h2 className="font-heading text-2xl font-semibold tracking-tight">
              Ba cơ sở, một nhịp làm việc
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Mỗi cơ sở một màu riêng trên lịch. Bạn nhìn đúng chỗ mình làm, quản lý nhìn được cả
              ba cùng lúc.
            </p>
          </Reveal>
          <div className="grid grid-cols-3 gap-3">
            {BRANCHES.map((b, i) => (
              <Reveal key={b.code} delay={i * 110}>
                <div className="overflow-hidden rounded-xl border bg-card transition-transform duration-300 hover:-translate-y-1 motion-reduce:transition-none">
                  <span className={cn("block h-1.5", b.bar)} />
                  <div className="p-4">
                    <p className="text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase">
                      Cơ sở
                    </p>
                    <p className="mt-1 font-heading text-2xl font-semibold">{b.code}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA cuối */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6 [content-visibility:auto] [contain-intrinsic-size:auto_360px]">
        {/* Dark mode đổi về card tối: --primary ở dark là xanh sáng, một mảng
            lớn màu đó sẽ chói và nuốt cả trang. Cùng quy ước với băng điều
            hành của dashboard. */}
        <Reveal>
        <div className="relative overflow-hidden rounded-2xl bg-primary px-6 py-12 text-primary-foreground sm:px-12 dark:border dark:bg-card dark:text-card-foreground">
          <BrandMark
            variant="white"
            className="pointer-events-none absolute -right-16 -bottom-20 size-72 opacity-[0.07]"
          />
          <div className="relative max-w-xl">
            <h2 className="font-heading text-3xl font-semibold tracking-tight text-balance">
              Ca tiếp theo của bạn đã ở trên lịch
            </h2>
            <p className="mt-2 text-sm text-primary-foreground/75 dark:text-muted-foreground">
              Đăng nhập là thấy ngay tuần này của bạn — chấm công, xin nghỉ, đổi ca, gói gọn trong
              vài chạm.
            </p>
            <Button size="lg" variant="secondary" className="mt-6 dark:border" asChild>
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
