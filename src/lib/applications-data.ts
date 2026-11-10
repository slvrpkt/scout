import "server-only";

import { ApplicationOrigin, DocumentKind, type ApplicationStatus, type EmployerType, type NoteKind } from "@/generated/prisma/enums";
import { matchSchema, matchScore } from "@/lib/application-data";
import { resolveListParams, sortRows, statusesIn, updatedAgo, type Sort } from "@/lib/applications-list";
import { guessAppliedVia } from "@/lib/applied-via";
import { formatCalendarDate, formatDate, formatShortDate } from "@/lib/dates";
import { employerLabel, guessEmployerType } from "@/lib/employer-type";
import { prisma } from "@/lib/prisma";

/** An application as the board and the table show it (E9-2, E9-3). */
export type ApplicationRow = {
  id: string;
  company: string;
  /** The role, or the title when there's no role. */
  role: string;
  location: string;
  mode: string;
  status: ApplicationStatus;
  archived: boolean;
  /** Put back from the Archive once: shown with a "Was archived" label. */
  wasArchived?: boolean;
  /** "Apply by", e.g. "3 Oct 2026"; null without a deadline. */
  deadline: string | null;
  /**
   * When the job was posted, e.g. "28 Oct", from the posting it came from
   * (Manual job search, the agent, Startups); null when that isn't known.
   */
  posted: string | null;
  /** When the application was made, e.g. "28 Oct". */
  created: string;
  match: { hit: number; total: number } | null;
  /** When it was sent, e.g. "18 Aug"; null while never sent. */
  sent: string | null;
  /** "Today", "3 days ago"… */
  updated: string;
  /** For the board, which shows the latest update first. */
  updatedAt: number;
  /**
   * The resume as a PDF, for the list's download: the copy that went out
   * with the latest send, else the tailored resume as it is now; null
   * without one.
   */
  resume: { href: string; sent: boolean } | null;
  /**
   * The Government or Startup label (none for a private company): what the
   * user chose, else Scout's guess (`auto`). `chosen` is null while it's the guess.
   */
  employer: { type: EmployerType | null; chosen: EmployerType | null; auto: boolean };
  /** Started by hand (New Application, Manual job search), not by the job agent. */
  manual: boolean;
  /** The latest event added on the Activity tab or with Add Event, for the table's Activity column; null without one. */
  latestEvent: { kind: NoteKind; body: string } | null;
  /** Applied Using: the platform the user chose, else Scout's guess (`auto`); null value with nothing to go on. */
  appliedVia: { value: string | null; auto: boolean };
  /** The salary as the posting gives it, usually a range; "" when it doesn't say. */
  salary: string;
  /** The original job listing, to open from the log; "" without a web link. */
  postingUrl: string;
  /** Things To Note: the user's lasting notes about the role. */
  thingsToNote: string;
  /** Whether a job description was saved, for its download. */
  hasPosting: boolean;
  /** The files in Google Drive, for the Google Sheet: what was applied with and the job description; null until saved there. */
  driveLinks: { documents: string | null; posting: string | null };
};

const driveFile = (id: string | null | undefined) => (id ? `https://drive.google.com/file/d/${encodeURIComponent(id)}/view` : null);

