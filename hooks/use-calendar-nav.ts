"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format, parse, isValid } from "date-fns";
import type { CalendarView } from "@/lib/calendar";

const DATE_FORMAT = "yyyy-MM-dd";

/** @param defaultView what to show when the URL carries no explicit `?view=`.
 *  The server picks this (day on phones, week otherwise) so the first paint is
 *  already correct — passing it in is what lets the client agree with the
 *  server instead of correcting it after hydration. */
export function useCalendarNav(defaultView: CalendarView = "week") {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const urlDate = useMemo(() => {
    const raw = searchParams.get("date");
    // Parsed as a *local* calendar date, not new Date(raw) — that parses
    // "yyyy-MM-dd" as UTC midnight, which lands on the previous day once
    // shifted into a positive UTC-offset timezone (e.g. GMT+7). That
    // mismatch was the "picking a day jumps to the day before" bug.
    const parsed = raw ? parse(raw, DATE_FORMAT, new Date()) : new Date();
    return isValid(parsed) ? parsed : new Date();
  }, [searchParams]);

  const view = (searchParams.get("view") as CalendarView) || defaultView;

  // Clicking a day in the mini-month should feel instant, not wait on a
  // server round-trip for the new date range's shifts. This optimistic date
  // renders the picked day as selected immediately; it's cleared the moment
  // urlDate changes to anything (our own navigation catching up, or
  // back/forward browser navigation) — adjusted during render rather than
  // in an effect, per React's "resetting state when a prop changes" pattern.
  const [optimisticDate, setOptimisticDate] = useState<Date | null>(null);
  const [lastUrlDate, setLastUrlDate] = useState(urlDate);
  if (urlDate !== lastUrlDate) {
    setLastUrlDate(urlDate);
    setOptimisticDate(null);
  }

  const date = optimisticDate ?? urlDate;

  const navigate = useCallback(
    (nextDate: Date, nextView: CalendarView = view) => {
      setOptimisticDate(nextDate);
      const params = new URLSearchParams(searchParams.toString());
      params.set("date", format(nextDate, DATE_FORMAT));
      params.set("view", nextView);
      startTransition(() => {
        router.push(`/calendar?${params.toString()}`, { scroll: false });
      });
    },
    [router, searchParams, view]
  );

  return { date, view, navigate, isPending };
}
