"use client";

import { useState } from "react";

const STORAGE_PREFIX = "ginny:sidebar:collapsed:";

// Safe under next/dynamic(ssr:false) — CalendarSidebar's whole subtree only
// ever renders client-side, so reading localStorage in the useState
// initializer can't cause a hydration mismatch here.
function readInitial(key: string, defaultValue: boolean): boolean {
  if (typeof window === "undefined") return defaultValue;
  const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
  if (raw === null) return defaultValue;
  return raw === "1";
}

// One collapsed/expanded bool per sidebar section, persisted across reloads
// so a user's "thu gọn" choice sticks instead of resetting every page load.
export function usePersistentCollapse(key: string, defaultValue = false): [boolean, (next: boolean) => void] {
  const [collapsed, setCollapsedState] = useState(() => readInitial(key, defaultValue));

  function setCollapsed(next: boolean) {
    setCollapsedState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_PREFIX + key, next ? "1" : "0");
    }
  }

  return [collapsed, setCollapsed];
}
