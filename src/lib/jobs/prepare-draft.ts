import "server-only";

import { z } from "zod";

import { createApplicationFromDocuments, detailsFrom } from "@/lib/application-create";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";

import { READ_POSTING_STEPS, WRITE_DOCUMENTS_STEPS } from "./application-steps";
import { readPostingJob } from "./read-posting";
import { defineJob } from "./runner";
import { writeDocumentsJob } from "./write-documents";

// Prepare draft, from New application (and Start application on Manual job
// search): the same as the job agent's drafts, in one go in the background.
// It reads the posting, writes the tailored resume and saves the Draft
// application; the cover letter is written when the draft is first opened.
// Leaving the page doesn't stop it: the draft shows up all the same.

/** Every named step it reports, in order, for the page that follows it. */
export const PREPARE_DRAFT_STEPS = [...READ_POSTING_STEPS, ...WRITE_DOCUMENTS_STEPS] as const;

export const prepareDraftJob = defineJob({
  type: "prepare-draft",
  input: z.object({
    posting: z.string().trim().min(1).max(100_000),
    /** A checked http(s) link, or "". */
    postingUrl: z.string().max(2000),
    /** The posting it's kept as in Manual job search's Saved for later; the application links to it. */
    postingId: z.string().nullish(),
    /** The startup it's written to, from Startups' "Write to them". */
    startupId: z.string().nullish(),
  }),
  result: z.object({ applicationId: z.string().min(1) }),
  async run({ posting, postingUrl, postingId = null, startupId = null }, context) {
    const reading = await readPostingJob.run({ posting, postingId }, context);
    const settings = await loadSettings();
    // The letter waits until the draft is opened, as the job agent's do.
    const documents = await writeDocumentsJob.run(
      { readJobId: context.id, posting, extracted: reading.extracted, match: reading.match, tone: settings.defaultTone, note: "", letter: false },
      context,
    );
    await context.step(WRITE_DOCUMENTS_STEPS[2]);
    const applicationId = await createApplicationFromDocuments({
      reading: { posting, ...reading },
      documents,
      match: reading.match,
      details: detailsFrom(reading.extracted),
      postingUrl,
      tone: settings.defaultTone,
      note: "",
      // This one job read and wrote it; claiming it makes a second run return the same application.
      claim: { kind: "manual", writeJobId: context.id, readJobId: context.id, postingId: postingId ?? null, startupId: startupId ?? null },
    });
    await prisma.job.updateMany({ where: { id: context.id }, data: { applicationId } });
    return { applicationId };
  },
});
