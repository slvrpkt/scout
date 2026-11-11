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

/** Deletes archived agent jobs older than the setting (none when it's Never); returns how many went. */
export async function clearArchive(now = new Date(), days?: number): Promise<number> {
  const keep = days ?? (await loadSettings()).archiveClearDays;
  await prisma.clearedJob.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - CLEARED_KEEP_DAYS * DAY_MS) } } });
  if (keep <= 0) return 0;
  const old = await prisma.agentCandidate.findMany({
    // Archived (when it was archived is its last change), and never made into an application.
    where: { status: AgentCandidateStatus.DISMISSED, applicationId: null, updatedAt: { lt: new Date(now.getTime() - keep * DAY_MS) } },
    select: { id: true, source: true, externalId: true, dedupeKey: true, jobKey: true, score: true, redFlags: true, createdAt: true },
    take: 5000,
  });
  if (old.length === 0) return 0;
  return prisma.$transaction(async (tx) => {
    await tx.clearedJob.createMany({ data: old.flatMap(clearedKeys).map((key) => ({ key })), skipDuplicates: true });
    const { count } = await tx.agentCandidate.deleteMany({ where: { id: { in: old.map((job) => job.id) } } });
    // What went, by kind, so the agent's all-time totals stay the same.
    const row = await tx.setting.findUnique({ where: { key: "agentClearedTally" } });
    const tally: ClearedTally = { ...settingsFromRows(row ? [row] : []).agentClearedTally };
    for (const job of old) {
      if (job.score === 0) tally.setAside += 1;
      else if (archiveReasonOf(flagsOf(job.redFlags)) === "you") tally.archived += 1;
      else tally.skipped += 1;
      const found = job.createdAt.toISOString();
      if (!tally.since || found < tally.since) tally.since = found;
    }
    await saveSettings({ agentClearedTally: tally }, tx);
    return count;
  });
}
