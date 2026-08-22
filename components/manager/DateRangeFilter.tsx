"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format, parse } from "date-fns";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { isCustomSpec, type OverviewRangeSpec } from "@/lib/attendance";

// URL-param driven, mirroring hooks/use-calendar-nav.ts's pattern — keeps
// the range shareable/bookmarkable and lets the server component own the
// actual data fetch instead of client-side re-filtering.
//
// The range is a mode, not a modifier: while it's applied the Ngày/Tháng/Năm
// tabs go inactive (see PeriodTabs), and "Bỏ lọc" is the way back. The panel
// reports what the server ACTUALLY resolved (`spec`), not what's merely
// present in the URL — a half-filled or reversed range is ignored there, and
// saying so out loud is the difference between a filter that works and one
// that only looks like it does.
export default function DateRangeFilter({ spec }: { spec: OverviewRangeSpec }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [from, setFrom] = useState(searchParams.get("from") ?? "");
  const [to, setTo] = useState(searchParams.get("to") ?? "");

  const isCustom = isCustomSpec(spec);
  const hasActiveFilter = searchParams.has("from") || searchParams.has("to");
  const isIgnored = hasActiveFilter && !isCustom;

  const label = (value: string) => format(parse(value, "yyyy-MM-dd", new Date()), "dd/MM/yyyy");

  function apply() {
    const params = new URLSearchParams(searchParams.toString());
    if (from) params.set("from", from);
    else params.delete("from");
    if (to) params.set("to", to);
    else params.delete("to");
    startTransition(() => {
      router.push(`/manager?${params.toString()}`);
    });
  }

  function clear() {
    setFrom("");
    setTo("");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("from");
    params.delete("to");
    startTransition(() => {
      router.push(`/manager?${params.toString()}`);
    });
  }

  return (
    <div className="space-y-2 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <DatePickerField id="manager-from" label="Từ ngày" value={from} onChange={setFrom} />
        </div>
        <div className="w-40">
          <DatePickerField id="manager-to" label="Đến ngày" value={to} onChange={setTo} />
        </div>
        <Button type="button" size="sm" onClick={apply} disabled={isPending}>
          Áp dụng
        </Button>
        {hasActiveFilter && (
          <Button type="button" size="sm" variant="ghost" onClick={clear} disabled={isPending} className="gap-1">
            <XIcon className="size-3.5" />
            Bỏ lọc
          </Button>
        )}
      </div>

      {isCustom && spec.from && spec.to && (
        <p className="text-xs text-muted-foreground">
          Đang xem khoảng{" "}
          <span className="font-medium text-foreground tabular-nums">
            {label(spec.from)} – {label(spec.to)}
          </span>{" "}
          · các mốc Ngày/Tháng/Năm tạm tắt. Bấm “Bỏ lọc” hoặc chọn một mốc để quay lại.
        </p>
      )}
      {isIgnored && (
        <p className="text-xs text-muted-foreground">
          Chưa áp dụng được khoảng ngày — cần chọn cả “Từ ngày” và “Đến ngày”, và “Từ ngày” không được
          sau “Đến ngày”. Trang đang xem theo mốc Ngày/Tháng/Năm.
        </p>
      )}
    </div>
  );
}
