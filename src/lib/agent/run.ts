import { overLimitText } from "@/lib/cost-rates";
import { costLimitsPassed, limitReached } from "@/lib/costs";
import "server-only";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { AgentCandidateStatus, JobStatus } from "@/generated/prisma/enums";
import { AiError } from "@/lib/ai/errors";
import { searchPostings } from "@/lib/job-search";
import { credentialsFor, loadJobSearchConfig, requestContext } from "@/lib/job-search/config";
import { JobSearchError } from "@/lib/job-search/errors";
import { MAX_SEARCH_COMPANIES } from "@/lib/job-search/company";
import { profileCountry } from "@/lib/job-search/profile-country";
import { isAnywhere, MAX_ALT_TITLES, postingKey, type FoundPosting } from "@/lib/job-search/search";
import { startJob, type JobContext } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { postingStates } from "@/lib/postings";
import { prisma } from "@/lib/prisma";
import { scoringProblem } from "@/lib/scoring";
import { skipRuleList } from "@/lib/scoring/rubric";
import { loadSettings, saveSettings } from "@/lib/settings-data";

import { lastKnownTimeZone } from "@/lib/time-zone";

import { loadUsage, spend, startOfDay } from "./budget";
import { agentDedupeKey, candidateData, isEmployerLink, jobKey, titleRuledOut, titleSkipFit, titleSkipWord } from "./candidates";
import { agentDraftJob, draftJobKey } from "./draft";
import { recordRunEnd, recordRunStart, recordSkippedRun, runLimitProblem, scoreRoom } from "./runs";
import { countWaiting, draftBest, enqueue, qualifyingToday, SCORE_WAIT_MS, scoreNow, scoresByBatch, scoringCenter } from "./score-queue";
import { loadAgentSearches, readySearches, recordSearchRun, type AgentSearch } from "./searches";

// One run of the job agent (E16-3): each saved search in turn, the postings
// seen before dropped, and a score for the newest of the rest, a fair share
// from each search. It never sends anything.
// Adapted from avinashbatchala's fork of Scout.

export const agentScanResultSchema = z.object({
  /** Postings the source returned. */
  found: z.number().int().min(0),
  /** Of those, the ones not seen before. */
  fresh: z.number().int().min(0),
  scored: z.number().int().min(0),
  drafted: z.number().int().min(0),
  /** Found but seen before: saved, dismissed or applied for in Find jobs, or a candidate already. */
  skipped: z.number().int().min(0),
  /** What to tell the user. */
  message: z.string(),
  /** Today's budgets after the run; absent in runs from before there were budgets. */
  budget: z.object({ scored: z.number().int(), scoreLimit: z.number().int(), drafted: z.number().int(), draftLimit: z.number().int() }).optional(),
  /** How each saved search went; absent in runs from before there were several. */
  searches: z.array(z.object({ name: z.string(), pages: z.number().int().min(0).default(1), found: z.number().int().min(0), fresh: z.number().int().min(0), message: z.string() })).default([]),
});
export type AgentScanResult = z.infer<typeof agentScanResultSchema>;

/** A job seen on one board is the same job on another for this long; after that it's taken for a new opening. */
const REPOST_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A request that couldn't reach the source gets one more try after this long. */
const REQUEST_RETRY_MS = 3000;
/** Locations that failed get another go after this long. */
const PLACE_RETRY_MS = 3 * 60 * 1000;

