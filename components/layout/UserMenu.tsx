"use client";

import Link from "next/link";
import {
  ChevronDownIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  UserIcon,
  UserPenIcon,
} from "lucide-react";
import { signOutAction } from "@/actions/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS, isManagerRole } from "@/lib/roles";
import type { Role } from "@/types";

export default function UserMenu({ fullName, role }: { fullName: string; role: Role }) {
  const isManager = isManagerRole(role);
  const trimmed = fullName.trim();
  const initial = trimmed.charAt(0).toUpperCase() || "?";
  // Vietnamese names are addressed by the given name, which is the last
  // word — showing the full name in the header trigger would make it too
  // wide most of the time.
  const displayName = trimmed.split(/\s+/).pop() || trimmed;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-full py-1 pr-2.5 pl-1 outline-none transition-colors hover:bg-accent">
        <Avatar size="sm">
          <AvatarFallback>{initial}</AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium">{displayName}</span>
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 font-medium">
            <UserIcon className="size-3.5 shrink-0" />
            <span className="truncate">{fullName}</span>
          </span>
          <Badge variant={isManager ? "gold" : "secondary"} className="shrink-0">
            {ROLE_LABELS[role]}
          </Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account">
            <UserPenIcon />
            Cập nhật thông tin
          </Link>
        </DropdownMenuItem>
        {isManager && (
          <DropdownMenuItem asChild>
            <Link href="/manager">
              <LayoutDashboardIcon />
              Dashboard
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => signOutAction()}
        >
          <LogOutIcon />
          Đăng xuất
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
