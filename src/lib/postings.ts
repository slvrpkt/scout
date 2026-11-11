import "server-only";

import { Prisma, type Posting } from "@/generated/prisma/client";
import { linkKey, postingKey, type FoundPosting, type JobSource, type PostingState, type ShownPosting } from "@/lib/job-search/search";
import { applyLinksOf, stringsOf } from "@/lib/agent/candidates";
import { findDuplicate, loadDuplicateLog } from "@/lib/duplicates";
import { prisma } from "@/lib/prisma";
import { withoutStaleBonus } from "@/lib/freshness";
import { breakdownOf } from "@/lib/scoring/rubric";
import { loadSettings } from "@/lib/settings-data";

// Postings kept from Find jobs (E14-5): saved, dismissed, or started an
// application from. Nothing else from a search is stored, and a posting
// left with no reason to be kept is removed.

export type { PostingState };

type PostingRef = { source: JobSource; externalId: string };

const whereRef = ({ source, externalId }: PostingRef) => ({ source_externalId: { source, externalId } });

function fieldsOf(found: FoundPosting) {
  return {
    title: found.title,
    company: found.company,
    place: found.place,
    remote: found.remote,
    salary: found.salary,
    postedAt: found.postedAt ? new Date(found.postedAt) : null,
    url: found.url,
    via: found.via,
    description: found.description,
    complete: found.complete,
    applyLinks: found.applyLinks?.length ? found.applyLinks : Prisma.DbNull,
  };
}

/** A stored posting in the shape search results have. */
export function foundFromPosting(posting: Posting): FoundPosting {
  return {
    source: posting.source,
    ...(posting.pasted ? { pasted: true } : {}),
    externalId: posting.externalId,
    title: posting.title,
    company: posting.company,
    place: posting.place,
    remote: posting.remote,
    salary: posting.salary,
    postedAt: posting.postedAt?.toISOString() ?? null,
    url: posting.url,
    via: posting.via,
    description: posting.description,
    complete: posting.complete,
    // Only when there are some, so a posting without them reads back as it was.
    ...(applyLinksOf(posting.applyLinks).length ? { applyLinks: applyLinksOf(posting.applyLinks) } : {}),
  };
}

/**
 * Stores a posting, or refreshes it from a newer search, with `marks`. A
 * whole description isn't replaced by a snippet; saved and dismissed dates
 * only change when `marks` says so.
 */
export async function storePosting(found: FoundPosting, marks: { savedAt?: Date | null; dismissedAt?: Date | null } = {}): Promise<Posting> {
  return prisma.$transaction(async (tx) => {
    const where = whereRef(found);
    const existing = await tx.posting.findUnique({ where, select: { complete: true } });
    const { description, complete, ...rest } = fieldsOf(found);
    const text = existing?.complete && !complete ? {} : { description, complete };
    return tx.posting.upsert({
      where,
      create: { source: found.source, externalId: found.externalId, ...rest, description, complete, ...marks },
      update: { ...rest, ...text, ...marks },
    });
  });
}

/** Save: into the Saved list, and out of Dismissed. */
export const savePosting = (found: FoundPosting) => storePosting(found, { savedAt: new Date(), dismissedAt: null });

/** Dismiss: out of later searches, and out of Saved. Says whether it was saved, for Undo. */
export async function dismissPosting(found: FoundPosting): Promise<{ wasSaved: boolean }> {
  const before = await prisma.posting.findUnique({ where: whereRef(found), select: { savedAt: true } });
  await storePosting(found, { dismissedAt: new Date(), savedAt: null });
  return { wasSaved: Boolean(before?.savedAt) };
}

/**
 * Takes a posting out of Saved, or back from Dismissed (`saved` puts it back
 * in Saved too, to undo a Dismiss). One left with no reason to be kept goes.
 */
