"use client";

import { useSyncExternalStore } from "react";

// Matches Tailwind's `md` breakpoint — phone-width viewports only, not
// tablets. `undefined` on the server/first paint so callers can tell "not
// yet known" apart from "known false" — useSyncExternalStore (not a
// setState-in-effect) is the React-recommended way to subscribe to an
// external browser API like matchMedia.
const MOBILE_MAX_WIDTH = 767;
const QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot() {
  return undefined;
}

export function useIsMobile(): boolean | undefined {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
