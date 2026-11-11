"use client";

import { useRewriting } from "./rewriting";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";

import { fitLetterNow } from "./actions";

/** A cover letter is one page: shown when it's grown past that, with a way to write it shorter. */
export function LetterOverNotice({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useRewriting(pending);
  const fit = () =>
    !pending &&
    startTransition(async () => {
      if (toastResult(await fitLetterNow({ id })).ok) router.refresh();
    });
  return (
    <div role="note" className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-warning-surface px-4 py-2.5 text-meta text-warning">
      <span>This custom tailored cover letter runs past one page.</span>
      <Button size="sm" variant="secondary" aria-disabled={pending || undefined} onClick={fit}>
        {pending ? "Shortening…" : "Fit to one page"}
      </Button>
    </div>
  );
}
