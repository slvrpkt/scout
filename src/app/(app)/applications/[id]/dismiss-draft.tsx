"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";

import { dismissAgentCandidate } from "../../agent/actions";

/**
 * Archive on a job agent draft's page: you won't apply for now. Nothing is
 * deleted: the draft stays here, archived in the Job application log, and
 * the posting won't come back on Agentic job search. Delete is in the menu.
 */
export function DismissDraft({ candidateId }: { candidateId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="danger-outline"
      aria-disabled={pending || undefined}
      onClick={() =>
        !pending &&
        startTransition(async () => {
          if (!toastResult(await dismissAgentCandidate({ candidateId })).ok) return;
          toast("Archived. Find it in the Archive.");
          router.refresh();
        })
      }
    >
      Archive
    </Button>
  );
}
