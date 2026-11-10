"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";

import { scoreWaitingNow } from "./actions";

/** When jobs are still waiting for their scores: a way not to wait for the batch. */
export function ScoreNow({ waiting }: { waiting: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const score = () =>
    !pending &&
    startTransition(async () => {
      if (toastResult(await scoreWaitingNow({})).ok) router.refresh();
    });
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-card px-5 py-3 text-sm">
      <span>
        {waiting === 1 ? "1 job is" : `${waiting} jobs are`} waiting for a score. Scoring starts about half an hour after the search, and you don&apos;t have to wait for it.
      </span>
      <Button size="sm" variant="secondary" aria-disabled={pending || undefined} onClick={score}>
        {pending ? "Scoring…" : "Score now"}
      </Button>
    </div>
  );
}
