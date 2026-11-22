"use client";

import { Tooltip } from "radix-ui";

import type { ScreeningTrap } from "@/lib/screening-traps";

/** What a resume screening trap is, for the ⓘ beside the warning. */
export const TRAP_EXPLAINED =
  "Recruiters have been reported planting a made-up requirement in job postings, e.g. “Python, Java and Cribbage programming languages”, where Cribbage is a card game, not a language. Tools that write resumes with AI tend to copy every keyword from the posting, so the employer's hiring system rejects any resume that mentions the made-up one. Scout checks each posting for such words, warns you here, and keeps them out of your resume and cover letter.";

/** The posting seems to plant words as a resume screening trap: says which, and that they were kept out. */
export function TrapWarning({ traps }: { traps: readonly ScreeningTrap[] }) {
  return (
    <div role="alert" className="flex flex-col gap-1 rounded-card bg-warning-surface px-4 py-2.5 text-meta text-warning">
      <p className="flex items-center gap-1.5 font-medium">
        ⚠️ Possible resume screening trap
        <Tooltip.Provider delayDuration={100}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button type="button" aria-label="What's a resume screening trap?" className="cursor-help rounded-full px-1 text-warning hover:text-ink">
                ⓘ
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content side="bottom" align="start" sideOffset={6} className="z-50 max-w-[340px] rounded-control border border-line-popover bg-card px-3 py-2.5 text-meta font-normal text-ink shadow-menu">
                {TRAP_EXPLAINED}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      </p>
      {traps.map((trap) => (
        <p key={trap.term}>
          Lists “{trap.term}”: {trap.why || "not a known technology."} Scout kept it out of your resume and cover letter.
        </p>
      ))}
    </div>
  );
}
