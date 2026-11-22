"use client";

import Link from "next/link";
import { Dialog } from "radix-ui";
import { useState, useSyncExternalStore } from "react";

import { buttonClassName } from "@/components/ui/button";

const SEEN_KEY = "cost-limit-seen";
const never = () => () => {};

function seen(): string {
  try {
    return sessionStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}

/** One passed limit: which service and limit, the limit and what's used, and what's paused until when (cost-rates.ts overLimitBlock). */
export type LimitBlock = { title: string; amounts: string; paused: string };

/** What the job agent got through today: postings found, scored by the AI, and set aside by your settings before scoring. */
export type TodayCounts = { found: number; scored: number; setAside: number };

const count = (value: number) => value.toLocaleString("en-US");

/** Says which cost limits have been passed, and what got done today first; shown again this session only if they change. */
export function CostLimitDialog({ limits, today = null }: { limits: LimitBlock[]; today?: TodayCounts | null }) {
  const text = limits.map((limit) => `${limit.title} ${limit.amounts}`).join(" ");
  const already = useSyncExternalStore(never, seen, () => text);
  const [closed, setClosed] = useState(false);
  const close = () => {
    try {
      sessionStorage.setItem(SEEN_KEY, text);
    } catch {
      // Without storage it simply says so again on the next page.
    }
    setClosed(true);
  };
  return (
    <Dialog.Root open={already !== text && !closed} onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-dialog border border-line-popover bg-card p-6 shadow-menu">
          <Dialog.Title className="font-serif text-[22px] leading-tight">Cost limit reached</Dialog.Title>
          <Dialog.Description asChild>
            <div className="flex flex-col gap-3 text-sm text-muted">
              {today && (
                <p className="rounded-control bg-selected px-3.5 py-2.5 text-ink">
                  <span className="font-medium">Today so far:</span> {count(today.found)} {today.found === 1 ? "job" : "jobs"} looked at · {count(today.scored)} scored ·{" "}
                  {count(today.setAside)} set aside by your settings
                </p>
              )}
              {limits.map((limit) => (
                <div key={limit.title} className="flex flex-col gap-1 rounded-control border border-line-card px-3.5 py-3">
                  <p className="font-medium text-ink">{limit.title}</p>
                  <p className="text-ink">{limit.amounts}</p>
                  <p>{limit.paused}</p>
                </div>
              ))}
              <p>Everything else keeps working. Amounts are Scout&apos;s estimates; your provider&apos;s account shows the real charges.</p>
            </div>
          </Dialog.Description>
          <div className="flex justify-end gap-2">
            <button title="Close this window" type="button" onClick={close} className={buttonClassName("secondary", "md")}>
              Close
            </button>
            <Link title="See what Scout has spent and change its limits" href="/settings?section=costs" onClick={close} className={buttonClassName("primary", "md", "hover:text-on-primary")}>
              See costs
            </Link>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
