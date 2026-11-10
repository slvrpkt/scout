import "server-only";

import { z } from "zod";

import { defineJob } from "@/lib/jobs/runner";

import { loadSettings } from "@/lib/settings-data";
import { lastKnownTimeZone } from "@/lib/time-zone";

import { loadUsage } from "./budget";
import { agentScanResultSchema, runAgentScan } from "./run";
import { scoreRightAway } from "./score-queue";

/** Keyed so the schedule and Run now find a run that's queued or running. */
export const AGENT_JOB_KEY = "agent";

/** One run of the job agent (E16-3): one search, then scores; one source request at most. */
/** Score now: what's waiting, at once, instead of waiting for the batch. */
export const agentScoreNowJob = defineJob({
  type: "agent-score-now",
  input: z.object({}),
  result: z.object({ scored: z.number().int() }),
  run: async (_input, context) => {
    const [settings, timeZone] = await Promise.all([loadSettings(), lastKnownTimeZone()]);
    const now = new Date();
    const usage = await loadUsage(now, timeZone);
    const outcome = await scoreRightAway(Math.max(0, settings.agentDailyScores - usage.scored), now, timeZone, context.signal);
    return { scored: outcome.scored };
  },
});

export const agentScanJob = defineJob({
  type: "agent-scan",
  input: z.object({
    manual: z.boolean(),
    /** Only these locations, by search: the ones that failed a moment ago. */
    only: z.record(z.string(), z.array(z.string())).optional(),
  }),
  result: agentScanResultSchema,
  run: (input, context) => runAgentScan(input, context),
});
