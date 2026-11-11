"use client";

import { useRewriting } from "./rewriting";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";

import { regenerateCoverLetter, setNoCoverLetter } from "./actions";

/**
 * "No cover letter" on the Cover letter tab: marks that this application goes
 * without one, so it can't be downloaded, isn't attached in Gmail and isn't
 * saved as sent (Google Drive gets the resume only). A letter already written
 * is kept as it is, so nothing is spent; "Use a cover letter after all" undoes it.
 */
export function CoverLetterChoice({ id, skipped }: { id: string; skipped: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const choose = (on: boolean) =>
    !pending &&
    startTransition(async () => {
      if (toastResult(await setNoCoverLetter({ id, on })).ok) router.refresh();
    });
  if (!skipped) {
    return (
      <Button variant="secondary" size="sm" aria-disabled={pending || undefined} onClick={() => choose(true)}>
        {pending ? "Saving…" : "I don't plan to use a cover letter"}
      </Button>
    );
  }
  return <SkippedLetter pending={pending} onUndo={() => choose(false)} />;
}

/** Regenerate cover letter, beside "I don't plan to use a cover letter": from the job's requirements and the resume as it is now. */
export function RegenerateLetter({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useRewriting(pending);
  const regenerate = () =>
    !pending &&
    startTransition(async () => {
      if (toastResult(await regenerateCoverLetter({ id })).ok) router.refresh();
    });
  return (
    <Button
      size="sm"
      aria-disabled={pending || undefined}
      onClick={regenerate}
      title="Writes the cover letter again from the job's requirements and your resume as it is now. The current one stays in History."
    >
      {pending ? "Regenerating, about half a minute…" : "Regenerate cover letter"}
    </Button>
  );
}

function SkippedLetter({ pending, onUndo }: { pending: boolean; onUndo: () => void }) {
  return (
    <div className="flex flex-1 justify-center overflow-auto bg-canvas px-10 pt-16 pb-16">
      <div role="status" className="flex h-fit max-w-[460px] flex-col items-center gap-3 rounded-card border border-line bg-card px-6 py-5 text-center">
        <p className="font-medium text-ink">No cover letter for this application</p>
        <p className="text-meta leading-[1.5] text-muted">
          Only the resume goes: the cover letter can&apos;t be downloaded, isn&apos;t attached in Gmail, and isn&apos;t saved to Google Drive. A letter already written is
          kept, in case you change your mind.
        </p>
        <Button variant="secondary" size="sm" aria-disabled={pending || undefined} onClick={onUndo}>
          {pending ? "Saving…" : "Use a cover letter after all"}
        </Button>
      </div>
    </div>
  );
}
