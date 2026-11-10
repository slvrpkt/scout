import "server-only";

import { z } from "zod";

import { DocumentKind } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { isAiUsable } from "@/lib/ai/config";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { suggestResume } from "@/lib/ai/tasks";
import { extractedOf, unitsSchema } from "@/lib/application-data";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";

import { defineJob, findUnfinishedJobs, startJob } from "./runner";

// The suggestions beside a resume follow it: after an edit has settled, the
// AI reads the resume as it stands now.

/** Edits come in runs: this long after the first, they've settled. */
const SETTLE_MS = 30_000;

const jobKey = (applicationId: string) => `suggestions:${applicationId}`;

export const refreshSuggestionsJob = defineJob({
  type: "refresh-suggestions",
  input: z.object({ applicationId: z.string().min(1) }),
  result: z.object({ suggestions: z.number().int() }),
  async run({ applicationId }, { signal }) {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const application = await prisma.application.findUnique({ where: { id: applicationId }, include: { documents: { where: { kind: DocumentKind.RESUME } } } });
    const units = unitsSchema.safeParse(application?.documents[0]?.units);
    if (!application || !units.success) return { suggestions: 0 };
    const [provider, options, profile] = await Promise.all([getAiProvider(), loadTaskOptions(), loadProfile()]);
    const { data } = await suggestResume(provider, { profile, extracted: extractedOf(application), units: units.data }, { ...options, signal });
    await prisma.application.updateMany({ where: { id: applicationId }, data: { resumeSuggestions: data } });
    return { suggestions: data.length };
  },
});

/** After a resume is edited; a failure leaves the last suggestions up. */
export async function queueSuggestions(applicationId: string): Promise<void> {
  try {
    if (!(await isAiUsable()) || (await findUnfinishedJobs(jobKey(applicationId))).length > 0) return;
    await startJob(refreshSuggestionsJob, { applicationId }, { key: jobKey(applicationId), applicationId });
  } catch (error) {
    logServerError("refreshing suggestions", error);
  }
}
