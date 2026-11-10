"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { AgentCandidateView } from "@/lib/agent/view";

import { dismissAgentCandidate, restoreAgentCandidate } from "../../actions";
import { CandidateCard, OpenPosting, ScoredCard } from "../../agent-screen";

/**
 * The posting page's card: the whole posting, with Prepare draft (its draft,
 * once ready, opens in its place), Open posting and Archive; an archived one
 * has Put back instead.
 */
export function AgentPosting({ posting, archived, minScore }: { posting: AgentCandidateView; archived: boolean; minScore: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const archive = () =>
    !pending &&
    startTransition(async () => {
      const result = toastResult(await dismissAgentCandidate({ candidateId: posting.id }));
      if (!result.ok) return;
      toast(result.data.archivedApplicationId ? "Archived in your Job application log." : "Archived. Find it under Archived on Agentic job search.");
      router.push("/agent");
    });
  const putBack = () =>
    !pending &&
    startTransition(async () => {
      if (toastResult(await restoreAgentCandidate({ id: posting.id })).ok) router.refresh();
    });

  return (
    // The agent's green tint, as on Agentic job search.
    <div className="flex min-h-full flex-col bg-agent-tint">
      <div className="mx-auto flex w-full max-w-[960px] flex-col gap-4 px-10 pt-8 pb-20">
        <Link href="/agent" className="self-start text-meta text-muted underline-offset-2 hover:text-ink hover:underline">
          ← Agentic job search
        </Link>
        {archived ? (
          <CandidateCard candidate={posting} minScore={minScore} full>
            <Button size="sm" aria-disabled={pending || undefined} onClick={putBack}>
              Put back
            </Button>
            <OpenPosting url={posting.url} />
          </CandidateCard>
        ) : (
          // Prepare draft's job, once done, refreshes the page, which then opens the draft.
          <ScoredCard candidate={posting} minScore={minScore} onArchive={archive} full />
        )}
      </div>
    </div>
  );
}
