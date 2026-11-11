"use client";

import { useRewriting } from "./rewriting";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";

import { rewriteForFullPosting } from "./actions";

/** The job description was replaced after this resume was written: rewritten only when asked, as it may have your edits. */
export function PostingChangedNotice({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useRewriting(pending);
  const rewrite = () =>
    !pending &&
    startTransition(async () => {
      if (toastResult(await rewriteForFullPosting({ id })).ok) router.refresh();
    });
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-warning-surface px-4 py-2.5 text-meta text-warning">
      <span>The job description was replaced after this resume was written.</span>
      <Button size="sm" aria-disabled={pending || undefined} onClick={rewrite}>
        {pending ? "Regenerating, about a minute…" : "Regenerate resume and cover letter for the full posting"}
      </Button>
    </div>
  );
}