/** How far back a search looks: 72 hours on its first run, or after a gap of more than a day, else what's new since the last run. */
export function postedWindow({ lastRunAt }: { createdAt: Date; lastRunAt: Date | null }, now: Date): "3days" | "day" {
  const gap = !lastRunAt || now.getTime() - lastRunAt.getTime() > 1.25 * DAY_MS;
  return gap ? "3days" : "day";
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const stopped = (message: string): AgentScanResult => ({ found: 0, fresh: 0, scored: 0, drafted: 0, skipped: 0, message, searches: [] });

/** Why the agent can't run at all, in words, or null when it's set up: at least one search switched on and complete. */
export async function agentSetupProblem(searches: readonly Pick<AgentSearch, "enabled" | "query">[]): Promise<string | null> {
  const on = searches.filter((search) => search.enabled);
  if (!on.some((search) => search.query.keywords.trim())) return "Add what to look for in Settings → Job agent first.";
  if (!on.some((search) => search.query.keywords.trim() && search.query.country)) return "Choose a country for the search in Settings → Job agent first.";
  // Scoring is what a run does; drafts ask the AI provider when there are any.
  const scoring = await scoringProblem();
  if (scoring) return scoring;
  const config = await loadJobSearchConfig();
  if (!config.source) return "Choose a job source in Settings → Job search first.";
  // It searches on its own, which the BA's terms forbid most clearly (#223).
  if (config.source === "ARBEITSAGENTUR") return "The job agent doesn't search the Bundesagentur für Arbeit. Choose JSearch, Adzuna or FreeHire in Settings → Job search for it.";
  try {
    credentialsFor(config, config.source);
  } catch (error) {
    if (error instanceof JobSearchError) return error.message;
    throw error;
  }
  return null;
}

/** The postings from a page that are new to the agent: not saved, dismissed or applied for, and not a candidate already. */
export async function newPostings(postings: readonly FoundPosting[], now = new Date()): Promise<FoundPosting[]> {
  const states = await postingStates(postings);
  const unseen = postings.filter((posting) => {
    const state = states.get(postingKey(posting));
    // The same job from another board, already in the Job application log.
    return !state?.saved && !state?.dismissed && !state?.applicationId && state?.duplicate?.kind !== "duplicate";
  });
  const keys = unseen.map(agentDedupeKey);
  const jobs = unseen.map(jobKey);
  const known = await prisma.agentCandidate.findMany({
    where: {
      OR: [
        ...unseen.map(({ source, externalId }) => ({ source, externalId })),
        { dedupeKey: { in: keys } },
        // The same job from another board. After a while, it's a new opening.
        { jobKey: { in: jobs }, createdAt: { gte: new Date(now.getTime() - REPOST_DAYS * DAY_MS) } },
      ],
    },
    select: { source: true, externalId: true, dedupeKey: true, jobKey: true },
  });
  const waiting = await prisma.queuedPosting.findMany({ where: { jobKey: { in: jobs } }, select: { jobKey: true } });
  const seen = new Set([...known.flatMap((candidate) => [postingKey(candidate), candidate.dedupeKey, ...(candidate.jobKey ? [candidate.jobKey] : [])]), ...waiting.map((row) => row.jobKey)]);
  // The same job twice in one page counts once too, the employer's own link first.
  const order = unseen.map((_, index) => index).toSorted((a, b) => Number(isEmployerLink(unseen[b].url)) - Number(isEmployerLink(unseen[a].url)));
  const kept = new Set<number>();
  for (const index of order) {
    if (seen.has(postingKey(unseen[index])) || seen.has(keys[index]) || seen.has(jobs[index])) continue;
    seen.add(keys[index]);
    seen.add(jobs[index]);
    kept.add(index);
  }
  return unseen.filter((_, index) => kept.has(index));
}

const newestFirst = (a: FoundPosting, b: FoundPosting) => (b.postedAt ? Date.parse(b.postedAt) : 0) - (a.postedAt ? Date.parse(a.postedAt) : 0);

/** The first of each list, then the second of each, and so on: every search gets its share of the scores. */
export function roundRobin<T>(lists: readonly (readonly T[])[]): T[] {
  const longest = Math.max(0, ...lists.map((list) => list.length));
  return Array.from({ length: longest }, (_, index) => lists.flatMap((list) => (index < list.length ? [list[index]] : []))).flat();
}

const postingsInWords = (count: number) => `${count} ${count === 1 ? "posting" : "postings"}`;

/**
 * One run: each saved search that's on, page after page up to its maxPages
 * (one source request each), then a score for the newest new postings of each
 * search in turn, as far as today's scoring budget (agentDailyScores) goes. A
 * search that fails (a used-up quota, say) is noted and the others go on.
 * Each scored posting is kept as a candidate, so it doesn't come back; one
 * below agentMinScore stays out of the queue. With auto-draft on, the best of
 * today's get a draft each, as far as today's draft budget goes, each its
 * own job. A scheduled run does nothing while the agent is off.
 */
export async function runAgentScan({ manual, only }: { manual: boolean; only?: Record<string, string[]> }, context: JobContext, now = new Date()): Promise<AgentScanResult> {
  const settings = await loadSettings();
  if (!settings.agentEnabled && !manual && !only) return stopped("The job agent is off.");
  const searches = await loadAgentSearches();
  const setup = await agentSetupProblem(searches);
  if (setup) return stopped(setup);
  const limit = only ? null : runLimitProblem(settings.agentRuns, now, { manual: false, times: settings.agentTimes });
  const nothingToDo = async (message: string) => {
    await recordSkippedRun(now, manual, message);
    return stopped(message);
  };
  if (limit) return nothingToDo(limit);
  // Today's scores are used up: searching now would pay for postings nothing can read.
  const zone = await lastKnownTimeZone();
  const roomNow = async () => scoreRoom({ now, timeZone: zone, times: settings.agentTimes, shares: settings.agentShares, daily: settings.agentDailyScores, scored: (await loadUsage(now, zone)).scored });
  // A limit stops its own service only: past the search's, what's waiting still gets scored.
  const searchLimit = async () => {
    const over = (await costLimitsPassed(settings.costLimits, now, zone)).find((entry) => entry.center === source);
    return over ? overLimitText(over) : "";
  };
  if ((await qualifyingToday(now, zone, settings.agentMinScore)) >= settings.agentDailyGoal) {
    return nothingToDo(`${settings.agentDailyGoal} jobs reached your minimum score today, so this run didn't search.`);
  }
  if ((await roomNow()) === 0) {
    return nothingToDo(`Today's scoring budget so far is used up, so this run didn't search. It picks up again at the next run time, or tomorrow.`);
  }

  const run = await recordRunStart(now, manual, Boolean(only));
  const finish = async (result: AgentScanResult) => {
    // Every search failed: nothing came of it, so the schedule tries again.
    await recordRunEnd(run, result.message, result.found === 0 && failure !== null);
    return result;
  };

  const config = await loadJobSearchConfig();
  const source = config.source!;
  const credentials = credentialsFor(config, source);
  // Where company searches look: the country in your profile, else the US.
  const homeCountry = (await profileCountry()).code;
  // Going over locations that failed: those of those searches, no others.
  const ready = readySearches(searches)
    .filter((search) => !only || search.id in only)
    // The one asked longest ago first, so stopping early doesn't always leave out the same search.
    .toSorted((a, b) => (a.lastRunAt?.getTime() ?? 0) - (b.lastRunAt?.getTime() ?? 0));
  const failedPlaces: Record<string, string[]> = {};
  // A job two searches both find is scored once, for the first.
  const inRun = new Map<string, Set<string>>();
  const fresh: { searchId: string; postings: FoundPosting[] }[] = [];
  const outcomes: AgentScanResult["searches"] = [];
  let found = 0;
  let failure: string | null = null;
  // Enough to fill this run's share: no point paying for more.
  const wanted = await roomNow();
  let gathered = await countWaiting();
  let searchStopped = "";
  for (const [index, search] of ready.entries()) {
    if (gathered >= wanted) break;
    searchStopped ||= await searchLimit();
    if (searchStopped) break;
    const label = ready.length === 1 ? "Searching for new postings" : `Searching for “${search.name}”`;
    const of = ready.length === 1 ? "" : ` (${index + 1} of ${ready.length})`;
    const kept: FoundPosting[] = [];
    let searchFound = 0;
    let pages = 0;
    let problem: string | null = null;
    // Each location on its own, or the query's own place. With locations, the source decides how near counts.
    const places = only ? (only[search.id] ?? []).filter(Boolean) : skipRuleList(search.places);
    const asked = { ...search.query, postedWithin: postedWindow(search, now) };
    const atPlaces = places.length > 0 ? places.map((place) => (isAnywhere(place) ? { ...asked, place: "" } : { ...asked, place, anyDistance: true })) : [asked];
    // Its own title, then each other title it has, each searched on its own.
    const titles = [search.query.keywords, ...skipRuleList(search.altTitles).slice(0, MAX_ALT_TITLES)].map((title) => title.trim()).filter((title, index, all) => title && all.findIndex((other) => other.toLowerCase() === title.toLowerCase()) === index);
    // With companies: each title at each company, once across the country in your profile (else the US), its locations aside.
    const companies = skipRuleList(search.companies).slice(0, MAX_SEARCH_COMPANIES);
    const queries =
      companies.length > 0
        ? titles.flatMap((keywords) => companies.map((company) => ({ ...asked, keywords, company, place: "", anyDistance: true, country: homeCountry })))
        : titles.flatMap((keywords) => atPlaces.map((at) => ({ ...at, keywords })));
    for (const query of queries) {
    const ask = (from: string | null) => searchPostings(source, credentials, query, from, requestContext(source));
    let stop = false;
    let next: string | null = null;
    let placePages = 0;
    // Page after page, up to the search's limit; one request each. A page
    // with nothing new ends it: the ones after it are older still.
    do {
      if (context.signal.aborted) break;
      pages += 1;
      placePages += 1;
      await context.step(`${label}${pages > 1 ? `, page ${pages}` : ""}${of}`);
      let page: { postings: FoundPosting[]; next: string | null };
      try {
        page = await ask(next).catch(async (error: unknown) => {
          if (!(error instanceof JobSearchError) || error.problem !== "unavailable" || context.signal.aborted) throw error;
          await wait(REQUEST_RETRY_MS);
          return ask(next);
        });
      } catch (error) {
        if (!(error instanceof JobSearchError)) throw error;
        problem = error.message;
        // A bad key or a used-up quota stops every other location too; anything else, only this one.
        stop = error.problem === "key" || error.problem === "quota";
        if (!stop) (failedPlaces[search.id] ??= []).push(query.place);
        break;
      }
      searchFound += page.postings.length;
      const unseen = await newPostings(page.postings, now);
      // Skipped by title: never scored, but kept in Archived, saying which word, so the list can be checked.
      for (const posting of unseen) {
        const word = titleSkipWord(posting.title, settings.agentTitleSkip);
        if (word) await archiveByTitle(posting, word, search.id);
      }
      const fresh = unseen.filter((posting) => !titleRuledOut(posting.title, settings.agentTitleSkip)).filter((posting) => {
        const key = jobKey(posting);
        // Scored once, but every search that found it has its say on skipping it.
        const finders = inRun.get(key);
        if (finders) {
          finders.add(search.id);
          return false;
        }
        inRun.set(key, new Set([search.id]));
        return true;
      });
      kept.push(...fresh);
      gathered += fresh.length;
      next = page.next;
      if (fresh.length === 0) break;
    } while (next && placePages < search.maxPages);
    if (stop || gathered >= wanted) break;
    }

    // Nothing at all from a search that failed on its first page: as a failure.
    if (problem && searchFound === 0) {
      failure = problem;
      outcomes.push({ name: search.name, pages, found: 0, fresh: 0, message: problem });
      await recordSearchRun(search.id, now, problem);
      continue;
    }
    found += searchFound;
    fresh.push({ searchId: search.id, postings: kept.toSorted(newestFirst) });
    const read = pages === 1 ? "" : ` on ${pages} pages`;
    const missed = (failedPlaces[search.id] ?? []).filter(Boolean);
    const message = `${postingsInWords(searchFound)} found${read}, ${kept.length} new.${problem ? ` Then: ${problem}` : ""}${missed.length > 0 ? ` Couldn't search ${missed.join(", ")}${only ? "" : ": trying again in a few minutes"}.` : ""}`;
    outcomes.push({ name: search.name, pages, found: searchFound, fresh: kept.length, message });
    await recordSearchRun(search.id, now, message);
  }

  // Only the locations that failed go again, once.
  if (!only && Object.keys(failedPlaces).length > 0) {
    const again = setTimeout(() => {
      void import("./jobs")
        .then(({ AGENT_JOB_KEY, agentScanJob }) => startJob(agentScanJob, { manual: false, only: failedPlaces }, { key: AGENT_JOB_KEY }))
        .catch((error: unknown) => logServerError("job agent", error));
    }, PLACE_RETRY_MS);
    again.unref?.();
  }

  const freshCount = fresh.reduce((sum, entry) => sum + entry.postings.length, 0);
  const counts = { found, fresh: freshCount, skipped: found - freshCount, searches: outcomes };
  const timeZone = zone;
  const skipRules = new Map(ready.map((search) => [search.id, skipRuleList(search.skipRules)]));
  const rulesFor = (posting: FoundPosting) => [...new Set([...(inRun.get(jobKey(posting)) ?? [])].flatMap((id) => skipRules.get(id) ?? []))];

  // Everything new waits in the queue, whoever scores it, so it's never paid for twice.
  await enqueue(fresh.flatMap(({ searchId, postings }) => postings.map((posting) => ({ posting, searchId, rules: rulesFor(posting) }))), now);
  const waitingNow = await countWaiting();
  const room = await roomNow();
  // By batch, scoring starts half an hour on, once the search is done. Otherwise, now.
  const scoringStopped = await limitReached(await scoringCenter(), now);
  const later = room > 0 && !scoringStopped && (await scoresByBatch(settings));
  if (later && !settings.agentScoreAt) await saveSettings({ agentScoreAt: new Date(now.getTime() + SCORE_WAIT_MS).toISOString() });
  const outcome = room > 0 && !later && !scoringStopped ? await scoreNow(room, now, timeZone, settings, context.signal, context.step) : { scored: 0, queued: 0, skipped: 0, sent: later ? Math.min(room, await countWaiting()) : 0, problem: null };
  const { scored, queued, skipped, sent, problem } = outcome;
  // A batch brings its drafts when it comes back.
  const drafted = sent > 0 || context.signal.aborted ? 0 : await draftBest(now, timeZone, settings);

  const usage = await loadUsage(now, timeZone);
  const budget = { scored: usage.scored, scoreLimit: settings.agentDailyScores, drafted: usage.drafted, draftLimit: settings.agentDailyDrafts };
  const preparing = drafted > 0 ? ` Preparing ${drafted === 1 ? "a draft for the best one" : `drafts for the best ${drafted}`}.` : "";
  const unscored = Math.max(0, waitingNow - scored - sent);
  const waiting = `${queued} new ${queued === 1 ? "posting is" : "postings are"} waiting for a look.`;
  let message: string;
  if (sent > 0) {
    message = `${postingsInWords(sent)} waiting. Scoring starts in about half an hour, once the search is done.`;
  } else if (freshCount === 0 && scored === 0 && problem) {
    message = problem;
  } else if (freshCount === 0 && scored === 0) {
    // Every search failed: say why, as a single search did.
    message = failure && fresh.length === 0 ? failure : found === 0 ? `The ${ready.length === 1 ? "search" : "searches"} found no postings this time.` : "No new postings this time.";
  } else if (room === 0) {
    message = `${postingsInWords(freshCount)} new, but today's scoring budget of ${settings.agentDailyScores} is used up.`;
  } else {
    message =
      scored === 0
        ? (problem ?? "No postings could be scored this time.")
        : queued === 0
          ? `Scored ${scored} new ${scored === 1 ? "posting" : "postings"}; none reached your minimum score of ${settings.agentMinScore}.`
          : waiting;
    if (skipped > 0) message += ` ${skipped} skipped by your rules and moved to Archived.`;
    if (unscored > 0) message += ` Today's scoring budget is used up: ${postingsInWords(unscored)} ${unscored === 1 ? "wasn't" : "weren't"} scored.`;
  }
  const paused = [searchStopped, scoringStopped ? overLimitText(scoringStopped) : ""].filter(Boolean).join(" ");
  return finish({ ...counts, scored, drafted, budget, message: `${paused ? `${paused} ` : ""}${message}${preparing}` });
}

/** Keeps a posting skipped by its title in Archived; one already kept, by this run or another, stays as it is. */
async function archiveByTitle(posting: FoundPosting, word: string, searchId: string) {
  try {
    await prisma.agentCandidate.create({
      data: { ...candidateData(posting, titleSkipFit(word)), status: AgentCandidateStatus.DISMISSED, search: { connect: { id: searchId } } },
      select: { id: true },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
  }
}
