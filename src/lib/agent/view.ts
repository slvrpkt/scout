import "server-only";

import type { AgentCandidate, Prisma } from "@/generated/prisma/client";
import { AgentCandidateStatus, JobStatus } from "@/generated/prisma/enums";
import { formatCalendarDate, formatDate, formatDateTime, formatDateTime12 } from "@/lib/dates";
import { findDuplicate, loadDuplicateLog, type DuplicateMatch, type LogEntry } from "@/lib/duplicates";
import { loadJobSearchConfig } from "@/lib/job-search/config";
import { countryName } from "@/lib/job-search/countries";
import { fullText } from "@/lib/job-search/find";
import { describeSearch, type JobSource } from "@/lib/job-search/search";
import { findUnfinishedJobs } from "@/lib/jobs/runner";
import { SOURCE_INFO } from "@/lib/job-search/sources";
import { prisma } from "@/lib/prisma";
import { breakdownOf, type RubricLine } from "@/lib/scoring/rubric";
import { loadSettings } from "@/lib/settings-data";
import { lastKnownTimeZone } from "@/lib/time-zone";

import { dayOf } from "@/lib/calendar-view";

import type { SearchQuery } from "@/lib/job-search/search";
import { skipRuleList } from "@/lib/scoring/rubric";
import { usageOn } from "./budget";
import { freshFirst, freshLabel, withoutStaleBonus } from "@/lib/freshness";

import { stringsOf } from "./candidates";
import { draftJobKey, foundFromCandidate } from "./draft";
import { AGENT_JOB_KEY } from "./jobs";
import { agentSetupProblem } from "./run";
import { loadAgentSearches } from "./searches";
import { agentRunsPerDay, runsInPastDay } from "./runs";
import { nextAgentRun } from "./schedule";

// What the Agent screen shows (E16-6).

/** The search's query, with its locations named as its place. */
const placed = ({ query, places }: { query: SearchQuery; places: string }) => {
  const list = skipRuleList(places);
  return list.length > 0 ? { ...query, place: list.join(", "), anyDistance: true } : query;
};

export type AgentCandidateView = {
  id: string;
  title: string;
  company: string;
  /** "Rotterdam · Remote · €70k", what's known of them. */
  facts: string;
  /** "Posted 2 days ago · via LinkedIn on JSearch". */
  origin: string;
  source: JobSource;
  url: string;
  score: number;
  reasons: string[];
  redFlags: string[];
  /** How your own scoring rubric made the score (#42), when there was one. */
  breakdown?: RubricLine[];
  /** Why the last try at a draft failed. */
  error: string | null;
  /** The draft, once there is one. */
  applicationId: string | null;
  /** The job preparing its draft, while one is queued or running. */
  draftJobId: string | null;
  /** The saved search that found it, while it exists. */
  foundBy: string | null;
  /** "Posted 3 hours ago" or "Posted today" while it's within your fresh window; null after. Fresh ones list first. */
  fresh?: string | null;
  /** Put back from the Archive once: shown with a "Was archived" label. */
  wasArchived?: boolean;
  /** The posting's text, as the source gave it. */
  description: string;
  /** When the job was posted, e.g. "3 Nov 2026"; null when the source doesn't say. */
  postedOn: string | null;
  /** When the agent found it, e.g. "4 Nov 2026". */
  foundOn: string;
  /** "Apply by", from its draft once there is one; null without a deadline. */
  deadline: string | null;
  /** For the filters: where it is, whether it's remote, and when it was posted (ISO). */
  place: string;
  remote: boolean | null;
  postedAt: string | null;
  /** The application in the Job application log it looks like, other than its own draft (#43). */
  duplicate: DuplicateMatch | null;
};

export type AgentView = {
  enabled: boolean;
  autoDraft: boolean;
  minScore: number;
  /** Today's use of the daily budgets. */
  budget: { scored: number; scoreLimit: number; drafted: number; draftLimit: number };
  /** The saved searches, each as "Data scientist · Berlin, 25 km · via JSearch", with how its last run went. */
  searches: { id: string; line: string; enabled: boolean; lastMessage: string | null }[];
  /** Why it can't run: no search, AI provider, source or key; null when it's set up. */
  setupProblem: string | null;
  /** Which settings section fixes it. */
  setupSection: "agent" | "ai" | "jobs" | null;
  /** The daily limit is used up. */
  limitReached: boolean;
  /** Postings waiting for a score. */
  waiting: number;
  /** How many runs it may make in any 24 hours. */
  runsPerDay: number;
  /** When it runs, "04:00", in the user's zone. */
  times: string[];
  lastRun: { at: string; message: string | null } | null;
  /** In the user's zone; null while the agent is off. */
  nextRun: string | null;
  /** A run queued or running, to follow. */
  runJobId: string | null;
  drafts: AgentCandidateView[];
  /** At or above the minimum score, best first. */
  scored: AgentCandidateView[];
  /** Below it: kept so they don't come back, shown on request. */
  belowMinimum: AgentCandidateView[];
};

