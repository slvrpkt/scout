import "server-only";

import { z } from "zod";

import { ApplicationStatus, DocumentKind } from "@/generated/prisma/enums";
import { isAiUsable } from "@/lib/ai/config";
import { logServerError } from "@/lib/log";
import { fitResumeToPages, rewriteResume } from "@/lib/page-limit";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { maxPages } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";

import { cancelJob, defineJob, findUnfinishedJobs, startJob } from "./runner";

// After your resume template or profile changes: every application that hasn't been sent
// is rewritten for the new layout, one AI request each, then fitted to the
// page limit and, with Optimize for ATS on, rewritten toward an A (ats-rewrite.ts). Sent ones stay exactly as they went out (sent-documents.ts).

export const REDO_DRAFTS_KEY = "redo-drafts";

/** After a profile change, only drafts from this many weekdays are rewritten by themselves; older ones get a button. */
export const REDO_WEEKDAYS = 2;

/**
 * The start of the earliest of the last `weekdays` weekdays, today included
 * when it is one: weekends don't count. On a Monday, 2 is Friday and Monday;
 * on a Sunday, Thursday and Friday.
 */
export function weekdaysBack(now: Date, weekdays: number): Date {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let counted = 0;
  for (;;) {
    const weekday = day.getDay();
    if (weekday !== 0 && weekday !== 6) counted += 1;
    if (counted >= weekdays) return day;
    day.setDate(day.getDate() - 1);
  }
}

/** The unsent applications with a resume, from the last REDO_WEEKDAYS weekdays. */
const unsentDrafts = () =>
  prisma.application.findMany({
    where: { status: ApplicationStatus.DRAFT, archivedAt: null, createdAt: { gte: weekdaysBack(new Date(), REDO_WEEKDAYS) }, documents: { some: { kind: DocumentKind.RESUME } } },
    select: { id: true, company: true, title: true },
    orderBy: { createdAt: "asc" },
  });

export const redoDraftsJob = defineJob({
  type: "redo-drafts",
  input: z.object({}),
  result: z.object({ redone: z.number().int(), failed: z.number().int() }),
  async run(_input, { step, signal }) {
    const [drafts, profile, settings] = await Promise.all([unsentDrafts(), loadProfile(), loadSettings()]);
    const limit = maxPages(settings.pageLimit);
    let redone = 0;
    let failed = 0;
    for (const [index, draft] of drafts.entries()) {
      if (signal.aborted) break;
      await step(`Rewriting ${draft.company.trim() || draft.title.trim() || "a draft"} (${index + 1} of ${drafts.length})`);
      try {
        const reason = await rewriteResume(draft.id, profile, { maxPages: limit, detail: "the resume for your latest changes", before: "As it was before your template changed", signal });
        const ask = limit ? (await fitResumeToPages(draft.id, profile, limit, undefined, undefined, "ask")).ask : false;
        await prisma.application.update({ where: { id: draft.id }, data: { resumePagesAsk: Boolean(ask || reason), resumePagesReason: reason, resumePageLimit: null } });
        // Then checked against the job and rewritten toward an ATS A, as a new draft is.
        if (settings.atsOptimize) {
          await step(`Checking ${draft.company.trim() || draft.title.trim() || "a draft"} against the job (${index + 1} of ${drafts.length})`);
          const { rewriteToGrade } = await import("@/lib/ats-rewrite");
          await rewriteToGrade(draft.id);
        }
        redone += 1;
      } catch (error) {
        if (signal.aborted) break;
        failed += 1;
        logServerError("rewriting a draft for the template", error);
      }
    }
    return { redone, failed };
  },
});

/** Starts over with the template as it is now; how many drafts will be rewritten. */
export async function queueDraftRedo(): Promise<number> {
  for (const job of await findUnfinishedJobs(REDO_DRAFTS_KEY)) await cancelJob(job.id);
  if (!(await isAiUsable())) return 0;
  const drafts = await unsentDrafts();
  if (drafts.length === 0) return 0;
  await startJob(redoDraftsJob, {}, { key: REDO_DRAFTS_KEY });
  return drafts.length;
}