/** Every application, archived ones only when asked for, sorted for the table; agent drafts once approved (#195). */
export async function loadApplicationRows(
  { archived, sort, fullDates = false }: { archived: boolean; sort: Sort; /** Every date with its year, Updated too: for the Google Sheet, which is read later. */ fullDates?: boolean },
  now = new Date(),
) {
  const applications = await prisma.application.findMany({
    where: { awaitingReview: false, ...(archived ? {} : { archivedAt: null }) },
    select: {
      id: true,
      origin: true,
      appliedVia: true,
      thingsToNote: true,
      drivePostingFileId: true,
      title: true,
      salary: true,
      company: true,
      role: true,
      location: true,
      mode: true,
      status: true,
      employerType: true,
      postingUrl: true,
      postingText: true,
      archivedAt: true,
      restoredAt: true,
      deadline: true,
      match: true,
      sentAt: true,
      createdAt: true,
      updatedAt: true,
      posting: { select: { postedAt: true, via: true, description: true, salary: true, url: true } },
      agentCandidate: { select: { postedAt: true, via: true, salary: true, url: true } },
      startup: { select: { postedAt: true } },
      documents: { where: { kind: DocumentKind.RESUME }, select: { id: true } },
      sentDocuments: { where: { kind: DocumentKind.RESUME }, orderBy: { sentAt: "desc" }, take: 1, select: { id: true, driveFileId: true } },
      notes: { orderBy: [{ at: "desc" }, { createdAt: "desc" }], take: 1, select: { kind: true, body: true } },
    },
  });
  const rows = applications.map((application) => {
    const match = matchSchema.safeParse(application.match);
    return {
      id: application.id,
      company: application.company.trim(),
      role: application.role.trim() || application.title.trim() || "Untitled application",
      location: application.location.trim(),
      mode: application.mode.trim(),
      status: application.status,
      archived: application.archivedAt !== null,
      wasArchived: application.archivedAt === null && application.restoredAt !== null,
      deadline: application.deadline ? formatCalendarDate(application.deadline) : null,
      match: match.success && match.data.items.length > 0 ? matchScore(match.data) : null,
      sentAt: application.sentAt,
      updatedAt: application.updatedAt,
      postedAt: application.posting?.postedAt ?? application.agentCandidate?.postedAt ?? application.startup?.postedAt ?? null,
      createdAt: application.createdAt,
      employer: {
        ...employerLabel(
          application.employerType,
          guessEmployerType({ company: application.company, postingUrl: application.postingUrl, postingText: application.postingText, fromStartups: application.startup !== null }),
        ),
        chosen: application.employerType,
      },
      manual: application.origin === ApplicationOrigin.MANUAL,
      latestEvent: application.notes[0] ?? null,
      appliedVia: application.appliedVia
        ? { value: application.appliedVia, auto: false }
        : { value: guessAppliedVia({ via: application.posting?.via || application.agentCandidate?.via, postingUrl: application.postingUrl }), auto: true },
      thingsToNote: application.thingsToNote,
      salary: application.salary.trim() || application.posting?.salary.trim() || application.agentCandidate?.salary.trim() || "",
      // Only web links: an imported file could carry any URL (E11-5).
      postingUrl: [application.postingUrl, application.posting?.url ?? "", application.agentCandidate?.url ?? ""].find((url) => /^https?:\/\//i.test(url)) ?? "",
      hasPosting: Boolean(application.postingText.trim() || application.posting?.description.trim()),
      driveLinks: { documents: driveFile(application.sentDocuments[0]?.driveFileId), posting: driveFile(application.drivePostingFileId) },
      // What was applied with, as one file in the format it went out in; the tailored documents before that.
      resume:
        application.sentDocuments.length > 0 || application.documents.length > 0
          ? { href: `/api/application-files?application=${application.id}&file=documents`, sent: application.sentDocuments.length > 0 }
          : null,
    };
  });
  return sortRows(rows, sort).map(({ sentAt, updatedAt, postedAt, createdAt, ...row }): ApplicationRow => ({
    ...row,
    posted: postedAt ? (fullDates ? formatDate(postedAt) : formatShortDate(postedAt, now)) : null,
    created: fullDates ? formatDate(createdAt) : formatShortDate(createdAt, now),
    sent: sentAt ? (fullDates ? formatDate(sentAt) : formatShortDate(sentAt, now)) : null,
    updated: fullDates ? formatDate(updatedAt) : updatedAgo(updatedAt, now),
    updatedAt: updatedAt.getTime(),
  }));
}

/** An application's place in the Job application log, for Previous and Next on its page. */
export type LogNeighbours = { previous: string | null; next: string | null; position: number; total: number };

/**
 * Where an application sits in the Job application log as last left: the
 * same filter and sort, archived ones only if it's archived itself. Null for
 * one the log doesn't show, such as an agent draft waiting for review.
 */
export async function logNeighbours(id: string, remembered: { applicationsView: string; applicationsFilter: string; applicationsSort: string }): Promise<LogNeighbours | null> {
  const params = resolveListParams({}, remembered);
  const archived = (await prisma.application.findUnique({ where: { id }, select: { archivedAt: true } }))?.archivedAt != null;
  const statuses = statusesIn(params.filter);
  const ids = (await loadApplicationRows({ archived, sort: params.sort })).filter((row) => statuses.includes(row.status) || row.id === id).map((row) => row.id);
  const index = ids.indexOf(id);
  if (index < 0) return null;
  return { previous: ids[index - 1] ?? null, next: ids[index + 1] ?? null, position: index + 1, total: ids.length };
}
