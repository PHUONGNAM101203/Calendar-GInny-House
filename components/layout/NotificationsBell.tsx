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

const LAST_SEEN_KEY = "ginny:notifications:lastSeenAt";

function readLastSeen(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(LAST_SEEN_KEY) ?? "";
}

export default function NotificationsBell({
  notifications,
}: {
  notifications: AppNotification[];
}) {
  // The badge counts what's *new since you last opened the bell*, not
  // "still needs action" — a pending item you've already seen shouldn't
  // keep nagging the badge every time you glance at the header, but it
  // still shows its gold dot inside the list until it's resolved.
  const [lastSeenAt, setLastSeenAt] = useState(readLastSeen);
  const lastSeenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;
  const unseenCount = notifications.filter((n) => new Date(n.at).getTime() > lastSeenMs).length;

  function handleOpenChange(open: boolean) {
    if (!open) return;
    const now = new Date().toISOString();
    localStorage.setItem(LAST_SEEN_KEY, now);
    setLastSeenAt(now);
  }

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative rounded-full" aria-label="Thông báo">
          <BellIcon className="size-5" />
          {unseenCount > 0 && (
            <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-gold text-[10px] font-semibold text-gold-foreground">
              {unseenCount > 9 ? "9+" : unseenCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
