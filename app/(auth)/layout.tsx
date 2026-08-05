import BrandMark from "@/components/brand/BrandMark";
import AuthIllustration from "@/components/brand/AuthIllustration";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-full flex-1 flex-col overflow-hidden bg-primary lg:flex-row">
      <BrandMark
        variant="white"
        className="pointer-events-none absolute -top-16 -right-24 size-[28rem] opacity-[0.06]"
      />
      <BrandMark
        variant="white"
        className="pointer-events-none absolute -bottom-24 -left-20 size-96 rotate-12 opacity-[0.06]"
      />

      {/* Brand panel — illustration only above lg; the logo/wordmark still
          show full-size on mobile just above the form, so the brand isn't
          lost when the two-column split collapses. */}
      <div className="relative z-10 hidden flex-1 flex-col items-center justify-center gap-12 px-12 py-16 lg:flex">
        <div className="flex flex-col items-center gap-3 text-center text-primary-foreground">
          <BrandMark variant="white" className="size-12" priority />
          <div>
            <p className="font-heading text-3xl font-semibold tracking-tight">Ginny House</p>
            <p className="mt-1.5 text-sm text-primary-foreground/70">
              Lịch làm việc &amp; đổi ca cho đội ngũ
            </p>
          </div>
        </div>
        <AuthIllustration />
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12">
        <div className="flex flex-col items-center gap-3 text-center text-primary-foreground lg:hidden">
          <BrandMark variant="white" className="size-10" priority />
          <div>
            <p className="font-heading text-2xl font-semibold tracking-tight">Ginny House</p>
            <p className="mt-1 text-sm text-primary-foreground/70">
              Lịch làm việc &amp; đổi ca cho đội ngũ
            </p>
          </div>
        </div>
        <div className="relative w-full max-w-sm">
          {/* Soft color glow behind the glass card — plain white-on-navy
              read as flat/default; this gives the card something to float
              on without touching the brand palette (gold + primary only). */}
          <span className="pointer-events-none absolute -top-10 -left-10 size-40 rounded-full bg-gold/30 blur-3xl" />
          <span className="pointer-events-none absolute -right-10 -bottom-10 size-48 rounded-full bg-chart-6/25 blur-3xl" />
          <div className="relative">{children}</div>
        </div>
      </div>
    </div>
  );
}
