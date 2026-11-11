"use client";

import { Bookmark } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * Save for later, at the top right of a job's card. Off, it's grey and
 * pressed in; on, it lights up amber. Saving never takes the job out of the
 * list it's in: it only shows on Saved for later as well.
 */
export function SaveForLaterButton({ saved, busy = false, onToggle }: { saved: boolean; busy?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-disabled={busy || undefined}
      onClick={busy ? undefined : onToggle}
      title={saved ? "On Saved for later. Click to take it off." : "Keep it on Saved for later, so it's easy to find again"}
      className={cn(
        "inline-flex h-8 flex-none items-center gap-1.5 rounded-control border px-3 text-xs font-medium whitespace-nowrap motion-safe:transition-colors aria-disabled:cursor-default",
        saved
          ? "border-saved-line bg-saved text-on-saved shadow-[inset_0_1px_2px_rgb(0_0_0/0.15)] hover:bg-saved-hover"
          : "border-line bg-track text-muted shadow-[inset_0_1px_3px_rgb(0_0_0/0.12)] hover:text-ink",
      )}
    >
      <Bookmark size={14} aria-hidden="true" className={cn("shrink-0", saved && "fill-current")} />
      {saved ? "Saved" : "Save for later"}
    </button>
  );
}
