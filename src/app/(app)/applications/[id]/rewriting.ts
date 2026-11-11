"use client";

import { useEffect, useSyncExternalStore } from "react";

// While a whole document is being written again (Regenerate cover letter, a
// rewrite for the full posting or the latest profile, a third page), its
// parts' Edit, Regenerate, Ask AI and Leave out wait: a change made now
// would be lost to the rewrite. The buttons that start one say so here.

let running = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Marks a rewrite as under way while `active`. */
export function useRewriting(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    running += 1;
    emit();
    return () => {
      running -= 1;
      emit();
    };
  }, [active]);
}

/** Whether any rewrite is under way. */
export function useAnyRewriting(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => running > 0,
    () => false,
  );
}
