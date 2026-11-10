import "server-only";

import { z } from "zod";

import { isAiUsable } from "@/lib/ai/config";
import { logServerError } from "@/lib/log";
import { loadSettings } from "@/lib/settings-data";

import { defineJob, findUnfinishedJobs, startJob } from "./runner";

// Every new draft is checked against what its job asks for and, below the
// ATS goal (90), rewritten for what's missing, up to ATS_ATTEMPTS times
// (ats-rewrite.ts). In the background, so creating an application doesn't
// wait for it. Settings → AI provider → "Optimize for ATS" turns it off.

export const atsKey = (applicationId: string) => `ats-improve:${applicationId}`;

export const atsImproveJob = defineJob({
  type: "ats-improve",
  input: z.object({ applicationId: z.string().min(1) }),
  result: z.object({ score: z.number().nullable(), attempts: z.number().int() }),
  async run({ applicationId }, { step }) {
    await step("Checking the resume against the job");
    const { rewriteToGrade } = await import("@/lib/ats-rewrite");
    const { grade, attempts } = await rewriteToGrade(applicationId);
    return { score: grade?.score ?? null, attempts };
  },
});

/** After a draft is made: improve it for the ATS in the background, unless that's off or already under way. */
export async function queueAtsImprove(applicationId: string): Promise<void> {
  try {
    if (!(await loadSettings()).atsOptimize || !(await isAiUsable())) return;
    if ((await findUnfinishedJobs(atsKey(applicationId))).length > 0) return;
    await startJob(atsImproveJob, { applicationId }, { key: atsKey(applicationId) });
  } catch (error) {
    logServerError("queueing the ATS check", error);
  }
}
