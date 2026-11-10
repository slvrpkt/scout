"use client";

import { CircleCheck, CircleAlert } from "lucide-react";
import { Dialog } from "radix-ui";

import { RubricBreakdown } from "@/components/rubric-breakdown";
import { ScoreBadge } from "@/components/score-badge";
import { Button } from "@/components/ui/button";
import { fitBand } from "@/lib/fit";
import type { RubricLine } from "@/lib/scoring/rubric";

/** At most this many points in the explanation, so it stays to one screen. */
const MAX_POINTS = 20;

/**
 * A fit score you can click for how it was worked out: the AI read the
 * posting against your profile and gave the score with its reasons for and
 * against, listed here (up to 20), with what the score bands mean. Nothing
 * new is asked of the AI.
 */
export function ScoreExplainer({
  score,
  title,
  reasons,
  redFlags,
  minScore,
  breakdown,
  onRescore,
}: {
  score: number;
  /** What was scored, e.g. "Senior Product Designer at Ledgerly". */
  title: string;
  reasons: string[];
  redFlags: string[];
  /** The job agent's minimum, when it applies. */
  minScore?: number;
  /** How your own scoring rubric made the score (#42), when Settings → Scoring has one. */
  breakdown?: readonly RubricLine[];
  /** Score again, where a posting is scored on request (Manual job search), e.g. after changing your rubric. */
  onRescore?: () => void;
}) {
  const against = redFlags.slice(0, MAX_POINTS);
  const pro = reasons.slice(0, Math.max(0, MAX_POINTS - against.length));
  return (
    <Dialog.Root>
      <Dialog.Trigger className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" title="How this score was worked out">
        <ScoreBadge score={score} />
        <span className="sr-only">: how it was worked out</span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[min(600px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-dialog border border-line-popover bg-card p-6 shadow-menu">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <ScoreBadge score={score} />
              <div className="flex flex-col gap-0.5">
                <Dialog.Title className="font-serif text-[22px] leading-tight">How this score was worked out</Dialog.Title>
                <Dialog.Description className="text-sm text-muted">
                  {fitBand(score)} · {score} of 100 · {title}
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close aria-label="Close" className="grid size-8 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink">
              <span aria-hidden="true" className="text-lg leading-none">
                ×
              </span>
            </Dialog.Close>
          </div>
          {breakdown ? (
            <section aria-label="Your scoring rubric" className="flex flex-col gap-1.5">
              <h3 className="text-[15px] font-medium">Your scoring rubric</h3>
              <p className="text-sm text-muted">
                Each of your criteria was judged against the posting: all its points when met, half when partly met, none otherwise. The points
                add up to the score out of 100 (Settings → Scoring).
              </p>
              <RubricBreakdown breakdown={breakdown} score={score} />
            </section>
          ) : (
            <p className="text-sm text-muted">
              The AI read the posting against your profile: your experience, skills, education and where you want to work. It weighed what
              matches and what doesn&apos;t, and gave one score out of 100.
            </p>
          )}
          {pro.length > 0 && (
            <section aria-label="Counts for it" className="flex flex-col gap-1.5">
              <h3 className="text-[15px] font-medium">Counts for it</h3>
              <ul className="flex flex-col gap-1.5">
                {pro.map((reason, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm">
                    <CircleCheck size={15} aria-hidden="true" className="mt-0.5 flex-none text-success" />
                    {reason}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {against.length > 0 && (
            <section aria-label="Counts against it" className="flex flex-col gap-1.5">
              <h3 className="text-[15px] font-medium">Counts against it</h3>
              <ul className="flex flex-col gap-1.5">
                {against.map((flag, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm">
                    <CircleAlert size={15} aria-hidden="true" className="mt-0.5 flex-none text-warning" />
                    {flag}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {pro.length === 0 && against.length === 0 && <p className="text-sm text-muted">The AI didn&apos;t give its reasons for this one.</p>}
          <div className="rounded-card bg-surface px-4 py-3 text-meta text-muted">
            <p className="font-medium text-ink">What the score means</p>
            <ul className="mt-1 flex flex-col gap-0.5">
              <li>85–100: excellent fit</li>
              <li>70–84: good fit</li>
              <li>50–69: possible fit, worth a closer look</li>
              <li>Below 50: poor fit</li>
              {minScore !== undefined && <li>The job agent keeps postings from {minScore} up (Settings → Job agent).</li>}
            </ul>
          </div>
          {onRescore && (
            <div className="flex justify-end">
              <Dialog.Close asChild>
                <Button variant="secondary" size="sm" onClick={onRescore}>
                  Score again
                </Button>
              </Dialog.Close>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
