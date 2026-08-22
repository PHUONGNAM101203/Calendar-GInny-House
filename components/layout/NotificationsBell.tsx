"use client";

import { useState } from "react";
import Link from "next/link";
import { BellIcon, CircleDotIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
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
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
  markNotificationsSeenAction,
} from "@/actions/notifications";
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

  // Stored ids the user has just dismissed, hidden optimistically. The server
  // write sets `notifications.read_at`, and the layout's query filters read
  // rows out — but that only lands after the revalidate, so without this the
  // item would sit there until the page refetched. Reverted on failure.
  const [dismissedIds, setDismissedIds] = useState<readonly string[]>([]);

  const visible = notifications.filter((n) => !n.storedId || !dismissedIds.includes(n.storedId));
  // Only the stored half can be dismissed; derived items have no row.
  const dismissableCount = visible.filter((n) => n.storedId).length;

  const effectiveSeenAt = seenOverride ?? lastSeenAt;
  const lastSeenMs = effectiveSeenAt ? new Date(effectiveSeenAt).getTime() : 0;
  // Counted off `visible`, not `notifications`, so the badge and the list can
  // never disagree: dismissing the last unseen stored item clears the badge in
  // the same render that removes the row. Derived items are unaffected — they
  // are still judged purely against notifications_seen_at, as before.
  const unseenCount = visible.filter((n) => new Date(n.at).getTime() > lastSeenMs).length;

  async function handleDismiss(storedId: string) {
    setDismissedIds((prev) => [...prev, storedId]);
    const result = await markNotificationReadAction({ id: storedId });
    if (!result.ok) {
      setDismissedIds((prev) => prev.filter((id) => id !== storedId));
      toast.error(result.error);
    }
  }

  async function handleDismissAll() {
    const storedIds = visible.flatMap((n) => (n.storedId ? [n.storedId] : []));
    setDismissedIds((prev) => [...prev, ...storedIds]);
    const result = await markAllNotificationsReadAction();
    if (!result.ok) {
      setDismissedIds((prev) => prev.filter((id) => !storedIds.includes(id)));
      toast.error(result.error);
    }
  }

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
        <div className="flex items-center justify-between gap-2">
          <DropdownMenuLabel>Thông báo</DropdownMenuLabel>
          {dismissableCount > 0 && (
            /* A DropdownMenuItem rather than a bare <button> so it keeps its
               place in Radix's arrow-key roving focus, with onSelect
               prevented so the panel stays open — dismissing is not a
               navigation. */
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                void handleDismissAll();
              }}
              className="w-auto shrink-0 px-2 py-1 text-xs text-muted-foreground"
            >
              Đánh dấu tất cả đã đọc
            </DropdownMenuItem>
          )}
        </div>
        <DropdownMenuSeparator />
        {visible.length === 0 ? (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">
            Chưa có thông báo nào.
          </p>
        ) : (
          visible.map((n) => {
            // Pulled into a local const so its narrowing survives into the
            // onSelect closure below, which property narrowing would not.
            const storedId = n.storedId;
            return (
              <div key={n.id} className="flex items-start gap-0.5">
                <DropdownMenuItem asChild className="min-w-0 flex-1 items-start gap-2 py-2.5">
                  <Link href={n.href}>
                    <CircleDotIcon
                      className={cn(
                        "mt-0.5 size-3 shrink-0",
                        n.needsAction ? "text-gold" : "text-muted-foreground"
                      )}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm leading-snug whitespace-normal">{n.text}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatNotificationTime(n.at)}
                      </span>
                    </span>
                  </Link>
                </DropdownMenuItem>
                {/* Stored rows only. A derived notification has no row to stamp
                    a read_at on, so offering an X that could not persist would
                    be a lie — those still retire on their own when the request
                    resolves or its three-day window passes. Kept outside the
                    Link above rather than nested in it: a <button> inside an
                    <a> is invalid, and the two would fight for the click. */}
                {storedId && (
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      void handleDismiss(storedId);
                    }}
                    aria-label="Đánh dấu đã đọc"
                    title="Đánh dấu đã đọc"
                    className="mt-1.5 shrink-0 p-1.5 text-muted-foreground"
                  >
                    <XIcon className="size-3.5" />
                  </DropdownMenuItem>
                )}
              </div>
            );
          })
        )}
        <PushNotificationToggle />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