/** The Agent item's badge (E16-6): what's waiting for a look. */
export async function countAgentQueue(): Promise<number> {
  const { agentMinScore } = await loadSettings();
  return prisma.agentCandidate.count({
    where: {
      OR: [
        { status: AgentCandidateStatus.SCORED, score: { gte: agentMinScore } },
        { status: AgentCandidateStatus.DRAFTED, applicationId: { not: null } },
      ],
    },
  });
}

const sectionOf = (problem: string): AgentView["setupSection"] =>
  problem.includes("AI provider") ? "ai" : problem.includes("Job search") ? "jobs" : "agent";

export async function loadAgentView(now = new Date()): Promise<AgentView> {
  const [settings, config, timeZone, searches, stored, draftJobs, runJobs, log] = await Promise.all([
    loadSettings(),
    loadJobSearchConfig(),
    lastKnownTimeZone(),
    loadAgentSearches(),
    prisma.agentCandidate.findMany({
      where: { status: { in: [AgentCandidateStatus.SCORED, AgentCandidateStatus.DRAFTING, AgentCandidateStatus.DRAFTED] } },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      include: { search: { select: { name: true } }, application: { select: { deadline: true } } },
    }),
    prisma.job.findMany({
      where: { type: "agent-draft", status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } },
      select: { id: true, key: true },
    }),
    prisma.job.findMany({ where: { key: AGENT_JOB_KEY, status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } }, select: { id: true }, take: 1 }),
    loadDuplicateLog(),
  ]);
  const draftJob = new Map(draftJobs.map((job) => [job.key?.replace(/^agent-candidate:/, ""), job.id]));
  // A posting past your fresh window loses its fresh bonus, here, as it's shown: scores, minimum and order follow.
  const freshHours = settings.scoringPrefs.fresh.hours;
  const candidates = stored.map((candidate) => asNow(candidate, now, freshHours));

  const source: JobSource | null = config.source;
  const via = source ? ` · via ${SOURCE_INFO[source].name}` : "";
  const searchViews = searches
    .filter((search) => search.query.keywords.trim())
    .map((search) => ({
      id: search.id,
      line: `${describeSearch(placed(search), countryName(search.query.country) || search.query.country.toUpperCase(), source)}${via}`,
      enabled: search.enabled,
      lastMessage: search.lastMessage,
    }));
  const setupProblem = await agentSetupProblem(searches);

  const view = (candidate: ShownCandidate) => candidateView(candidate, draftJob.get(candidate.id) ?? null, log, timeZone, freshHours, now);
  const drafts = candidates.filter((candidate) => candidate.status === AgentCandidateStatus.DRAFTED && candidate.applicationId).map(view);
  const waiting = candidates.filter((candidate) => candidate.status !== AgentCandidateStatus.DRAFTED);
  const last = settings.agentRuns[0];

  return {
    enabled: settings.agentEnabled,
    autoDraft: settings.agentAutoDraft,
    minScore: settings.agentMinScore,
    budget: {
      scored: usageOn(settings.agentUsage, dayOf(now, timeZone)).scored,
      scoreLimit: settings.agentDailyScores,
      drafted: usageOn(settings.agentUsage, dayOf(now, timeZone)).drafted,
      draftLimit: settings.agentDailyDrafts,
    },
    searches: searchViews,
    setupProblem,
    setupSection: setupProblem ? sectionOf(setupProblem) : null,
    limitReached: runsInPastDay(settings.agentRuns, now).filter((run) => !run.failed && !run.skipped && !run.retry).length >= agentRunsPerDay(settings.agentTimes),
    /** Postings waiting for a score, in a batch or not yet sent. */
    waiting: await prisma.queuedPosting.count(),
    runsPerDay: agentRunsPerDay(settings.agentTimes),
    times: settings.agentTimes,
    lastRun: last ? { at: formatDateTime12(new Date(last.at), timeZone, now), message: last.message } : null,
    nextRun: settings.agentEnabled ? formatDateTime12(nextAgentRun(now, settings.agentTimes, timeZone, settings.agentRuns), timeZone, now) : null,
    runJobId: runJobs[0]?.id ?? null,
    drafts,
    // Freshly posted ones first, to apply early, then by score.
    scored: freshFirst(waiting.filter((candidate) => candidate.score >= settings.agentMinScore).map(view)),
    belowMinimum: freshFirst(waiting.filter((candidate) => candidate.score < settings.agentMinScore).map(view)),
  };
}

