"use client";

import { useEffect, useSyncExternalStore } from "react";

// A page can say which sidebar section it belongs to when its address alone
// doesn't: a draft you haven't applied to lives at /applications/…, yet it
// belongs to the search it came from until you apply.

let current: string | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The section (its href) the page says it's in, or null for the one its address is under. */
export function useSectionOverride(): string | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

/** Puts the page in the section at `href` while it's shown; null leaves it to the address. */
export function useBelongsTo(href: string | null): void {
  useEffect(() => {
    current = href;
    notify();
    return () => {
      current = null;
      notify();
    };
  }, [href]);
}
