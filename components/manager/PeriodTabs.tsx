"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { isCustomSpec, type OverviewRangeSpec } from "@/lib/attendance";

const OPTIONS = [
  { value: "day", label: "Theo ngày" },
  { value: "month", label: "Theo tháng" },
  { value: "year", label: "Theo năm" },
] as const;

// One shared `?p=` search param drives every period-scoped table on /manager
// (Tổng hợp chấm công, Ca làm việc, Tổng hợp đơn đã gửi) so the server can
// fetch only the selected window instead of shipping a year of rows and
// filtering client-side. Same URL-param pattern as DateRangeFilter and
// hooks/use-calendar-nav.ts — shareable, bookmarkable, server-owned.
//
// Switching period is now a real round-trip, so the pending state is not
// optional: without it the tabs look frozen while the RSC refetches.
//
// The `?from=`/`?to=` range is the mutually-exclusive fourth mode: while it's
// applied no tab is active (value=""), and picking a tab drops both params —
// one selector at a time, always.
export default function PeriodTabs({ spec }: { spec: OverviewRangeSpec }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const isCustom = isCustomSpec(spec);

  function select(next: string) {
    // In custom mode even the "current" period is a real change: it's what
    // takes the page back out of the range.
    if (!isCustom && next === spec.period) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("p", next);
    params.delete("from");
    params.delete("to");
    startTransition(() => {
      // scroll: false — the tabs can sit far down the page; jumping to the top
      // on every period switch would lose the manager's place.
      router.push(`/manager?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="flex items-center gap-2" aria-busy={isPending}>
      <Tabs value={isCustom ? "" : spec.period} onValueChange={select}>
        <TabsList
          className={cn("transition-opacity", isPending && "pointer-events-none opacity-60")}
        >
          {OPTIONS.map((option) => (
            <TabsTrigger key={option.value} value={option.value}>
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {isPending && (
        <Loader2Icon
          className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
          aria-hidden
        />
      )}
    </div>
  );
}
