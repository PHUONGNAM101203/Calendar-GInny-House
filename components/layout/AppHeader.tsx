"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDaysIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import BrandMark from "@/components/brand/BrandMark";
import AppLauncher from "@/components/layout/AppLauncher";
import RealtimeClock from "@/components/layout/RealtimeClock";
import UserMenu from "@/components/layout/UserMenu";
import NotificationsBell from "@/components/layout/NotificationsBell";
import ThemeToggle from "@/components/layout/ThemeToggle";
import { cn } from "@/lib/utils";
import type { AppNotification } from "@/lib/notifications";
import type { Role } from "@/types";

export default function AppHeader({
  fullName,
  role,
  notifications,
  notificationsSeenAt,
}: {
  fullName: string;
  role: Role;
  notifications: AppNotification[];
  notificationsSeenAt: string | null;
}) {
  const pathname = usePathname();
  const onCalendar = pathname === "/calendar";

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between border-b bg-card/85 px-4 py-3 backdrop-blur-md supports-backdrop-filter:bg-card/70 sm:px-6">
      <Link href="/calendar" className="flex items-center gap-2 text-primary">
        <BrandMark className="size-6 shrink-0" priority />
        <span className="font-heading text-lg leading-none font-semibold tracking-tight">
          Ginny House
        </span>
      </Link>

      <div className="flex items-center gap-3">
        <RealtimeClock className="hidden sm:flex" />

        <div className="flex items-center gap-0.5 rounded-full border p-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Lịch"
            aria-current={onCalendar ? "page" : undefined}
            className={cn("rounded-full", onCalendar && "bg-accent text-foreground")}
            asChild
          >
            <Link href="/calendar">
              <CalendarDaysIcon className="size-5" />
            </Link>
          </Button>
          <AppLauncher />
        </div>

        <ThemeToggle />
        <NotificationsBell notifications={notifications} lastSeenAt={notificationsSeenAt} />

        <UserMenu fullName={fullName} role={role} />
      </div>
    </header>
  );
}
