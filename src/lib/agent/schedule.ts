import "server-only";

import { AgentCandidateStatus, JobStatus } from "@/generated/prisma/enums";
import { runNightlyBackup } from "@/lib/backup-schedule";
import { addDays, dayOf, weekday } from "@/lib/calendar-view";
import { zonedTime } from "@/lib/google/slots";
import { findUnfinishedJobs, JOB_MESSAGES, startJob } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import type { AgentRun } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";
import { lastKnownTimeZone } from "@/lib/time-zone";

import { agentDraftJob, draftJobKey } from "./draft";
import { AGENT_JOB_KEY, agentScanJob } from "./jobs";
import { markInterruptedRuns } from "./runs";
import { collectBatch, startDueScoring } from "./score-queue";

// The job agent's runs (E16-4): a timer in this process, like the nightly
// backups and the inbox check, so it's only right with one instance. Every
// minute it starts a run once one of the chosen times has come, in the
// user's time zone, not the server's (usually UTC in Docker): a run starts
// within a minute of its time, however long ago Scout was started.

const EVERY_MS = 60 * 1000;
const BATCH_CHECK_MS = 2 * 60 * 1000;
/** After a start, this long before catching up, so a restart settles first. */
export const CATCH_UP_MS = 3 * 60 * 1000;
/** Tries at one run time: the run and two retries, then it waits for the next time. */
const TRIES = 3;
const INTERRUPTED_DRAFT = "Drafting was interrupted. Try again.";
const DAY_MS = 24 * 60 * 60 * 1000;

/** The moments the runs are due on `day`, at `times` ("HH:MM") in `timeZone`, earliest first. */
const slotsOn = (day: string, times: readonly string[], timeZone: string) => {
  const [year, month, date] = day.split("-").map(Number);
  return times
    .map((time) => {
      const [hour, minute] = time.split(":").map(Number);
      return zonedTime(year, month, date, hour, minute, timeZone);
    })
    .sort((a, b) => a.getTime() - b.getTime());
};

/**
 * Whether a run should start now: the latest of today's times has come, and
 * no run, scheduled or Run now, has started since, or only runs that failed or
 * were cut short, up to TRIES. Times missed while the app was off make one
 * run, not one each. A time from before the agent was switched on (`onSince`)
 * isn't missed, so it's never caught up.
 */
/** The days of the week the scheduled runs skip, 1 = Monday … 7 = Sunday: the weekend days switched off. */
export const offDaysOf = (settings: { agentRunSaturday: boolean; agentRunSunday: boolean }): number[] => [
  ...(settings.agentRunSaturday ? [] : [6]),
  ...(settings.agentRunSunday ? [] : [7]),
];

export function scheduledRunDue(now: Date, times: readonly string[], timeZone: string, runs: readonly AgentRun[], onSince: string | null = null, offDays: readonly number[] = []): boolean {
  // A day switched off has no scheduled runs, not even one missed earlier that day.
  if (offDays.includes(weekday(dayOf(now, timeZone)))) return false;
  const latest = slotsOn(dayOf(now, timeZone), times, timeZone).findLast((slot) => slot <= now);
  if (latest === undefined) return false;
  if (onSince && latest.getTime() < Date.parse(onSince)) return false;
  const since = runs.filter((run) => Date.parse(run.at) >= latest.getTime());
  return since.length < TRIES && since.every((run) => run.failed);
}

/** When the next scheduled run starts: the time it was due when one is overdue (the next minute's check starts it), else the next time today, else tomorrow's first. */
export function nextAgentRun(now: Date, times: readonly string[], timeZone: string, runs: readonly AgentRun[], onSince: string | null = null, offDays: readonly number[] = []): Date {
  if (scheduledRunDue(now, times, timeZone, runs, onSince, offDays)) return slotsOn(dayOf(now, timeZone), times, timeZone).findLast((slot) => slot <= now)!;
  const today = dayOf(now, timeZone);
  const later = offDays.includes(weekday(today)) ? undefined : slotsOn(today, times, timeZone).find((slot) => slot > now);
  if (later) return later;
  // The first run of the next day that isn't switched off; with every day off, tomorrow's as before.
  let day = addDays(today, 1);
  for (let tries = 0; tries < 7 && offDays.includes(weekday(day)); tries++) day = addDays(day, 1);
  return slotsOn(day, times, timeZone)[0];
}

