"use client";

import { useRewriting } from "./rewriting";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { pagesInWords } from "@/lib/settings";

import { fitResumeNow } from "./actions";

/** A draft's resume that grew past its page limit: fitted only when asked, so your edits stay yours. */
export function OverLimitNotice({ id, limit }: { id: string; limit: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useRewriting(pending);
  const fit = () =>
    !pending &&
    startTransition(async () => {
      if (toastResult(await fitResumeNow({ id })).ok) router.refresh();
    });
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-warning-line bg-warning-surface px-4 py-3 text-meta">
      <p className="text-ink">This custom tailored resume runs over {pagesInWords(limit)}.</p>
      <Button size="sm" aria-disabled={pending || undefined} onClick={fit}>
        {pending ? "Fitting…" : "Fit to limit"}
      </Button>
    </div>
  );
}
