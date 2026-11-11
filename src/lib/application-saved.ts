import "server-only";

import { PostingSource } from "@/generated/prisma/enums";
import { foundFromCandidate } from "@/lib/agent/draft";
import { prisma } from "@/lib/prisma";
import { storePosting, unmarkPosting } from "@/lib/postings";

// Save for later from an application's own page: the same Saved for later as
// on the job cards, for the job the application was made from, whether the
// job agent found it, Manual job search did, or it was pasted in by hand.

/** Whether the application's job is on Saved for later. */
export async function applicationSaved(applicationId: string): Promise<boolean> {
  const candidate = await prisma.agentCandidate.findUnique({ where: { applicationId }, select: { source: true, externalId: true } });
  const posting = candidate
    ? await prisma.posting.findUnique({ where: { source_externalId: candidate }, select: { savedAt: true } })
    : await prisma.posting.findUnique({ where: { applicationId }, select: { savedAt: true } });
  return Boolean(posting?.savedAt);
}

/** Puts the application's job on Saved for later, or takes it off; false when the application is gone. */
export async function saveApplicationJob(applicationId: string, saved: boolean): Promise<boolean> {
  const candidate = await prisma.agentCandidate.findUnique({ where: { applicationId } });
  if (candidate) {
    if (saved) await storePosting(foundFromCandidate(candidate), { savedAt: new Date(), dismissedAt: null });
    else await unmarkPosting({ source: candidate.source, externalId: candidate.externalId }, "saved");
    return true;
  }
  const marks = saved ? { savedAt: new Date(), dismissedAt: null } : { savedAt: null };
  const posting = await prisma.posting.findUnique({ where: { applicationId }, select: { id: true } });
  if (posting) {
    // It stays stored either way: the application was made from it.
    await prisma.posting.update({ where: { id: posting.id }, data: marks });
    return true;
  }
  // Pasted in by hand before pasted jobs were kept: kept now, as New application keeps them.
  const application = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!application) return false;
  if (!saved) return true;
  await prisma.posting.create({
    data: {
      source: PostingSource.JSEARCH,
      externalId: `pasted:${application.id}`,
      pasted: true,
      title: application.role || application.title,
      company: application.company,
      place: application.location,
      salary: application.salary,
      url: /^https?:\/\//i.test(application.postingUrl) ? application.postingUrl : "",
      description: application.postingText,
      complete: true,
      applicationId: application.id,
      ...marks,
    },
  });
  return true;
}