export async function unmarkPosting(ref: PostingRef, mark: "saved" | "dismissed", { saved = false }: { saved?: boolean } = {}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const where = whereRef(ref);
    if (!(await tx.posting.findUnique({ where, select: { id: true } }))) return;
    const posting = await tx.posting.update({
      where,
      data: mark === "saved" ? { savedAt: null } : { dismissedAt: null, ...(saved ? { savedAt: new Date() } : {}) },
    });
    if (!posting.savedAt && !posting.dismissedAt && !posting.applicationId) await tx.posting.delete({ where });
  });
}

/** The Saved or Dismissed view (E14-7): newest first, with where each stands. */
export async function listPostings(view: "saved" | "dismissed"): Promise<ShownPosting[]> {
  const rows = await prisma.posting.findMany({
    where: view === "saved" ? { savedAt: { not: null } } : { dismissedAt: { not: null } },
    orderBy: view === "saved" ? { savedAt: "desc" } : { dismissedAt: "desc" },
  });
  const states = await postingStates(rows.map(foundFromPosting));
  return rows.map((row) => {
    const found = foundFromPosting(row);
    return { ...found, state: states.get(postingKey(found))! };
  });
}

/** How many postings are saved and dismissed, for the views' tabs. */
export async function countPostings(): Promise<{ saved: number; dismissed: number }> {
  const [saved, dismissed] = await Promise.all([
    prisma.posting.count({ where: { savedAt: { not: null } } }),
    prisma.posting.count({ where: { dismissedAt: { not: null } } }),
  ]);
  return { saved, dismissed };
}

/**
 * Where each of a page of results stands, by postingKey(). Applied also
 * counts applications made from the same link before Find jobs, ignoring
 * tracking parameters.
 */
export async function postingStates(
  found: readonly (PostingRef & { url: string } & Partial<Pick<FoundPosting, "title" | "company" | "place" | "postedAt">>)[],
): Promise<Map<string, PostingState>> {
  if (found.length === 0) return new Map();
  const refs = found.map(({ source, externalId }) => ({ source, externalId }));
  const [stored, applications, scores] = await Promise.all([
    prisma.posting.findMany({
      where: { OR: found.map(({ source, externalId }) => ({ source, externalId })) },
      select: { id: true, source: true, externalId: true, savedAt: true, dismissedAt: true, applicationId: true },
    }),
    // The Job application log; an agent draft waiting for review isn't applied for yet (#195).
    loadDuplicateLog(),
    prisma.postingScore.findMany({ where: { OR: refs } }),
  ]);
  // A score's fresh bonus comes off once the posting is past your fresh window.
  const [hours, now] = [(await loadSettings()).scoringPrefs.fresh.hours, new Date()];
  const postedAt = new Map(found.map((posting) => [postingKey(posting), posting.postedAt ?? null]));
  const scoreOf = new Map(
    scores.map((row) => [
      postingKey(row),
      { ...withoutStaleBonus({ score: row.score, reasons: stringsOf(row.reasons) }, postedAt.get(postingKey(row)), now, hours), redFlags: stringsOf(row.redFlags), breakdown: breakdownOf(row.breakdown) },
    ]),
  );
  const byKey = new Map(stored.map((posting) => [postingKey(posting), posting]));
  const byLink = new Map<string, string>();
  // Oldest first, so the first application from a link is the one it opens.
  for (const application of applications.toReversed()) {
    const key = linkKey(application.url ?? "");
    if (key && !byLink.has(key)) byLink.set(key, application.id);
  }
  return new Map(
    found.map((posting) => {
      const row = byKey.get(postingKey(posting));
      const link = linkKey(posting.url);
      return [
        postingKey(posting),
        {
          postingId: row?.id ?? null,
          saved: Boolean(row?.savedAt),
          dismissed: Boolean(row?.dismissedAt),
          applicationId: row?.applicationId ?? ((link && byLink.get(link)) || null),
          score: scoreOf.get(postingKey(posting)) ?? null,
          // The one made from it is no duplicate.
          duplicate: row?.applicationId ? null : findDuplicate({ url: posting.url, company: posting.company, role: posting.title, place: posting.place, postedAt: posting.postedAt }, applications),
        },
      ];
    }),
  );
}
