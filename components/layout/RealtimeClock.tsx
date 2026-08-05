"use client";

import { useEffect, useState } from "react";
import { ClockIcon } from "lucide-react";

const formatter = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export default function RealtimeClock() {
  // Lazy initializer (not an effect + setState) so the very first paint —
  // server or client — already shows a real time instead of a placeholder;
  // the 1s interval below corrects any tiny server/client skew within a
  // second, so it's never worth guarding against.
  const [time, setTime] = useState(() => formatter.format(new Date()));

  useEffect(() => {
    const id = setInterval(() => setTime(formatter.format(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="hidden flex-col items-center rounded-lg border px-3 py-1 leading-tight sm:flex"
      title="Giờ Việt Nam (GMT+7)"
    >
      <span className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
        <ClockIcon className="size-3.5 text-muted-foreground" />
        {/* The whole point of this component is to show a value that
            legitimately differs between the server's render time and the
            client's hydration time (a live clock) — suppressHydrationWarning
            is React's documented escape hatch for exactly this case, not a
            workaround for a real bug. */}
        <span suppressHydrationWarning>{time}</span>
      </span>
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        Asia/HCM · GMT+7
      </span>
    </div>
  );
}
