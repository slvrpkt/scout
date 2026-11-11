import "server-only";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { AgentCandidateStatus, JobStatus } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { loadAiConfig } from "@/lib/ai/config";
import { AiError } from "@/lib/ai/errors";
import type { AIProvider, BatchItem, CompletionRequest, JsonCompletionRequest } from "@/lib/ai/provider";
import { aiCenter, type CostCenter } from "@/lib/cost-rates";
import { limitReached } from "@/lib/costs";
import { foundPostingSchema, type FoundPosting } from "@/lib/job-search/search";
import { startJob } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { saveScore } from "@/lib/posting-scores";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { loadPostingScorer } from "@/lib/scoring";
import { loadScoringConfig } from "@/lib/scoring/config";
import type { SettingsData } from "@/lib/settings";
import { loadSettings, saveSettings } from "@/lib/settings-data";

import { loadUsage, spend, startOfDay } from "./budget";
import { candidateData, jobKey } from "./candidates";
import { agentDraftJob, draftJobKey, HELD_SHORT } from "./draft";
import { scoreRoom } from "./runs";

// New postings wait here to be scored, so a job found once is never searched
// for and paid for again. With a provider that has them, a run's scoring goes
// out as a batch at half the price, and comes back in the background; Score
// now reads what's waiting right away at the normal price.

/** A posting that's waited this long is out of date. */
const KEEP_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export type Queued = { posting: FoundPosting; searchId: string; rules: string[] };

/** Adds new postings; one already waiting stays as it is. */
export async function enqueue(postings: readonly Queued[], now: Date): Promise<void> {
  await prisma.queuedPosting.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - KEEP_DAYS * DAY_MS) }, batchId: null } });
  await prisma.queuedPosting.createMany({
    data: postings.map(({ posting, searchId, rules }) => ({ jobKey: jobKey(posting), searchId, rules, posting: posting as unknown as Prisma.InputJsonValue })),
    skipDuplicates: true,
  });
}

export const countWaiting = () => prisma.queuedPosting.count({ where: { batchId: null } });

/** Up to `count` waiting postings, newest first, one from each search in turn. */
async function take(count: number) {
  const rows = await prisma.queuedPosting.findMany({ where: { batchId: null } });
  const ofRow = (row: (typeof rows)[number]) => foundPostingSchema.parse(row.posting);
  const newest = rows.toSorted((a, b) => Date.parse(ofRow(b).postedAt ?? "") - Date.parse(ofRow(a).postedAt ?? "") || 0);
  const bySearch = new Map<string, typeof rows>();
  for (const row of newest) bySearch.set(row.searchId, [...(bySearch.get(row.searchId) ?? []), row]);
  const lists = [...bySearch.values()];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  const turns = Array.from({ length: longest }, (_, index) => lists.flatMap((list) => (index < list.length ? [list[index]] : []))).flat();
  return turns.slice(0, count).map((row) => ({ id: row.id, posting: ofRow(row), searchId: row.searchId, rules: z.array(z.string()).catch([]).parse(row.rules) }));
}

export type ScoreOutcome = { scored: number; queued: number; skipped: number; sent: number; problem: string | null };

type Row = Awaited<ReturnType<typeof take>>[number];

/** Keeps a scored posting as a candidate, and takes it out of the queue. */
async function keep(row: Row, { data, scoredWith, skip, free }: Awaited<ReturnType<Awaited<ReturnType<typeof loadPostingScorer>>>>, now: Date, timeZone: string, settings: SettingsData) {
  // Set aside by your settings before the AI: nothing paid, so it doesn't count toward the day's scores.
  if (!free) await spend(now, timeZone, { scored: 1 });
  // A posting the search's "What to skip" matches goes straight to Archived, saying why.
  const fit = skip ? { ...data, redFlags: [`Skipped by your rule “${skip.rule}”${skip.note ? `: ${skip.note}` : ""}`, ...data.redFlags] } : data;
  try {
    await prisma.agentCandidate.create({
      data: { ...candidateData(row.posting, fit), ...(skip ? { status: AgentCandidateStatus.DISMISSED } : {}), search: { connect: { id: row.searchId } } },
      select: { id: true },
    });
    // Find jobs shows it too (#208).
    await saveScore(row.posting, data, scoredWith);
  } catch (error) {
    // Another run kept it first: it's seen either way.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
  }
  await prisma.queuedPosting.deleteMany({ where: { id: row.id } });
  return { skipped: Boolean(skip), queued: !skip && data.score >= settings.agentMinScore };
}

/** Today's postings that reached your minimum score. */
export const qualifyingToday = (now: Date, timeZone: string, minScore: number) =>
  prisma.agentCandidate.count({ where: { score: { gte: minScore }, createdAt: { gte: startOfDay(now, timeZone) }, status: { not: AgentCandidateStatus.DISMISSED } } });

/** The job agent scores with your settings' checks first: a job that can't reach your minimum score isn't sent to the AI. */
const gateOf = (settings: SettingsData) => ({ gate: { cutoff: settings.agentMinScore } });

