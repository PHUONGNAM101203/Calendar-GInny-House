"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { format, intervalToDuration, subHours } from "date-fns";
import { vi } from "date-fns/locale";
import { LogInIcon, LogOutIcon } from "lucide-react";
import { clockInAction, clockOutAction } from "@/actions/attendance";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Attendance, Branch, Shift } from "@/types";

type RelevantShift = Pick<Shift, "id" | "start_at" | "end_at">;

function formatDuration(from: Date, to: Date) {
  const d = intervalToDuration({ start: from, end: to });
  const h = d.hours ?? 0;
  const m = d.minutes ?? 0;
  const s = d.seconds ?? 0;
  return `${h}g ${String(m).padStart(2, "0")}p ${String(s).padStart(2, "0")}s`;
}

// Mirrors clock_in()'s own window (start_at - 1h .. end_at) exactly, so the
// button's enabled state can't disagree with what the RPC will actually
// accept — this is UX polish only, the RPC stays the authoritative reject.
type ClockInGate =
  | { state: "ready" }
  | { state: "upcoming"; opensAt: Date }
  | { state: "ended" }
  | { state: "none" };

function getClockInGate(shifts: RelevantShift[], now: Date): ClockInGate {
  const active = shifts.find((s) => now >= subHours(new Date(s.start_at), 1) && now <= new Date(s.end_at));
  if (active) return { state: "ready" };

  const upcoming = shifts.find((s) => now < subHours(new Date(s.start_at), 1));
  if (upcoming) return { state: "upcoming", opensAt: subHours(new Date(upcoming.start_at), 1) };

  const hasEnded = shifts.some((s) => new Date(s.end_at) < now);
  if (hasEnded) return { state: "ended" };

  return { state: "none" };
}

export default function ClockWidget({
  open,
  shifts,
  isTaEligible,
  branches,
}: {
  open: Attendance | null;
  shifts: RelevantShift[];
  /** Trợ giảng (primary role or kiêm nhiệm) — may clock in with no shift. */
  isTaEligible: boolean;
  /** Only populated (and only relevant) when isTaEligible. */
  branches: Pick<Branch, "id" | "name">[];
}) {
  const [isPending, startTransition] = useTransition();
  const [now, setNow] = useState(() => new Date());
  const [freeBranchId, setFreeBranchId] = useState("");

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);

  const gate = getClockInGate(shifts, now);
  // No matching shift, but this profile is trợ giảng-eligible — they can
  // still clock in (see clock_in(), 0056), just untied to any shift, once
  // they pick which cơ sở they're at.
  const isFreeClockIn = gate.state === "none" && isTaEligible;
  const canClockIn = gate.state === "ready" || (isFreeClockIn && Boolean(freeBranchId));

  function handleClockIn() {
    startTransition(async () => {
      const result = await clockInAction(isFreeClockIn ? freeBranchId : undefined);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Đã chấm công vào");
    });
  }

  function handleClockOut() {
    startTransition(async () => {
      const result = await clockOutAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Đã chấm công ra");
    });
  }

  const gateMessage =
    gate.state === "upcoming"
      ? `Có thể chấm công vào lúc ${format(gate.opensAt, "HH:mm", { locale: vi })}`
      : gate.state === "ended"
        ? "Ca đã kết thúc, không thể chấm công"
        : gate.state === "none"
          ? isFreeClockIn
            ? "Không có ca — chấm công với vai trò Trợ giảng, chọn cơ sở bên dưới"
            : "Bạn không có ca làm việc hôm nay"
          : "Tới cơ sở rồi thì bấm một nút là vào ca.";

  return (
    // shrink-0 is load-bearing, not tidying: Card (components/ui/card.tsx)
    // ships its own overflow-hidden for image-corner clipping, and per the
    // flexbox spec, a flex item's automatic minimum size resolves to 0 (not
    // its content size) whenever its own overflow isn't "visible". As a flex
    // item of the attendance page's flex-col wrapper, that let this Card
    // silently shrink and clip its own CardContent — including the
    // "Chấm công vào/ra" button — on short viewports, instead of the
    // wrapper's overflow-y-auto engaging and letting the page scroll.
    // shrink-0 pins the Card to its content height so the page scrolls
    // instead of the button disappearing.
    <Card className="relative shrink-0 overflow-hidden">
      {/* viền trên đổi màu theo trạng thái — cùng quy ước "màu = trạng thái"
          với badge và băng điều hành */}
      <span className={`absolute inset-x-0 top-0 h-1 ${open ? "bg-success" : "bg-border"}`} />
      <CardContent className="flex flex-col items-center gap-4 py-6 text-center sm:gap-5 sm:py-8">
        <p className="flex items-center gap-2 text-[11px] font-extrabold tracking-[0.16em] text-muted-foreground uppercase">
          {open && (
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
          )}
          {open ? "Đang trong ca" : "Chưa chấm công"}
        </p>

        {open ? (
          <div>
            <p className="font-heading text-5xl leading-none font-semibold tracking-tight tabular-nums sm:text-6xl">
              {formatDuration(new Date(open.check_in_at), now)}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Vào ca lúc{" "}
              <span className="font-medium text-foreground">
                {format(new Date(open.check_in_at), "HH:mm", { locale: vi })}
              </span>
            </p>
          </div>
        ) : (
          <div>
            <p
              className="font-heading text-4xl leading-none font-semibold tracking-tight tabular-nums sm:text-5xl md:text-6xl"
              suppressHydrationWarning
            >
              {format(now, "HH:mm:ss", { locale: vi })}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{gateMessage}</p>
          </div>
        )}

        {isFreeClockIn && (
          <Select value={freeBranchId} onValueChange={setFreeBranchId}>
            <SelectTrigger className="w-full max-w-56">
              <SelectValue placeholder="Chọn cơ sở" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {open ? (
          <Button
            size="lg"
            variant="outline"
            onClick={handleClockOut}
            disabled={isPending}
            className="h-12 gap-2 rounded-full px-8"
          >
            <LogOutIcon className="size-4" />
            Chấm công ra
          </Button>
        ) : (
          <Button
            size="lg"
            onClick={handleClockIn}
            disabled={isPending || !canClockIn}
            className="h-12 gap-2 rounded-full px-8"
          >
            <LogInIcon className="size-4" />
            Chấm công vào
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