/** A candidate as loaded for the Agent screen: with its search's name and its draft's deadline. */
type ShownCandidate = AgentCandidate & { search: { name: string } | null; application: { deadline: Date | null } | null };

const SHOWN_INCLUDE = { search: { select: { name: true } }, application: { select: { deadline: true } } } as const;

/** A candidate with its score as it stands now: without the fresh bonus once it's past the window. */
function asNow<T extends { score: number; reasons: Prisma.JsonValue; postedAt: Date | null }>(candidate: T, now: Date, hours: number): T {
  const reasons = stringsOf(candidate.reasons);
  const shown = withoutStaleBonus({ score: candidate.score, reasons }, candidate.postedAt, now, hours);
  return shown.score === candidate.score ? candidate : { ...candidate, score: shown.score, reasons: shown.reasons };
}

/** One candidate as the Agent screen and its posting page show it. */
function candidateView(candidate: ShownCandidate, draftJobId: string | null, log: LogEntry[], timeZone: Parameters<typeof formatDateTime>[1], freshHours = 0, now = new Date()): AgentCandidateView {
  return {
    id: candidate.id,
    fresh: freshLabel(candidate.postedAt, now, freshHours),
    title: candidate.title.trim() || "Untitled posting",
    company: candidate.company.trim(),
    facts: [candidate.place, candidate.remote ? "Remote" : "", candidate.salary].filter(Boolean).join(" · "),
    origin: [
      [candidate.via ? `via ${candidate.via}` : "", `on ${SOURCE_INFO[candidate.source].name}`].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(" · "),
    source: candidate.source,
    url: candidate.url,
    score: candidate.score,
    reasons: stringsOf(candidate.reasons),
    redFlags: stringsOf(candidate.redFlags),
    breakdown: breakdownOf(candidate.breakdown),
    error: candidate.error,
    applicationId: candidate.applicationId,
    draftJobId,
    foundBy: candidate.search?.name ?? null,
    wasArchived: candidate.restoredAt != null,
    description: candidate.description,
    postedOn: candidate.postedAt ? formatDate(candidate.postedAt) : null,
    foundOn: formatDateTime(candidate.createdAt, timeZone, new Date()),
    deadline: candidate.application?.deadline ? formatCalendarDate(candidate.application.deadline) : null,
    place: candidate.place,
    remote: candidate.remote,
    postedAt: candidate.postedAt?.toISOString() ?? null,
    duplicate: findDuplicate(
      { url: candidate.url, company: candidate.company, role: candidate.title, place: candidate.place, postedAt: candidate.postedAt, deadline: candidate.application?.deadline },
      log,
      { exclude: [candidate.applicationId] },
    ),
  };
}

/**
 * One posting the agent found, for its own page (a title clicked on the
 * Agent screen): its whole text, fetched once if the source only sent the
 * start, and whether it's archived or has a draft. Null when it's gone.
 */
export async function loadAgentPosting(id: string): Promise<{ posting: AgentCandidateView; archived: boolean; drafted: boolean } | null> {
  let candidate = await prisma.agentCandidate.findUnique({ where: { id }, include: SHOWN_INCLUDE });
  if (!candidate) return null;
  if (!candidate.complete && candidate.url) {
    const text = await fullText(foundFromCandidate(candidate)).catch(() => null);
    if (text && text !== candidate.description) {
      candidate = await prisma.agentCandidate.update({ where: { id }, data: { description: text, complete: true }, include: SHOWN_INCLUDE });
    }
  }
  const [jobs, log, settings] = await Promise.all([findUnfinishedJobs(draftJobKey(id)), loadDuplicateLog(), loadSettings()]);
  const hours = settings.scoringPrefs.fresh.hours;
  const now = new Date();
  return {
    posting: candidateView(asNow(candidate, now, hours), jobs[0]?.id ?? null, log, await lastKnownTimeZone(), hours, now),
    archived: candidate.status === AgentCandidateStatus.DISMISSED,
    // A draft, approved or archived, is opened as its application instead.
    drafted: candidate.applicationId !== null,
  };
}
