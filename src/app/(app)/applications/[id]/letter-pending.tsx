"use client";

import { useRouter } from "next/navigation";

import { useJob } from "@/hooks/use-job";

/**
 * A job agent draft's cover letter, being drafted now that the draft is
 * open. The page shows the letter once it's done; if drafting fails, it
 * says so and tries again the next time the draft is opened.
 */
export function LetterPending({ jobId }: { jobId: string }) {
  const router = useRouter();
  const job = useJob(jobId, 0, (next) => {
    if (next.status === "DONE" || next.status === "FAILED") router.refresh();
  });
  const failed = job?.status === "FAILED";
  return (
    <div role="status" className="m-6 flex max-w-[560px] flex-col gap-2 rounded-card border border-line-card bg-card px-6 py-5">
      <h2 className="font-serif text-section">{failed ? "The cover letter couldn't be drafted" : "Your cover letter is being drafted…"}</h2>
      <p className="text-sm text-muted">
        {failed
          ? `${job?.error ?? "Something went wrong."} It will be tried again the next time you open this draft.`
          : "To keep costs down, the job agent writes a cover letter only once you open a draft. It reads the whole posting, so this takes about a minute; it appears here when it's ready."}
      </p>
    </div>
  );
}
