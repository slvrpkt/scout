"use client";

import { useRewriting } from "./rewriting";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";

import { answerResumePages } from "./actions";

/**
 * Whether this one resume may use a third page, with Settings at two: asked
 * before its two-page fit shortens the 3 most recent jobs (it stays as
 * written until then), or when the AI thinks this job is worth a third
 * (`reason`; the two-page version is ready meanwhile). Yes rewrites it.
 */
export function PagesQuestion({ id, reason = null }: { id: string; reason?: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useRewriting(pending);
  const answer = (allow: boolean) =>
    !pending &&
    startTransition(async () => {
      if (toastResult(await answerResumePages({ id, allow })).ok) router.refresh();
    });
  return (
    <div role="alert" className="flex flex-col gap-2.5 rounded-card border border-warning-line bg-warning-surface px-4 py-3 text-meta">
      <p className="text-ink">
        {reason ? (
          <>
            <strong className="font-semibold">This job may be worth a third page.</strong> {reason} Rewrite this custom tailored resume for up to three pages? Your
            two-page setting stays as it is.
          </>
        ) : (
          <>
            <strong className="font-semibold">This custom tailored resume needs a third page to keep its quality.</strong> Older jobs are already as short as they go;
            fitting two pages would mean shortening your 3 most recent jobs. Rewrite this custom tailored resume for up to three pages? Your two-page setting stays as it is.
          </>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" aria-disabled={pending || undefined} onClick={() => answer(true)}>
          {pending ? "Working…" : "Yes, up to three pages"}
        </Button>
        <Button variant="secondary" size="sm" aria-disabled={pending || undefined} onClick={() => answer(false)}>
          Keep it to two pages
        </Button>
        <span className="text-muted">Either way, what&apos;s shortened is rewritten in fewer words, keeping the facts.</span>
      </div>
    </div>
  );
}
