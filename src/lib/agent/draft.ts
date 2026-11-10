import "server-only";

import { z } from "zod";

import type { AgentCandidate } from "@/generated/prisma/client";
import { AgentCandidateStatus } from "@/generated/prisma/enums";
import { ActionError } from "@/lib/action";
import { AiError } from "@/lib/ai/errors";
import { createApplicationFromDocuments, type ApplicationDetails } from "@/lib/application-create";
import type { Extracted } from "@/lib/application-data";
import { fullText } from "@/lib/job-search/find";
import { postingText, type FoundPosting } from "@/lib/job-search/search";
import { readPostingJob } from "@/lib/jobs/read-posting";
import { cancelJob, defineJob, findUnfinishedJobs, type JobContext } from "@/lib/jobs/runner";
import { writeDocumentsJob } from "@/lib/jobs/write-documents";
import { logServerError } from "@/lib/log";
import { dismissPosting, storePosting, unmarkPosting } from "@/lib/postings";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";


// A candidate's draft (E16-5): written the way New application writes one,
// kept off Applications until it's approved (#195), and never sent.
// Adapted from avinashbatchala's fork of Scout.

/** The key of a candidate's draft job, so a second click finds the one under way. */
export const draftJobKey = (candidateId: string) => `agent-candidate:${candidateId}`;

/** A candidate in the shape search results have. */
export function foundFromCandidate(candidate: AgentCandidate): FoundPosting {
  return {
    source: candidate.source,
    externalId: candidate.externalId,
    title: candidate.title,
    company: candidate.company,
    place: candidate.place,
    remote: candidate.remote,
    salary: candidate.salary,
    postedAt: candidate.postedAt?.toISOString() ?? null,
    url: candidate.url,
    via: candidate.via,
    description: candidate.description,
    complete: candidate.complete,
  };
}

/** The application's details from what was read, as New application fills them in. */
function detailsFrom(extracted: Extracted): ApplicationDetails {
  return {
    title: extracted.title ?? [extracted.role, extracted.company].filter(Boolean).join(" · "),
    company: extracted.company ?? "",
    role: extracted.role ?? "",
    location: extracted.location ?? "",
    mode: extracted.mode ?? "",
    salary: extracted.salary ?? "",
    deadline: extracted.deadline ?? "",
  };
}

/**
 * Prepares a candidate's draft. It's claimed first (SCORED → DRAFTING), so a
 * retry, a second click and auto-draft can't make two applications; a failure
 * sends it back to SCORED with the error to show. Returns the application.
 */
export async function draftCandidate(candidateId: string, context: JobContext): Promise<string> {
  const candidate = await prisma.agentCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate) throw new ActionError("That posting is no longer in the agent's queue.");
  if (candidate.status === AgentCandidateStatus.DRAFTED && candidate.applicationId) return candidate.applicationId;
  const { count } = await prisma.agentCandidate.updateMany({
    where: { id: candidateId, status: AgentCandidateStatus.SCORED },
    data: { status: AgentCandidateStatus.DRAFTING, error: null },
  });
  if (count === 0) throw new ActionError("That posting is no longer waiting for a draft.");

  const name = candidate.company || candidate.title || "the posting";
  try {
    const found = foundFromCandidate(candidate);
    // The source may have given only a snippet; the whole text writes a better draft.
    const description = (await fullText(found)) ?? candidate.description;
    if (!description.trim()) throw new ActionError("That posting has no text to write from. Open it and start an application by hand.");
    const posting = postingText({ ...found, description });

    await context.step(`Reading the posting from ${name}`);
    const reading = await readPostingJob.run({ posting }, context);
    await context.step(`Writing the draft for ${name}`);
    const settings = await loadSettings();
    const documents = await writeDocumentsJob.run(
      // The cover letter waits until you open the draft.
      { readJobId: context.id, posting, extracted: reading.extracted, match: reading.match, tone: settings.defaultTone, note: "", letter: false },
      context,
    );
    // Keep the whole text, so a retry doesn't fetch it again.
    if (!candidate.complete && description !== candidate.description) {
      await prisma.agentCandidate.update({ where: { id: candidateId }, data: { description, complete: true } });
    }

    const applicationId = await createApplicationFromDocuments({
      reading: { posting, ...reading },
      documents,
      match: reading.match,
      details: detailsFrom(reading.extracted),
      postingUrl: candidate.url,
      tone: settings.defaultTone,
      note: "",
      claim: { kind: "agent", candidateId, score: candidate.score },
    });
    // The job holds nothing of the draft, but goes with it all the same.
    await prisma.job.updateMany({ where: { id: context.id }, data: { applicationId } });
    return applicationId;
  } catch (error) {
    const known = error instanceof AiError || error instanceof ActionError;
    const message = context.signal.aborted ? "Cancelled." : known ? error.message : "The draft couldn't be prepared. Try again.";
    await prisma.agentCandidate.updateMany({ where: { id: candidateId, status: AgentCandidateStatus.DRAFTING }, data: { status: AgentCandidateStatus.SCORED, error: message } });
    if (!known && !context.signal.aborted) logServerError("job agent draft", error);
    throw error;
  }
}

