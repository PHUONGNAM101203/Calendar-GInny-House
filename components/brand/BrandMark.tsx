"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import Image from "next/image";
import { cn } from "@/lib/utils";

const noopSubscribe = () => () => {};

// SSR-safe "are we on the client yet" check (see ThemeToggle for the same
// pattern) — needed so "auto" doesn't flash the wrong logo before
// hydration knows the visitor's stored theme.
function useMounted() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}

/**
 * Official Ginny House icon (house outline + crossed ribbon), traced from
 * public/LOGO-01.png — see DESIGN.md "Logo". `variant="navy"` for light
 * surfaces, `variant="white"` for use on the brand-navy background — both
 * force that exact asset regardless of theme. `variant="auto"` (default)
 * follows dark mode: navy ink logo reads as a near-invisible dark shape on
 * a dark header, so it swaps to the white cutout automatically.
 */
export default function BrandMark({
  className,
  variant = "auto",
  priority = false,
}: {
  className?: string;
  variant?: "navy" | "white" | "auto";
  /** Only the one instance that's actually above-the-fold LCP-critical should set this. */
  priority?: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();

  const resolvedVariant =
    variant === "auto" ? (mounted && resolvedTheme === "dark" ? "white" : "navy") : variant;

  return (
    <span className={cn("relative inline-block", className)}>
      <Image
        src={resolvedVariant === "white" ? "/brand/icon-white.png" : "/brand/icon-navy.png"}
        alt=""
        fill
        sizes="128px"
        className="object-contain"
        priority={priority}
      />
    </span>
  );
}
