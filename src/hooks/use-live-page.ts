"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

/** How often an open page looks for changes made elsewhere. */
export const LIVE_CHECK_MS = 15_000;
/** Changes this soon after you clicked or typed are taken as your own: the page redraws for them anyway. */
const YOURS_MS = 4_000;

/**
 * Keeps a page in step with changes made elsewhere: the job agent, a
 * background job, another tab, a fix in the database. Every LIVE_CHECK_MS
 * while the tab is visible, and when you come back to it, `check()` gives the
 * page's fingerprint; when it differs from `stamp` (the one the page was drawn
 * with) the page redraws itself, or, while `busy` (say, mid-edit), says so
 * and waits for Refresh. `changed` is true while that's waiting; `updated`
 * flashes true after a redraw for a change that wasn't yours.
 */
export function useLivePage(stamp: string | null, check: () => Promise<string | null>, busy: boolean) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // The drawing a change elsewhere was found against: it's waiting while that's still the one shown.
  const [changedOn, setChangedOn] = useState<string | null>(null);
  const changed = changedOn !== null && changedOn === stamp;
  const [updated, setUpdated] = useState(false);
  const latest = useRef({ stamp, check, busy });
  const lastInput = useRef(0);
  useEffect(() => {
    latest.current = { stamp, check, busy };
  });
  const refresh = () => startTransition(() => router.refresh());

  useEffect(() => {
    let checking = false;
    const look = async () => {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const now = await latest.current.check();
        if (!now || now === latest.current.stamp) return;
        if (latest.current.busy) {
          setChangedOn(latest.current.stamp);
          return;
        }
        const yours = Date.now() - lastInput.current < YOURS_MS;
        startTransition(() => router.refresh());
        if (!yours) {
          setUpdated(true);
          window.setTimeout(() => setUpdated(false), 4000);
        }
      } catch {
        // Offline or the server restarting: the next look tries again.
      } finally {
        checking = false;
      }
    };
    const timer = window.setInterval(() => void look(), LIVE_CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void look();
    };
    const onInput = () => {
      lastInput.current = Date.now();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pointerdown", onInput, true);
    window.addEventListener("keydown", onInput, true);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pointerdown", onInput, true);
      window.removeEventListener("keydown", onInput, true);
    };
  }, [router]);

  // Done editing with a change waiting: show it now.
  useEffect(() => {
    if (!busy && changed) startTransition(() => router.refresh());
  }, [busy, changed, router]);

  return { changed, updated, refresh };
}
