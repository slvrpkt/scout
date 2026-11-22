"use server";

import { z } from "zod";

import { randomUUID } from "node:crypto";

import { PostingSource } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { handOffPastedPosting } from "@/lib/connector/handoff";
import { prepareDraftJob } from "@/lib/jobs/prepare-draft";
import { startJob } from "@/lib/jobs/runner";
import { fetchPosting } from "@/lib/posting-fetch";
import { prisma } from "@/lib/prisma";

/**
 * "Prepare draft →": keeps the posting, then prepares the Draft application
 * from it in the background, as the job agent does (prepare-draft.ts). A
 * pasted or fetched posting goes in Manual job search's Saved for later at
 * once, so it's there to pick up later whatever happens next; preparing it
 * again updates the same one.
 */
export const startPreparingDraft = action(
  z.object({
    posting: z.string().trim().min(1, "Paste a job posting first.").max(100_000),
    postingUrl: z.string().trim().max(2000).optional(),
    /** The posting it's kept as, from Manual job search or an earlier try. */
    postingId: z.string().min(1).max(100).nullish(),
    /** Started from a startup ("Write to them"): no posting is kept for it. */
    startupId: z.string().min(1).max(100).nullish(),
  }),
  async ({ posting, postingUrl = "", postingId, startupId }) => {
    const url = postingLink(postingUrl);
    let kept: string | null = postingId ?? null;
    if (kept) {
      // A pasted one keeps the text and link as they are now.
      await prisma.posting.updateMany({ where: { id: kept, pasted: true, applicationId: null }, data: { description: posting, url, complete: true } });
    } else if (!startupId) {
      const created = await prisma.posting.create({
        data: { source: PostingSource.JSEARCH, externalId: `pasted:${randomUUID()}`, pasted: true, title: "Pasted posting", url, description: posting, complete: true, savedAt: new Date() },
        select: { id: true },
      });
      kept = created.id;
    }
    return { jobId: await startJob(prepareDraftJob, { posting, postingUrl: url, postingId: kept, startupId: startupId ?? null }), postingId: kept };
  },
);

/**
 * "Write it with Claude →" (#221, the connector on and no AI model of
 * Scout's own): keeps the posting for the connector to read and gives the
 * claude.ai chat to open, where Claude writes the application on the user's
 * own Claude plan.
 */
export const handOffToClaude = action(
  z.object({
    posting: z.string().trim().min(1, "Paste a job posting first.").max(100_000),
    postingUrl: z.string().trim().max(2000),
  }),
  async ({ posting, postingUrl }) => ({ url: await handOffPastedPosting({ text: posting, url: /^https?:\/\//i.test(postingUrl) ? postingUrl : "" }) }),
);

/**
 * "Fetch" (E7-8, NEW-9): the posting's text from its link, for the user to
 * check before the draft is prepared. The request goes to the job site from the server.
 */
export const fetchPostingText = action(z.object({ link: z.string().max(2000) }), async ({ link }) => {
  const url = postingLink(link);
  if (!url) throw new ActionError("Enter the link to the posting first.");
  const fetched = await fetchPosting(url);
  if (!fetched.ok) throw new ActionError(fetched.error);
  return { text: fetched.text, url: fetched.url };
});

/** A link as typed, with https:// added when it has no scheme; empty stays empty. */
function postingLink(value: string): string {
  const link = value.trim();
  if (!link) return "";
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(link) ? link : `https://${link}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    // Not a link.
  }
  throw new ActionError("The link to the posting doesn't look like a web address. Fix it or leave it empty.");
}