/** Prepares one candidate's draft in the background (E16-5): from Prepare draft, or a run with auto-draft on. */
export const agentDraftJob = defineJob({
  type: "agent-draft",
  input: z.object({ candidateId: z.string().min(1) }),
  result: z.object({ applicationId: z.string().min(1) }),
  run: async ({ candidateId }, context) => ({ applicationId: await draftCandidate(candidateId, context) }),
});

/**
 * Approve: the draft becomes a normal Draft application, shown everywhere,
 * and its posting shows as applied for in Find jobs. Nothing is sent.
 */
export async function approveCandidate(candidateId: string): Promise<string> {
  const candidate = await prisma.agentCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate || candidate.status !== AgentCandidateStatus.DRAFTED || !candidate.applicationId) {
    throw new ActionError("That draft isn't ready to approve.");
  }
  const applicationId = candidate.applicationId;
  const posting = await storePosting(foundFromCandidate(candidate));
  await prisma.$transaction([
    prisma.agentCandidate.update({ where: { id: candidateId }, data: { status: AgentCandidateStatus.APPROVED } }),
    prisma.application.update({ where: { id: applicationId }, data: { awaitingReview: false } }),
    // One already linked to another application keeps it.
    prisma.posting.updateMany({ where: { id: posting.id, applicationId: null }, data: { applicationId } }),
  ]);
  return applicationId;
}

/**
 * Archive (formerly Dismiss): nothing is deleted. A draft in progress is
 * cancelled; a draft that was written moves to the Job application log,
 * archived, with its documents, chat and notes, where it can be opened,
 * unarchived or deleted. The posting is marked archived in Manual job
 * search and the candidate keeps all it had, so the agent never brings it
 * back, and one without a draft can be put back from the Archived filter.
 */
export async function dismissCandidate(candidateId: string, now = new Date()): Promise<{ archivedApplicationId: string | null }> {
  const candidate = await prisma.agentCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate) throw new ActionError("That posting is no longer in the agent's queue.");
  if (candidate.status === AgentCandidateStatus.DISMISSED) return { archivedApplicationId: candidate.applicationId };
  if (candidate.status === AgentCandidateStatus.APPROVED) throw new ActionError("That draft was approved: it's in Applications now.");

  for (const job of await findUnfinishedJobs(draftJobKey(candidateId))) await cancelJob(job.id);
  await dismissPosting(foundFromCandidate(candidate));
  return prisma.$transaction(async (tx) => {
    // Locked, so a draft that's just being created either lands first and is archived here, or finds it archived and isn't made.
    await tx.$queryRaw`SELECT 1 FROM "AgentCandidate" WHERE id = ${candidateId} FOR UPDATE`;
    const current = await tx.agentCandidate.findUniqueOrThrow({ where: { id: candidateId }, select: { applicationId: true } });
    if (current.applicationId) {
      await tx.application.updateMany({ where: { id: current.applicationId }, data: { awaitingReview: false, archivedAt: now } });
    }
    await tx.agentCandidate.update({ where: { id: candidateId }, data: { status: AgentCandidateStatus.DISMISSED, error: null } });
    return { archivedApplicationId: current.applicationId };
  });
}

/** Put back, from the Agentic screen's Archived filter: a posting archived before it had a draft is back in the queue, and out of Manual job search's Archived. */
export async function restoreCandidate(candidateId: string): Promise<void> {
  const candidate = await prisma.agentCandidate.findUnique({ where: { id: candidateId } });
  if (candidate?.status !== AgentCandidateStatus.DISMISSED || candidate.applicationId) return;
  await prisma.agentCandidate.update({ where: { id: candidateId }, data: { status: AgentCandidateStatus.SCORED, error: null, restoredAt: new Date() } });
  await unmarkPosting(candidate, "dismissed");
}