/** Scores up to `room` right away, stopping at the day's goal. */
export async function scoreNow(room: number, now: Date, timeZone: string, settings: SettingsData, signal: AbortSignal, step?: (name: string) => Promise<void>): Promise<ScoreOutcome> {
  const outcome: ScoreOutcome = { scored: 0, queued: 0, skipped: 0, sent: 0, problem: null };
  const rows = await take(room);
  if (rows.length === 0) return outcome;
  await step?.(`Scoring ${rows.length} ${rows.length === 1 ? "posting" : "postings"}`);
  const [score, profile] = await Promise.all([loadPostingScorer(), loadProfile()]);
  let qualifying = await qualifyingToday(now, timeZone, settings.agentMinScore);
  for (const row of rows) {
    if (signal.aborted || qualifying >= settings.agentDailyGoal) break;
    try {
      const kept = await keep(row, await score(row.posting, profile, signal, row.rules, gateOf(settings)), now, timeZone, settings);
      outcome.scored += 1;
      if (kept.skipped) outcome.skipped += 1;
      if (kept.queued) {
        outcome.queued += 1;
        qualifying += 1;
      }
    } catch (error) {
      // One posting that fails doesn't stop the rest.
      if (error instanceof AiError) outcome.problem = error.message;
      else if (!signal.aborted) logServerError("job agent scoring", error);
    }
  }
  return outcome;
}

class Captured extends Error {
  constructor(readonly request: CompletionRequest) {
    super("captured");
  }
}

/** A provider that notes the request instead of sending it. */
const capturing = (provider: AIProvider): AIProvider => ({ ...provider, kind: provider.kind, model: provider.model, complete: (async (request: CompletionRequest) => { throw new Captured(request); }) as AIProvider["complete"], listModels: provider.listModels.bind(provider), test: provider.test.bind(provider) });

/** A provider that gives back an answer the batch already has. */
const replaying = (provider: AIProvider, text: string): AIProvider => ({
  ...provider,
  kind: provider.kind,
  model: provider.model,
  complete: (async (request: JsonCompletionRequest<unknown>) => request.schema.parse(JSON.parse(text))) as AIProvider["complete"],
  listModels: provider.listModels.bind(provider),
  test: provider.test.bind(provider),
});

/** Who scoring bills through: Jev, or the AI provider. */
export async function scoringCenter(): Promise<CostCenter | null> {
  if ((await loadScoringConfig()).scorer === "JEV") return "TYPESAFE";
  return aiCenter((await loadAiConfig()).provider);
}

/** After a search, scoring waits this long, and this long again each time the search still isn't done. */
export const SCORE_WAIT_MS = 5 * 60 * 1000;
const BATCH_GIVE_UP_MS = 25 * 60 * 60 * 1000;

/** Whether scoring waits for a batch: the provider has them, and they're on. */
export async function scoresByBatch(settings: SettingsData): Promise<boolean> {
  if (!settings.agentBatch) return false;
  return Boolean((await getAiProvider().catch(() => null))?.sendBatch);
}

/** Starts the scoring that's due, once the search has finished; returns how many went out. */
export async function startDueScoring(now: Date, timeZone: string, searching: boolean): Promise<number> {
  const settings = await loadSettings();
  if (!settings.agentScoreAt || now.getTime() < Date.parse(settings.agentScoreAt)) return 0;
  // Past the scorer's own cost limit, the jobs wait in the queue.
  if (await limitReached(await scoringCenter(), now)) {
    await saveSettings({ agentScoreAt: new Date(now.getTime() + SCORE_WAIT_MS).toISOString() });
    return 0;
  }
  if (searching || settings.agentBatchId) {
    await saveSettings({ agentScoreAt: new Date(now.getTime() + SCORE_WAIT_MS).toISOString() });
    return 0;
  }
  const scored = (await loadUsage(now, timeZone)).scored;
  const room = scoreRoom({ now, timeZone, times: settings.agentTimes, shares: settings.agentShares, daily: settings.agentDailyScores, scored });
  await saveSettings({ agentScoreAt: null });
  if (room === 0) return 0;
  return (await scoreWaiting(room, now, timeZone, settings, new AbortController().signal)).sent;
}

/** Sends up to `room` postings as a batch, or scores them now without one. Scoring by batch needs a provider that has batches. */
export async function scoreWaiting(room: number, now: Date, timeZone: string, settings: SettingsData, signal: AbortSignal): Promise<ScoreOutcome> {
  const provider = settings.agentBatch && !settings.agentBatchId ? await getAiProvider().catch(() => null) : null;
  if (!provider?.sendBatch) return scoreNow(room, now, timeZone, settings, signal);
  const rows = await take(room);
  if (rows.length === 0) return { scored: 0, queued: 0, skipped: 0, sent: 0, problem: null };
  const [score, profile] = await Promise.all([loadPostingScorer(capturing(provider)), loadProfile()]);
  const items: BatchItem[] = [];
  for (const row of rows) {
    try {
      const result = await score(row.posting, profile, signal, row.rules, gateOf(settings));
      // Set aside by your settings, without the AI: kept now, not batched.
      if (result.free) {
        await keep(row, result, now, timeZone, settings);
        continue;
      }
      // Scored without asking the provider, so it can't go in a batch.
      return scoreNow(room, now, timeZone, settings, signal);
    } catch (error) {
      if (!(error instanceof Captured)) throw error;
      items.push({ id: row.id, request: error.request });
    }
  }
  if (items.length === 0) return { scored: 0, queued: 0, skipped: 0, sent: 0, problem: null };
  const batchId = await provider.sendBatch(items);
  await prisma.queuedPosting.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { batchId } });
  await saveSettings({ agentBatchId: batchId, agentBatchAt: new Date().toISOString(), agentScoreAt: null });
  return { scored: 0, queued: 0, skipped: 0, sent: rows.length, problem: null };
}

