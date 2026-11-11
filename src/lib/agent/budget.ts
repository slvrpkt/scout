import "server-only";

import { dayOf } from "@/lib/calendar-view";
import { zonedTime } from "@/lib/google/slots";
import { AgentCandidateStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { settingsFromRows, type AgentUsage, type ClearedTally } from "@/lib/settings";
import { loadSettings, saveSettings } from "@/lib/settings-data";

import { archiveReasonOf } from "./archive-reasons";

// The job agent's daily budgets: how many postings it may score and how many
// drafts it may prepare in a day, across all its runs, so a busy morning run
// can't spend the day's share and a quiet one leaves it for the next. Kept in
// Settings like the runs, so the task-data sweep can't reset them.

/** Today's use, in the user's time zone; a new day starts from nothing. */
export const usageOn = (usage: AgentUsage | null, day: string): AgentUsage => (usage?.day === day ? usage : { day, scored: 0, drafted: 0 });

/** What the agent has used today. */
export async function loadUsage(now: Date, timeZone: string): Promise<AgentUsage> {
  return usageOn((await loadSettings()).agentUsage, dayOf(now, timeZone));
}

/**
 * Counts postings scored or drafts queued against today's budget. One count
 * at a time: a lock held until the transaction ends, so two scorings at the
 * same moment (a batch coming back while Score now runs) can't both read the
 * old number and lose one of the counts.
 */
export async function spend(now: Date, timeZone: string, { scored = 0, drafted = 0 }: { scored?: number; drafted?: number }): Promise<AgentUsage> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('agentUsage'))::text`;
    const row = await tx.setting.findUnique({ where: { key: "agentUsage" } });
    const today = usageOn(settingsFromRows(row ? [row] : []).agentUsage, dayOf(now, timeZone));
    const next = { ...today, scored: today.scored + scored, drafted: today.drafted + drafted };
    await saveSettings({ agentUsage: next }, tx);
    return next;
  });
}

/** What the last run's new postings became: scored or set aside, and where the scored ones are now. */
export type RunResults = {
  /** New postings the run found: kept as jobs, or still waiting for a score. */
  found: number;
  /** Still waiting for a score. */
  waiting: number;
  /** Scored by the AI. */
  scored: number;
  /** Set aside by your settings before the AI read them (distance, titles, words). */
  setAside: number;
  /** Of the scored ones: at or above your minimum, waiting; below it; drafted; skipped by a search's rule; archived by you. */
  atMin: number;
  below: number;
  drafted: number;
  skipped: number;
  archived: number;
};

export async function lastRunResults(since: Date, minScore: number): Promise<RunResults> {
  const [jobs, waiting] = await Promise.all([
    prisma.agentCandidate.findMany({ where: { createdAt: { gte: since } }, select: { status: true, score: true, applicationId: true, redFlags: true } }),
    prisma.queuedPosting.count({ where: { createdAt: { gte: since } } }),
  ]);
  const flags = (value: unknown) => (Array.isArray(value) ? value.filter((flag): flag is string => typeof flag === "string") : []);
  const results: RunResults = { found: jobs.length + waiting, waiting, scored: 0, setAside: 0, atMin: 0, below: 0, drafted: 0, skipped: 0, archived: 0 };
  for (const job of jobs) {
    if (job.status === AgentCandidateStatus.DISMISSED && job.score === 0) {
      results.setAside += 1;
      continue;
    }
    results.scored += 1;
    if (job.applicationId) results.drafted += 1;
    else if (job.status === AgentCandidateStatus.DISMISSED) {
      if (archiveReasonOf(flags(job.redFlags)) === "you") results.archived += 1;
      else results.skipped += 1;
    } else if (job.score >= minScore) results.atMin += 1;
    else results.below += 1;
  }
  return results;
}

/**
 * Every run's new postings since the first, the way the tiles count a run's:
 * what's here now, plus what clearing the Archive deleted (its tally), so the
 * totals never go down. `since` is when the first of them was found.
 */
export async function allTimeResults(minScore: number, cleared: ClearedTally): Promise<RunResults & { since: string | null }> {
  const [here, first] = await Promise.all([
    lastRunResults(new Date(0), minScore),
    prisma.agentCandidate.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  const deleted = cleared.setAside + cleared.skipped + cleared.archived;
  const found = first?.createdAt.toISOString() ?? null;
  return {
    found: here.found + deleted,
    waiting: here.waiting,
    scored: here.scored + cleared.skipped + cleared.archived,
    setAside: here.setAside + cleared.setAside,
    atMin: here.atMin,
    below: here.below,
    drafted: here.drafted,
    skipped: here.skipped + cleared.skipped,
    archived: here.archived + cleared.archived,
    since: [found, cleared.since].filter((date): date is string => Boolean(date)).sort()[0] ?? null,
  };
}

/** What today's scores became: still in the list, or archived by a rule that needed the AI to read the posting. */
export async function scoredToday(now: Date, timeZone: string): Promise<{ inList: number; skipped: number }> {
  const since = startOfDay(now, timeZone);
  const [inList, dismissed] = await Promise.all([
    prisma.agentCandidate.count({
      where: { createdAt: { gte: since }, status: { in: [AgentCandidateStatus.SCORED, AgentCandidateStatus.DRAFTING, AgentCandidateStatus.DRAFTED] } },
    }),
    prisma.agentCandidate.findMany({ where: { createdAt: { gte: since }, status: AgentCandidateStatus.DISMISSED, score: { gt: 0 } }, select: { redFlags: true } }),
  ]);
  const flags = (value: unknown) => (Array.isArray(value) ? value.filter((flag): flag is string => typeof flag === "string") : []);
  return { inList, skipped: dismissed.filter((candidate) => archiveReasonOf(flags(candidate.redFlags)) !== "you").length };
}

/** Midnight at the start of `now`'s day in `timeZone`. */
export function startOfDay(now: Date, timeZone: string): Date {
  const [year, month, date] = dayOf(now, timeZone).split("-").map(Number);
  return zonedTime(year, month, date, 0, 0, timeZone);
}
