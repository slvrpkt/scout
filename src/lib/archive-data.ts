import "server-only";

import { AgentCandidateStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { payIn } from "@/lib/scoring/preferences";

import { archiveReasonOf, type ArchiveReason } from "./agent/archive-reasons";
import { stringsOf } from "./agent/candidates";

// The Archive: everything set aside in one table. Postings the agent found
// that never became a draft (skipped by your settings, or archived by you),
// and applications you archived.

export type ArchiveKind = "posting" | "application";

export type ArchiveRow = {
  kind: ArchiveKind;
  id: string;
  /** When it was archived (ISO). */
  archivedAt: string;
  title: string;
  company: string;
  location: string;
  /** As written, e.g. "USD 120,000–150,000 a year"; empty when unknown. */
  salary: string;
  /** The top of the yearly pay, for sorting and "at least"; null when unknown. */
  pay: number | null;
  /** Its score; null when it was set aside before the AI scored it. */
  score: number | null;
  why: ArchiveReason;
  /** The first note it was archived with, e.g. "Skipped by its title: “director”". */
  note: string;
  /** The saved search that found it, while it exists. */
  foundBy: string | null;
  /** Where to read it: the posting on its site, or the application in Scout. */
  href: string;
};

/** The most rows the Archive loads, newest first. */
export const ARCHIVE_LIMIT = 5000;

/** Reasons a posting was set aside before the AI: its 0 or best-possible isn't a real score. */
const NOT_SCORED: ArchiveReason[] = ["title", "word", "distance", "minimum"];

export async function loadArchive(): Promise<ArchiveRow[]> {
  const [postings, applications] = await Promise.all([
    prisma.agentCandidate.findMany({
      where: { status: AgentCandidateStatus.DISMISSED, applicationId: null },
      orderBy: { updatedAt: "desc" },
      take: ARCHIVE_LIMIT,
      select: { id: true, title: true, company: true, place: true, remote: true, salary: true, score: true, redFlags: true, url: true, updatedAt: true, search: { select: { name: true } } },
    }),
    prisma.application.findMany({
      where: { archivedAt: { not: null }, awaitingReview: false },
      orderBy: { archivedAt: "desc" },
      take: ARCHIVE_LIMIT,
      select: { id: true, title: true, role: true, company: true, location: true, mode: true, salary: true, agentScore: true, archivedAt: true },
    }),
  ]);
  const rows: ArchiveRow[] = [
    ...postings.map((posting): ArchiveRow => {
      const flags = stringsOf(posting.redFlags);
      const why = archiveReasonOf(flags);
      return {
        kind: "posting",
        id: posting.id,
        archivedAt: posting.updatedAt.toISOString(),
        title: posting.title.trim() || "Untitled posting",
        company: posting.company.trim(),
        location: [posting.place.trim(), posting.remote ? "Remote" : ""].filter(Boolean).join(" · "),
        salary: posting.salary.trim(),
        pay: payIn(posting.salary)?.high ?? null,
        score: NOT_SCORED.includes(why) ? null : posting.score,
        why,
        note: why === "you" ? "" : (flags[0] ?? ""),
        foundBy: posting.search?.name ?? null,
        href: posting.url,
      };
    }),
    ...applications.map(
      (application): ArchiveRow => ({
        kind: "application",
        id: application.id,
        archivedAt: (application.archivedAt ?? new Date()).toISOString(),
        title: application.role.trim() || application.title.trim() || "Untitled application",
        company: application.company.trim(),
        location: [application.location.trim(), application.mode.trim()].filter(Boolean).join(" · "),
        salary: application.salary.trim(),
        pay: payIn(application.salary)?.high ?? null,
        score: application.agentScore,
        why: "you",
        note: "",
        foundBy: null,
        href: `/applications/${application.id}`,
      }),
    ),
  ];
  return rows.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}
