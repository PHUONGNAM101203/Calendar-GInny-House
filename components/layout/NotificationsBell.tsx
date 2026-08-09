"use client";

import { useState } from "react";
import Link from "next/link";
import { BellIcon, CircleDotIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatNotificationTime, type AppNotification } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { markNotificationsSeenAction } from "@/actions/notifications";
import PushNotificationToggle from "@/components/layout/PushNotificationToggle";

export default function NotificationsBell({
  notifications,
  lastSeenAt,
}: {
  notifications: AppNotification[];
  /**
   * Server-provided `profiles.notifications_seen_at`. This used to live in
   * localStorage, which meant reading the bell on a laptop left the phone
   * still badged — it now follows the person across devices.
   */
  lastSeenAt: string | null;
}) {
  // The badge counts what's *new since you last opened the bell*, not
  // "still needs action" — a pending item you've already seen shouldn't
  // keep nagging the badge every time you glance at the header, but it
  // still shows its gold dot inside the list until it's resolved.
  //
  // Local override so the badge clears the instant the bell opens; the
  // server write happens in the background and the prop catches up on the
  // next load. Seeded from the prop rather than copied into state, so a
  // newer server value is never shadowed by a stale local one.
  const [seenOverride, setSeenOverride] = useState<string | null>(null);
  const effectiveSeenAt = seenOverride ?? lastSeenAt;
  const lastSeenMs = effectiveSeenAt ? new Date(effectiveSeenAt).getTime() : 0;
  const unseenCount = notifications.filter((n) => new Date(n.at).getTime() > lastSeenMs).length;

  function handleOpenChange(open: boolean) {
    if (!open) return;
    // Nothing new to acknowledge — skip the write entirely rather than
    // touching the row on every idle glance at the bell.
    if (unseenCount === 0) return;
    setSeenOverride(new Date().toISOString());
    void markNotificationsSeenAction();
  }

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative rounded-full" aria-label="Thông báo">
          <BellIcon className="size-5" />
          {unseenCount > 0 && (
            <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-gold text-[10px] font-semibold text-gold-foreground">
              {unseenCount > 9 ? "9+" : unseenCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      {/* A fixed 320px width forced Radix's collision detection to shift
          the panel left on narrow phones to stay on-screen, which read as
          "opening sideways" instead of dropping straight down under the
          bell. Clamping the width to the viewport removes the need for
          that shift. */}
      <DropdownMenuContent align="end" className="w-[calc(100vw-2rem)] max-w-80">
        <DropdownMenuLabel>Thông báo</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">
            Chưa có thông báo nào.
          </p>
        ) : (
          notifications.map((n) => (
            <DropdownMenuItem key={n.id} asChild className="items-start gap-2 py-2.5">
              <Link href={n.href}>
                <CircleDotIcon
                  className={cn(
                    "mt-0.5 size-3 shrink-0",
                    n.needsAction ? "text-gold" : "text-muted-foreground"
                  )}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm leading-snug whitespace-normal">{n.text}</span>
                  <span className="text-xs text-muted-foreground">{formatNotificationTime(n.at)}</span>
                </span>
              </Link>
            </DropdownMenuItem>
          ))
        )}
        <PushNotificationToggle />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
