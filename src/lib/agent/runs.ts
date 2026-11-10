import "server-only";

import { AGENT_RUNS_KEPT, type AgentRun } from "@/lib/settings";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// The job agent's runs (E16), kept in Settings rather than as their Job rows,
// which the task-data sweep deletes after "Keep task data for": the limits
// below must hold whatever that is set to.

/** Runs allowed in any 24 hours on top of the scheduled ones, for Run now. */
export const AGENT_EXTRA_RUNS = 2;
/** At most this many runs in any 24 hours, scheduled or Run now: one per run time, and a couple more. */
export const agentRunsPerDay = (times: readonly string[]) => times.length + AGENT_EXTRA_RUNS;
/** Run now waits this long after the previous run of either kind. */
export const AGENT_MANUAL_INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The runs in the 24 hours before `now`, newest first. */
export const runsInPastDay = (runs: readonly AgentRun[], now: Date) =>
  runs.filter((run) => now.getTime() - Date.parse(run.at) < DAY_MS);

/** What a run that a restart cut short says on the Agent screen. */
const INTERRUPTED_RUN = "Scout restarted during this run. It runs again a few minutes after starting up.";

/** "HH:MM" in `timeZone`, to compare with run times. */
const clockAt = (now: Date, timeZone: string) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);

/**
 * How many more postings may be scored now: the shares of the run times that
 * have come, less what's been scored today, so what one run didn't use carries
 * on to the next. Before the first time, as for a Run now, its share. Without
 * shares set, an even split.
 */
export function scoreRoom({ now, timeZone, times, shares, daily, scored }: { now: Date; timeZone: string; times: readonly string[]; shares: readonly number[]; daily: number; scored: number }): number {
  const sorted = times.toSorted();
  const even = Array.from({ length: sorted.length }, (_, index) => Math.floor(daily / sorted.length) + (index < daily % sorted.length ? 1 : 0));
  // Yours stay as they are when run times change: an added time gets 0 until you say otherwise.
  const each = shares.length > 0 ? sorted.map((_, index) => shares[index] ?? 0) : even;
  const clock = clockAt(now, timeZone);
  const reached = Math.max(1, sorted.filter((time) => time <= clock).length);
  const allowed = each.slice(0, reached).reduce((sum, share) => sum + share, 0);
  return Math.max(0, Math.min(allowed, daily) - scored);
}

/** Why no run may start now, in words, or null when one may. */
export function runLimitProblem(runs: readonly AgentRun[], now: Date, { manual, times }: { manual: boolean; times: readonly string[] }): string | null {
  // A run that failed or was cut short doesn't use up the day's runs: it's tried again.
  const recent = runsInPastDay(runs, now).filter((run) => !run.failed && !run.skipped && !run.retry);
  const most = agentRunsPerDay(times);
  if (recent.length >= most) {
    const free = new Date(Math.min(...recent.map((run) => Date.parse(run.at))) + DAY_MS);
    return `The agent has run ${most} times in the past 24 hours, as many as it may. ${waitText(free.getTime() - now.getTime())}`;
  }
  const last = runs[0];
  if (manual && last) {
    const wait = Date.parse(last.at) + AGENT_MANUAL_INTERVAL_MS - now.getTime();
    if (wait > 0) return `The agent ran less than an hour ago. ${waitText(wait)}`;
  }
  return null;
}

/** "Try again in 25 minutes." */
function waitText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
  const hours = Math.ceil(minutes / 60);
  return `Try again in ${hours} ${hours === 1 ? "hour" : "hours"}.`;
}

/** Records a run as it starts, before it asks the source, so a crash and a retry can't spend the quota twice. */
export async function recordRunStart(now: Date, manual: boolean, retry = false): Promise<AgentRun> {
  const run: AgentRun = { at: now.toISOString(), manual, message: null, ...(retry ? { retry } : {}) };
  const { agentRuns } = await loadSettings();
  await saveSettings({ agentRuns: [run, ...agentRuns].slice(0, AGENT_RUNS_KEPT) });
  return run;
}

/** Notes what a run ended with, for the Agent screen; `failed` when it got nothing, so that it's tried again. */
export async function recordRunEnd(run: AgentRun, message: string, failed = false): Promise<void> {
  const { agentRuns } = await loadSettings();
  await saveSettings({ agentRuns: agentRuns.map((entry) => (entry.at === run.at ? { ...entry, message, ...(failed ? { failed } : {}) } : entry)) });
}

/** Notes a run that had nothing to do, for the Agent screen; it doesn't use up the day's runs. */
export async function recordSkippedRun(now: Date, manual: boolean, message: string): Promise<void> {
  const { agentRuns } = await loadSettings();
  await saveSettings({ agentRuns: [{ at: now.toISOString(), manual, message, skipped: true }, ...agentRuns].slice(0, AGENT_RUNS_KEPT) });
}

/** After a restart, a run that never ended was cut short. Returns how many. */
export async function markInterruptedRuns(): Promise<number> {
  const { agentRuns } = await loadSettings();
  const cut = agentRuns.filter((run) => run.message === null);
  if (cut.length > 0) await saveSettings({ agentRuns: agentRuns.map((run) => (run.message === null ? { ...run, message: INTERRUPTED_RUN, failed: true } : run)) });
  return cut.length;
}
