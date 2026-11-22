import "server-only";

import { z } from "zod";

import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { extractPosting, matchRequirements } from "@/lib/ai/tasks";
import { extractedSchema, matchSchema } from "@/lib/application-data";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";

import { READ_POSTING_STEPS } from "./application-steps";
import { defineJob } from "./runner";

/**
 * Reads a pasted posting and compares it with the profile (E7-2, NEW-2…NEW-4).
 * Saves nothing: the result waits in the job until the application is created.
 */
export const readPostingJob = defineJob({
  type: "read-posting",
  input: z.object({
    posting: z.string().trim().min(1).max(100_000),
    /** The posting it's kept as in Manual job search: a pasted one gets its title, company and place once read. */
    postingId: z.string().nullish(),
  }),
  result: z.object({
    extracted: extractedSchema,
    extractedWith: z.string(),
    match: matchSchema,
    matchedWith: z.string(),
  }),
  async run({ posting, postingId }, { step, signal }) {
    await step(READ_POSTING_STEPS[0]);
    const [provider, options, profile] = await Promise.all([getAiProvider(), loadTaskOptions(), loadProfile()]);

    await step(READ_POSTING_STEPS[1]);
    const extraction = await extractPosting(provider, { posting }, { ...options, signal });

    // A pasted posting is named after what was read, in Manual job search's Saved for later.
    if (postingId) {
      const { role, title, company, location, salary } = extraction.data;
      await prisma.posting.updateMany({
        where: { id: postingId, pasted: true, applicationId: null },
        data: { title: (role || title || "Pasted posting").slice(0, 500), company: (company ?? "").slice(0, 300), place: (location ?? "").slice(0, 300), salary: (salary ?? "").slice(0, 200) },
      });
    }

    await step(READ_POSTING_STEPS[2]);
    const matching = await matchRequirements(provider, { requirements: extraction.data.requirements, profile }, { ...options, signal });

    return {
      extracted: extraction.data,
      extractedWith: extraction.promptVersion,
      match: matching.data,
      matchedWith: matching.promptVersion,
    };
  },
});

export type ReadPostingResult = z.infer<typeof readPostingJob.result>;
