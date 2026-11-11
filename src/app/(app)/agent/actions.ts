"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AgentCandidateStatus } from "@/generated/prisma/enums";
import { agentDraftJob, dismissCandidate, draftJobKey, foundFromCandidate, restoreCandidate } from "@/lib/agent/draft";
import { storePosting, unmarkPosting } from "@/lib/postings";
import { AGENT_JOB_KEY, agentScanJob, agentScoreNowJob } from "@/lib/agent/jobs";
import { agentSetupProblem } from "@/lib/agent/run";
import { runLimitProblem } from "@/lib/agent/runs";
import { allTimeResults, lastRunResults, scoredToday, usageOn } from "@/lib/agent/budget";
import { dayOf } from "@/lib/calendar-view";
import { lastKnownTimeZone } from "@/lib/time-zone";
import { MAX_SKIP_RULES_LENGTH } from "@/lib/scoring/rubric";
import { createAgentSearch, defaultPages, deleteAgentSearch, loadAgentSearches, MAX_AGENT_PAGES, MAX_AGENT_SEARCHES, readySearches, updateAgentSearch } from "@/lib/agent/searches";
import { loadJobSearchConfig } from "@/lib/job-search/config";
import { action, ActionError } from "@/lib/action";
import { searchQuerySchema } from "@/lib/job-search/search";
import { findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { AGENT_DAILY_DRAFTS, AGENT_DAILY_SCORES, agentTimeSchema, MAX_AGENT_TIMES, sortedTimes } from "@/lib/settings";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// The Agent screen's actions (E16). Nothing here ever sends anything:
// approving only makes a draft a normal Draft application.

/**
 * Settings → Job agent (E16-7): each change saves at once. Turning the agent
 * on needs a search that's on, with keywords and a country.
 */
export const saveAgentSettings = action(
  z.object({
    enabled: z.boolean().optional(),
    times: z.array(agentTimeSchema).min(1, "Keep at least one run time.").max(MAX_AGENT_TIMES).optional(),
    minScore: z.number().int().min(0).max(100).optional(),
    dailyScores: z.number().int().min(AGENT_DAILY_SCORES.min).max(AGENT_DAILY_SCORES.max).optional(),
    dailyDrafts: z.number().int().min(AGENT_DAILY_DRAFTS.min).max(AGENT_DAILY_DRAFTS.max).optional(),
    autoDraft: z.boolean().optional(),
    scoreShares: z.array(z.number().int().min(0).max(AGENT_DAILY_SCORES.max)).max(MAX_AGENT_TIMES).optional(),
    draftShares: z.array(z.number().int().min(0).max(AGENT_DAILY_DRAFTS.max)).max(MAX_AGENT_TIMES).optional(),
    draftScore: z.number().int().min(0).max(100).optional(),
    dailyGoal: z.number().int().min(1).max(1000).optional(),
    titleSkip: z.array(z.string().trim().min(1).max(60)).max(200).optional(),
  }),
  async (changes) => {
    if (changes.enabled && readySearches(await loadAgentSearches()).length === 0) {
      throw new ActionError("Add a search with keywords and a country before turning the agent on.");
    }
    // Switching it on: the first run is the next time on the list, not one already gone by today.
    const switchedOn = changes.enabled === true && !(await loadSettings()).agentEnabled;
    await saveSettings({
      agentEnabled: changes.enabled,
      ...(switchedOn ? { agentOnSince: new Date().toISOString() } : {}),
      agentTimes: changes.times && sortedTimes(changes.times),
      agentMinScore: changes.minScore,
      agentDailyScores: changes.dailyScores,
      agentDailyDrafts: changes.dailyDrafts,
      agentAutoDraft: changes.autoDraft,
      agentShares: changes.scoreShares,
      agentDraftShares: changes.draftShares,
      agentDraftScore: changes.draftScore,
      agentDailyGoal: changes.dailyGoal,
      agentTitleSkip: changes.titleSkip,
    });
    revalidatePath("/agent");
    return null;
  },
);

const searchId = z.string().min(1).max(100);

/** Add search: a new saved search at the end of the list, starting from `query`. */
export const addAgentSearch = action(z.object({ query: searchQuerySchema }), async ({ query }) => {
  const search = await createAgentSearch(query, defaultPages((await loadJobSearchConfig()).source));
  if (!search) throw new ActionError(`The agent can keep ${MAX_AGENT_SEARCHES} searches at most. Remove one first.`);
  revalidatePath("/agent");
  return { id: search.id, maxPages: search.maxPages };
});

/** A saved search's query, saved as it's typed, its pages or its on/off switch. */
export const changeAgentSearch = action(
  z.object({ id: searchId, query: searchQuerySchema.optional(), enabled: z.boolean().optional(), maxPages: z.number().int().min(1).max(MAX_AGENT_PAGES).optional(), skipRules: z.string().max(MAX_SKIP_RULES_LENGTH).optional(), places: z.string().max(1000).optional(), altTitles: z.string().max(1000).optional(), companies: z.string().max(1500).optional() }),
  async ({ id, ...changes }) => {
    if (!(await updateAgentSearch(id, changes))) throw new ActionError("That search no longer exists.");
    revalidatePath("/agent");
    return null;
  },
);

/** Remove: what the search found stays on the Agent screen. */
export const removeAgentSearch = action(z.object({ id: searchId }), async ({ id }) => {
  await deleteAgentSearch(id);
  revalidatePath("/agent");
  return null;
});

/**
 * Run now (E16-4): one more run, at most once an hour after the previous
 * one and within the daily limit. A run already queued or running is
 * reused rather than started again.
 */
export const runAgentNow = action(z.object({}), async () => {
  const settings = await loadSettings();
  if (!settings.agentEnabled) throw new ActionError("Turn the job agent on in Settings → Job agent first.");
  const setup = await agentSetupProblem(await loadAgentSearches());
  if (setup) throw new ActionError(setup);
  const [unfinished] = await findUnfinishedJobs(AGENT_JOB_KEY);
  if (unfinished) return { jobId: unfinished.id, reused: true };
  const limit = runLimitProblem(settings.agentRuns, new Date(), { manual: true, times: settings.agentTimes });
  if (limit) throw new ActionError(limit);
  const jobId = await startJob(agentScanJob, { manual: true }, { key: AGENT_JOB_KEY });
  revalidatePath("/agent");
  return { jobId, reused: false };
});

/** Score now: what's waiting gets its score at once, at the normal price. */
export const scoreWaitingNow = action(z.object({}), async () => {
  const [unfinished] = await findUnfinishedJobs(AGENT_JOB_KEY);
  if (unfinished) return { jobId: unfinished.id, reused: true };
  const jobId = await startJob(agentScoreNowJob, {}, { key: AGENT_JOB_KEY });
  revalidatePath("/agent");
  return { jobId, reused: false };
});

/** Today's counts and whether scoring is going on, for the Agent screen to keep up while it's open. */
export const agentToday = action(z.object({}), async () => {
  const [settings, timeZone, waiting, unfinished] = await Promise.all([loadSettings(), lastKnownTimeZone(), prisma.queuedPosting.count(), findUnfinishedJobs(AGENT_JOB_KEY)]);
  const now = new Date();
  const usage = usageOn(settings.agentUsage, dayOf(now, timeZone));
  const last = settings.agentRuns[0];
  const results = last ? await lastRunResults(new Date(last.at), settings.agentMinScore) : null;
  return { scored: usage.scored, drafted: usage.drafted, ...(await scoredToday(now, timeZone)), waiting, scoring: Boolean(settings.agentBatchId) || unfinished.length > 0, running: unfinished.some((job) => job.type === "agent-scan"), results, all: await allTimeResults(settings.agentMinScore, settings.agentClearedTally) };
});

const candidateId = z.string().min(1).max(100);

/** Save for later on an agent's job: kept as a posting, as Manual job search keeps one, so it shows on Saved for later. */
export const saveAgentPosting = action(z.object({ candidateId, saved: z.boolean() }), async ({ candidateId: id, saved }, { toast }) => {
  const candidate = await prisma.agentCandidate.findUnique({ where: { id } });
  if (!candidate) throw new ActionError("That job is gone. Reload the page.");
  if (saved) {
    await storePosting(foundFromCandidate(candidate), { savedAt: new Date(), dismissedAt: null });
    toast("Saved for later.");
  } else {
    await unmarkPosting({ source: candidate.source, externalId: candidate.externalId }, "saved");
    toast("Taken off Saved for later.");
  }
  revalidatePath("/saved");
  return null;
});

/** Every screen an agent draft shows on, or leaves. */
function revalidateAgent() {
  revalidatePath("/agent");
  revalidatePath("/applications");
  revalidatePath("/jobs");
  revalidatePath("/");
}

/**
 * Prepare draft (E16-5): writes a candidate's draft in the background. A
 * draft under way is reused, and one already made is answered with.
 */
export const prepareAgentDraft = action(z.object({ candidateId }), async ({ candidateId }) => {
  const candidate = await prisma.agentCandidate.findUnique({ where: { id: candidateId }, select: { status: true, applicationId: true } });
  if (!candidate) throw new ActionError("That posting is no longer in the agent's queue.");
  if (candidate.status === AgentCandidateStatus.DRAFTED && candidate.applicationId) return { jobId: null, applicationId: candidate.applicationId };
  const [unfinished] = await findUnfinishedJobs(draftJobKey(candidateId));
  if (unfinished) return { jobId: unfinished.id, applicationId: null };
  if (candidate.status !== AgentCandidateStatus.SCORED) throw new ActionError("That posting is no longer waiting for a draft.");
  const jobId = await startJob(agentDraftJob, { candidateId }, { key: draftJobKey(candidateId) });
  revalidatePath("/agent");
  return { jobId, applicationId: null };
});

/** Approve (E16-5): the draft joins Applications as a Draft. Nothing is sent. */
/**
 * Archive (E16-5): the posting never comes back; its draft, if any, moves to
 * the Job application log, archived. Nothing is deleted.
 */
export const dismissAgentCandidate = action(z.object({ candidateId }), async ({ candidateId }) => {
  const archived = await dismissCandidate(candidateId);
  revalidateAgent();
  revalidatePath("/applications");
  return archived;
});

/** Put back, from the Archived filter. */
export const restoreAgentCandidate = action(z.object({ id: candidateId }), async ({ id }) => {
  await restoreCandidate(id);
  revalidateAgent();
  return null;
});