/** Starts the day's run when it's due and none is queued or running. */
export async function startDueRun(now = new Date()): Promise<string | null> {
  const settings = await loadSettings();
  if (!settings.agentEnabled) return null;
  if (!scheduledRunDue(now, settings.agentTimes, await lastKnownTimeZone(), settings.agentRuns, settings.agentOnSince, offDaysOf(settings))) return null;
  if ((await findUnfinishedJobs(AGENT_JOB_KEY)).length > 0) return null;
  return startJob(agentScanJob, { manual: false }, { key: AGENT_JOB_KEY });
}

/**
 * After a restart, a candidate left DRAFTING has no job to finish it, and
 * one whose draft was still waiting its turn was never claimed: both are
 * marked to be drafted again once Scout has settled (redoInterruptedDrafts).
 */
export async function resetInterruptedDrafts(now = new Date()): Promise<number> {
  const { count } = await prisma.agentCandidate.updateMany({
    where: { status: AgentCandidateStatus.DRAFTING },
    data: { status: AgentCandidateStatus.SCORED, error: INTERRUPTED_DRAFT },
  });
  const waited = await prisma.job.findMany({
    where: { type: agentDraftJob.type, status: JobStatus.FAILED, error: JOB_MESSAGES.interrupted, startedAt: null, finishedAt: { gte: new Date(now.getTime() - DAY_MS) } },
    select: { key: true },
  });
  const prefix = draftJobKey("");
  const ids = waited.flatMap((job) => (job.key?.startsWith(prefix) ? [job.key.slice(prefix.length)] : []));
  const { count: queued } = await prisma.agentCandidate.updateMany({
    where: { id: { in: ids }, status: AgentCandidateStatus.SCORED, applicationId: null, error: null },
    data: { error: INTERRUPTED_DRAFT },
  });
  return count + queued;
}

/** Starts again the drafts a restart cut short in the past day; they were paid for from the budget when they started. */
export async function redoInterruptedDrafts(now = new Date()): Promise<number> {
  const interrupted = await prisma.agentCandidate.findMany({
    where: { status: AgentCandidateStatus.SCORED, error: INTERRUPTED_DRAFT, updatedAt: { gte: new Date(now.getTime() - DAY_MS) } },
    select: { id: true },
  });
  for (const { id } of interrupted) {
    await prisma.agentCandidate.update({ where: { id }, data: { error: null } });
    await startJob(agentDraftJob, { candidateId: id }, { key: draftJobKey(id) });
  }
  return interrupted.length;
}

const globalForAgent = globalThis as unknown as { agentTimer?: ReturnType<typeof setInterval> };

/** Starts the timer, once per process (dev reloads keep the one they have). */
export function startAgentSchedule(): void {
  if (globalForAgent.agentTimer) return;
  void Promise.all([resetInterruptedDrafts(), markInterruptedRuns()]).catch((error: unknown) => logServerError("job agent", error));
  const check = () => void startDueRun().catch((error: unknown) => logServerError("job agent schedule", error));
  globalForAgent.agentTimer = setInterval(check, EVERY_MS);
  // Don't keep the process alive just for this.
  globalForAgent.agentTimer.unref?.();
  // Scoring that's due, and a batch of scores that's come back, every couple of minutes.
  const collect = () =>
    void lastKnownTimeZone()
      .then(async (zone) => {
        await startDueScoring(new Date(), zone, (await findUnfinishedJobs(AGENT_JOB_KEY)).length > 0);
        await collectBatch(new Date(), zone);
      })
      .catch((error: unknown) => logServerError("job agent batch", error));
  const collecting = setInterval(collect, BATCH_CHECK_MS);
  collecting.unref?.();
  // A few minutes after starting: what was missed or cut short while it was down.
  const catchUp = setTimeout(() => {
    check();
    void redoInterruptedDrafts().catch((error: unknown) => logServerError("job agent", error));
    void runNightlyBackup().catch(() => {});
  }, CATCH_UP_MS);
  catchUp.unref?.();
}
