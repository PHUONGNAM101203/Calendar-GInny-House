"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/date-picker-field";

// URL-param driven, mirroring hooks/use-calendar-nav.ts's pattern — keeps
// the range shareable/bookmarkable and lets the server component own the
// actual data fetch instead of client-side re-filtering.
export default function DateRangeFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [from, setFrom] = useState(searchParams.get("from") ?? "");
  const [to, setTo] = useState(searchParams.get("to") ?? "");

  const hasActiveFilter = searchParams.has("from") || searchParams.has("to");

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
    <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
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
  );
}
