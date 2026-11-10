import { linkKey } from "@/lib/job-search/search";
import { prisma } from "@/lib/prisma";

// Duplicates (#43): a posting checked against the Job application log, on
// Agentic and Manual job search and when starting an application by hand.
// "Duplicate" is the same job: the same posting link, or the same company,
// role and place with no date that says otherwise. "Potential duplicate" is
// the same company with the same or a similar role, but something differs
// (place, posted date or apply-by date), so it may be a new opening.

/** What a posting has to go on. Dates are Dates or ISO strings; any field may be missing. */
export type PostingFacts = {
  url?: string | null;
  company?: string | null;
  role?: string | null;
  place?: string | null;
  postedAt?: Date | string | null;
  deadline?: Date | string | null;
};

/** An application in the log, as the check reads it. */
export type LogEntry = PostingFacts & { id: string; label: string };

export type DuplicateMatch = {
  kind: "duplicate" | "potential";
  applicationId: string;
  /** "Acme – Product Designer". */
  label: string;
  /** Why, in words: "Same posting link", "Same company and a similar role, but a different location". */
  why: string;
};

/** Lower case, letters and digits only, accents dropped. */
const normal = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const LEGAL = new Set(["inc", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "gmbh", "ag", "plc", "bv", "sa", "srl", "pty", "the", "group"]);
const FILLER = new Set(["and", "of", "the", "for", "a", "an", "in", "at", "m", "f", "d", "w", "x"]);

/** "Acme, Inc." and "ACME" are the same company. */
export const companyKey = (company: string | null | undefined) =>
  normal(company)
    .split(" ")
    .filter((word) => word && !LEGAL.has(word))
    .join(" ");

const roleWords = (role: string | null | undefined) => new Set(normal(role).split(" ").filter((word) => word && !FILLER.has(word)));

/** Same words, or one role's words all in the other's ("Designer" and "Senior Designer"), or most of them shared. */
function roleLikeness(a: string | null | undefined, b: string | null | undefined): "same" | "similar" | null {
  const one = roleWords(a);
  const two = roleWords(b);
  if (one.size === 0 || two.size === 0) return null;
  const shared = [...one].filter((word) => two.has(word)).length;
  if (shared === one.size && shared === two.size) return "same";
  if (shared === Math.min(one.size, two.size) || shared / (one.size + two.size - shared) >= 0.5) return "similar";
  return null;
}

/** The city, the part before the first comma; "Remote" alone says nothing about the place. */
const city = (place: string | null | undefined) => {
  const first = normal((place ?? "").split(",")[0]);
  return first === "remote" || first === "anywhere" ? "" : first;
};

const day = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const sameDay = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
/** Posted dates further apart than this are a different opening, as far as the log can tell. */
const REPOST_DAYS = 14;

/** How a posting matches one application in the log, or null when it doesn't. */
export function matchOne(posting: PostingFacts, entry: LogEntry): DuplicateMatch | null {
  const base = { applicationId: entry.id, label: entry.label };
  const link = linkKey(posting.url ?? "");
  if (link && link === linkKey(entry.url ?? "")) return { ...base, kind: "duplicate", why: "Same posting link" };

  const company = companyKey(posting.company);
  if (!company || company !== companyKey(entry.company)) return null;
  const role = roleLikeness(posting.role, entry.role);
  if (!role) return null;

  const here = city(posting.place);
  const there = city(entry.place);
  const differences: string[] = [];
  if (here && there && here !== there && !here.includes(there) && !there.includes(here)) differences.push("a different location");
  const [posted, loggedPosted] = [day(posting.postedAt), day(entry.postedAt)];
  if (posted && loggedPosted && Math.abs(posted.getTime() - loggedPosted.getTime()) > REPOST_DAYS * 86_400_000) differences.push("a different posted date");
  const [deadline, loggedDeadline] = [day(posting.deadline), day(entry.deadline)];
  if (deadline && loggedDeadline && !sameDay(deadline, loggedDeadline)) differences.push("a different apply-by date");

  if (role === "same" && differences.length === 0) {
    return { ...base, kind: "duplicate", why: here && there ? "Same company, role and location" : "Same company and role" };
  }
  const what = role === "same" ? "Same company and role" : "Same company and a similar role";
  return { ...base, kind: "potential", why: differences.length ? `${what}, but ${differences.join(" and ")}` : what };
}

/** The best match in the log: a duplicate over a potential one, else the first (newest) found. */
export function findDuplicate(posting: PostingFacts, log: readonly LogEntry[], { exclude = [] }: { exclude?: readonly (string | null | undefined)[] } = {}): DuplicateMatch | null {
  let potential: DuplicateMatch | null = null;
  for (const entry of log) {
    if (exclude.includes(entry.id)) continue;
    const match = matchOne(posting, entry);
    if (match?.kind === "duplicate") return match;
    potential ??= match;
  }
  return potential;
}

/** The Job application log, newest first: every application except agent drafts not approved yet (#195), archived ones included. */
export async function loadDuplicateLog(): Promise<LogEntry[]> {
  const rows = await prisma.application.findMany({
    where: { awaitingReview: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      company: true,
      role: true,
      title: true,
      location: true,
      postingUrl: true,
      deadline: true,
      posting: { select: { postedAt: true } },
      agentCandidate: { select: { postedAt: true } },
      startup: { select: { postedAt: true } },
    },
  });
  return rows.map((row) => {
    const role = row.role.trim() || row.title.trim();
    return {
      id: row.id,
      label: [row.company.trim(), role].filter(Boolean).join(" – ") || "Untitled application",
      url: row.postingUrl,
      company: row.company,
      role,
      place: row.location,
      postedAt: row.posting?.postedAt ?? row.agentCandidate?.postedAt ?? row.startup?.postedAt ?? null,
      deadline: row.deadline,
    };
  });
}
