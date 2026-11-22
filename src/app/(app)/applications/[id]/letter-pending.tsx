"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { useJob } from "@/hooks/use-job";

import { writeLetterNow } from "./actions";

/**
 * A draft's cover letter, being written. The page shows the letter once it's
 * done (and when you come back to it later); if writing fails, it says so and
 * offers to try again.
 */
export function LetterPending({
  jobId,
  onRetry,
}: {
  jobId: string;
  onRetry?: () => void;
}) {
  const router = useRouter();
  const job = useJob(jobId, 0, (next) => {
    if (next.status === "DONE" || next.status === "FAILED") router.refresh();
  });
  const failed = job?.status === "FAILED";
  return (
    <div
      role="status"
      className="m-6 flex max-w-[560px] flex-col gap-2 rounded-card border border-line-card bg-card px-6 py-5"
    >
      <h2 className="font-serif text-section">
        {failed
          ? "The cover letter couldn't be written"
          : "Hang tight: your cover letter is being written"}
      </h2>
      <p className="text-sm text-muted">
        {failed
          ? `${job?.error ?? "Something went wrong."} Try again, or apply with the resume alone.`
          : "It'll be ready in 1 to 2 minutes. You can leave this page and keep working; it'll be here when you come back, ready to review."}
      </p>
      {failed && onRetry && (
        <Button title="Try again" size="sm" className="self-start" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * A draft without its cover letter yet, with automatic letters off in
 * Settings → Documents (to save AI costs): Write cover letter writes it now.
 */
export function LetterUnwritten({ id }: { id: string }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const write = () =>
    !pending &&
    startTransition(async () => {
      const result = await writeLetterNow({ id });
      if (result.ok) setJobId(result.data);
      else toast(result.error);
    });
  if (jobId)
    return (
      <LetterPending
        jobId={jobId}
        onRetry={() => {
          setJobId(null);
          write();
        }}
      />
    );
  return (
    <div className="m-6 flex max-w-[560px] flex-col gap-3 rounded-card border border-line-card bg-card px-6 py-5">
      <h2 className="font-serif text-section">No cover letter written yet</h2>
      <p className="text-sm text-muted">
        To save AI costs, cover letters are written only when you ask. Want one
        for this job? It takes 1 to 2 minutes. You can turn automatic letters on
        in Settings → Documents.
      </p>
      <Button title="Write a cover letter for this job (1 to 2 minutes)"
        className="self-start"
        aria-disabled={pending || undefined}
        onClick={write}
      >
        {pending ? "Starting…" : "Write cover letter"}
      </Button>
    </div>
  );
}
