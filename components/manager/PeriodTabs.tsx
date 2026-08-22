"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { OverviewPeriod } from "@/lib/attendance";

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
export default function PeriodTabs({ period }: { period: OverviewPeriod }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function select(next: string) {
    if (next === period) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("p", next);
    startTransition(() => {
      // scroll: false — the tabs can sit far down the page; jumping to the top
      // on every period switch would lose the manager's place.
      router.push(`/manager?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="flex items-center gap-2" aria-busy={isPending}>
      <Tabs value={period} onValueChange={select}>
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
