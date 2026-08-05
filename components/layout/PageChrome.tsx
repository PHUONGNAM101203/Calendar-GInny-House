import { Badge } from "@/components/ui/badge";

/* Khung chung cho các trang "app trong app" (Chấm công, Xin nghỉ phép,
   Xin đổi ca): eyebrow mono + tiêu đề Fraunces + mô tả, heading section
   kiểu nhãn kỹ thuật, và empty-state đóng khung nét đứt thay cho một dòng
   chữ mồ côi. Server-safe — không "use client". */

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
      <div>
        <p className="font-mono text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
          {eyebrow}
        </p>
        <h1 className="mt-1.5 font-heading text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function SectionHeading({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <h2 className="font-heading text-lg font-semibold tracking-tight">{title}</h2>
      {count !== undefined && count > 0 && <Badge variant="gold">{count}</Badge>}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
