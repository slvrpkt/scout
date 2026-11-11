"use client";

import { useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";

import { scoreWaitingNow } from "./actions";

/**
 * When jobs are still waiting for their scores: a way not to wait. While
 * they're being scored (a run, Score now or a batch), there's nothing to start.
 */
export function ScoreNow({ waiting, scoring, onStarted }: { waiting: number; scoring: boolean; onStarted: (jobId: string) => void }) {
  const [pending, startTransition] = useTransition();
  const busy = pending || scoring;
  const score = () =>
    !busy &&
    startTransition(async () => {
      const result = toastResult(await scoreWaitingNow({}));
      if (result.ok) onStarted(result.data.jobId);
    });
  const jobs = waiting === 1 ? "1 job is" : `${waiting} jobs are`;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-card px-5 py-3 text-sm">
      <span>
        {scoring
          ? `${jobs} being scored now. The counts here update as the scores come in.`
          : `${jobs} waiting for a score. Scoring starts about 5 minutes after the search, and you don't have to wait for it.`}
      </span>
      <Button size="sm" variant="secondary" disabled={busy} onClick={score}>
        {busy ? "Scoring…" : "Score now"}
      </Button>
    </div>
  );
}
