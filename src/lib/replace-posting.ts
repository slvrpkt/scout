import "server-only";

import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { extractPosting, matchRequirements } from "@/lib/ai/tasks";
import type { Prisma } from "@/generated/prisma/client";
import { rewriteLetter } from "@/lib/jobs/write-letter";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { maxPages } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";

// When a job board sent only the start of a posting: the full description,
// pasted on the Job Posting tab, takes its place. It's read again and
// matched with the profile (one small AI call each), so the match, the ATS
// score and the suggestions follow it. Nothing is rewritten until asked:
// "Rewrite the resume and cover letter for the full posting" does that.

/** Puts the full description in place of the old one and reads it again. */
export async function replacePostingText(applicationId: string, text: string, signal?: AbortSignal): Promise<void> {
  const [provider, options, profile] = await Promise.all([getAiProvider(), loadTaskOptions(), loadProfile()]);
  const extraction = await extractPosting(provider, { posting: text }, { ...options, signal });
  const matching = await matchRequirements(provider, { requirements: extraction.data.requirements, profile }, { ...options, signal });
  await prisma.$transaction(async (tx) => {
    await tx.application.update({
      where: { id: applicationId },
      data: {
        postingText: text,
        extracted: extraction.data as unknown as Prisma.InputJsonValue,
        extractedWith: extraction.promptVersion,
        match: matching.data as unknown as Prisma.InputJsonValue,
        matchedWith: matching.promptVersion,
        postingChangedAt: new Date(),
      },
    });
    // The job it came from keeps the whole text too, so it isn't cut short anywhere else.
    await tx.posting.updateMany({ where: { applicationId }, data: { description: text, complete: true } });
    await tx.agentCandidate.updateMany({ where: { applicationId }, data: { description: text, complete: true } });
  });
}

/** Rewrites the resume, fitted to its pages, and the cover letter (unless it goes without one) for the posting as it is now. */
export async function rewriteForPosting(applicationId: string): Promise<{ letter: boolean }> {
  const application = await prisma.application.findUniqueOrThrow({ where: { id: applicationId }, select: { resumePageLimit: true, noCoverLetter: true } });
  const limit = application.resumePageLimit ?? maxPages((await loadSettings()).pageLimit);
  const profile = await loadProfile();
  const { fitResumeToPages, rewriteResume } = await import("@/lib/page-limit");
  await rewriteResume(applicationId, profile, { maxPages: limit, detail: "the resume for the full job description", before: "As it was before the full job description" });
  if (limit) await fitResumeToPages(applicationId, profile, limit, undefined, undefined, "deny");
  if (application.noCoverLetter) return { letter: false };
  return { letter: await rewriteLetter(applicationId, "the cover letter for the full job description", "As it was before the full job description") };
}
