import "server-only";

import type { PostingSource } from "@/generated/prisma/enums";
import { AgentCandidateStatus } from "@/generated/prisma/enums";
import { postingKey } from "@/lib/job-search/search";
import { prisma } from "@/lib/prisma";
import { settingsFromRows, type ClearedTally } from "@/lib/settings";
import { loadSettings, saveSettings } from "@/lib/settings-data";

import { archiveReasonOf } from "./archive-reasons";

// Clear the Archive (Settings → Your data): archived agent jobs are deleted a
// while after they were archived, so the Archive doesn't grow for ever. Only
// jobs the agentic search found and set aside, or you archived without an
// application; archived applications are never deleted here. Each deleted
// job leaves its keys behind (ClearedJob), so the agent still knows it saw it,
// and is added to a tally by kind, so the agent's all-time totals don't drop.

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a cleared job's keys are kept: past this, the same job is a new opening. */
export const CLEARED_KEEP_DAYS = 180;

/** The keys a job is remembered by once it's cleared. */
export const clearedKeys = (job: { source: PostingSource; externalId: string; dedupeKey: string; jobKey: string | null }) => [
  postingKey(job),
  job.dedupeKey,
  ...(job.jobKey ? [`job:${job.jobKey}`] : []),
];

const flagsOf = (value: unknown) => (Array.isArray(value) ? value.filter((flag): flag is string => typeof flag === "string") : []);

/**
 * Deletes, once they've been archived longer than the setting (never when
 * it's Never): archived agent jobs, and archived applications you never
 * applied to (an agent draft you archived, say), with their documents.
 * Anything you applied to stays. Returns how many went.
 */
export async function clearArchive(now = new Date(), days?: number): Promise<number> {
  const keep = days ?? (await loadSettings()).archiveClearDays;
  await prisma.clearedJob.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - CLEARED_KEEP_DAYS * DAY_MS) } } });
  if (keep <= 0) return 0;
  const cutoff = new Date(now.getTime() - keep * DAY_MS);
  const select = { id: true, source: true, externalId: true, dedupeKey: true, jobKey: true, score: true, redFlags: true, createdAt: true } as const;
  const [old, unapplied] = await Promise.all([
    // Archived (when it was archived is its last change), and never made into an application.
    prisma.agentCandidate.findMany({ where: { status: AgentCandidateStatus.DISMISSED, applicationId: null, updatedAt: { lt: cutoff } }, select, take: 5000 }),
    // Archived applications that never reached Applied, with the agent job each came from.
    prisma.application.findMany({ where: { archivedAt: { lt: cutoff }, sentAt: null }, select: { id: true, agentCandidate: { select } }, take: 1000 }),
  ]);
  if (old.length === 0 && unapplied.length === 0) return 0;
  const drafts = unapplied.flatMap((application) => (application.agentCandidate ? [application.agentCandidate] : []));
  return prisma.$transaction(async (tx) => {
    await tx.clearedJob.createMany({ data: [...old, ...drafts].flatMap(clearedKeys).map((key) => ({ key })), skipDuplicates: true });
    const { count: jobs } = await tx.agentCandidate.deleteMany({ where: { id: { in: [...old, ...drafts].map((job) => job.id) } } });
    // An application's documents, history and the rest go with it.
    const { count: applications } = await tx.application.deleteMany({ where: { id: { in: unapplied.map((application) => application.id) } } });
    // What went, by kind, so the agent's all-time totals stay the same.
    const row = await tx.setting.findUnique({ where: { key: "agentClearedTally" } });
    const tally: ClearedTally = { ...settingsFromRows(row ? [row] : []).agentClearedTally };
    const since = (job: { createdAt: Date }) => {
      const found = job.createdAt.toISOString();
      if (!tally.since || found < tally.since) tally.since = found;
    };
    for (const job of old) {
      if (job.score === 0) tally.setAside += 1;
      else if (archiveReasonOf(flagsOf(job.redFlags)) === "you") tally.archived += 1;
      else tally.skipped += 1;
      since(job);
    }
    for (const job of drafts) {
      tally.drafted += 1;
      since(job);
    }
    await saveSettings({ agentClearedTally: tally }, tx);
    return jobs - drafts.length + applications;
  });
}