/** The best of today's scored postings get a draft, as far as the run time's share of the day's drafts goes. */
export async function draftBest(now: Date, timeZone: string, settings: SettingsData): Promise<number> {
  if (!settings.agentAutoDraft || (await limitReached(aiCenter((await loadAiConfig()).provider), now))) return 0;
  const room = scoreRoom({ now, timeZone, times: settings.agentTimes, shares: settings.agentDraftShares, daily: settings.agentDailyDrafts, scored: (await loadUsage(now, timeZone)).drafted });
  if (room === 0) return 0;
  const busy = new Set(
    (await prisma.job.findMany({ where: { type: "agent-draft", status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } }, select: { key: true } })).map((job) => job.key),
  );
  const best = (
    await prisma.agentCandidate.findMany({
      where: {
        status: AgentCandidateStatus.SCORED,
        score: { gte: Math.max(settings.agentDraftScore, settings.agentMinScore) },
        createdAt: { gte: startOfDay(now, timeZone) },
        // Not one held back for being cut short: it waits for you.
        OR: [{ error: null }, { NOT: { error: { startsWith: HELD_SHORT } } }],
      },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      take: room + busy.size,
      select: { id: true },
    })
  )
    .filter(({ id }) => !busy.has(draftJobKey(id)))
    .slice(0, room);
  for (const { id } of best) await startJob(agentDraftJob, { candidateId: id, auto: true }, { key: draftJobKey(id) });
  if (best.length > 0) await spend(now, timeZone, { drafted: best.length });
  return best.length;
}

/** Brings in a batch that's finished; how many were scored, or null while it's still working. */
export async function collectBatch(now = new Date(), timeZone: string): Promise<number | null> {
  const settings = await loadSettings();
  const batchId = settings.agentBatchId;
  if (!batchId) return null;
  // A batch ends within a day. One that's gone or stuck mustn't hold up the rest.
  if (settings.agentBatchAt && now.getTime() - Date.parse(settings.agentBatchAt) > BATCH_GIVE_UP_MS) {
    await prisma.queuedPosting.updateMany({ where: { batchId }, data: { batchId: null } });
    await saveSettings({ agentBatchId: null, agentBatchAt: null });
    return 0;
  }
  const provider = await getAiProvider();
  if (!provider.batchResults) return null;
  const answers = await provider.batchResults(batchId);
  if (!answers) return null;
  const rows = await prisma.queuedPosting.findMany({ where: { batchId } });
  const profile = await loadProfile();
  const signal = new AbortController().signal;
  let scored = 0;
  for (const row of rows) {
    const text = answers.get(row.id);
    const shown = { id: row.id, posting: foundPostingSchema.parse(row.posting), searchId: row.searchId, rules: z.array(z.string()).catch([]).parse(row.rules) };
    try {
      if (!text) throw new Error("no answer in the batch");
      const score = await loadPostingScorer(replaying(provider, text));
      await keep(shown, await score(shown.posting, profile, signal, shown.rules), now, timeZone, settings);
      scored += 1;
    } catch (error) {
      // Back in the queue, for the next run.
      logServerError("a scored batch", error);
      await prisma.queuedPosting.updateMany({ where: { id: row.id }, data: { batchId: null } });
    }
  }
  await saveSettings({ agentBatchId: null, agentBatchAt: null });
  await draftBest(now, timeZone, settings);
  return scored;
}

/** Score now: drops a batch that's still out, and reads what's waiting at once. */
export async function scoreRightAway(room: number, now: Date, timeZone: string, signal: AbortSignal): Promise<ScoreOutcome> {
  const settings = await loadSettings();
  await saveSettings({ agentScoreAt: null });
  if (settings.agentBatchId) {
    const provider = await getAiProvider();
    await provider.cancelBatch?.(settings.agentBatchId).catch((error: unknown) => logServerError("cancelling a batch", error));
    await prisma.queuedPosting.updateMany({ where: { batchId: settings.agentBatchId }, data: { batchId: null } });
    await saveSettings({ agentBatchId: null, agentBatchAt: null });
  }
  const outcome = await scoreNow(room, now, timeZone, settings, signal);
  await draftBest(now, timeZone, settings);
  return outcome;
}
