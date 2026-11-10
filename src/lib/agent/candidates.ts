import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import type { PostingFit } from "@/lib/fit";
import { linkKey, type FoundPosting } from "@/lib/job-search/search";

// The job agent's candidates (E16): postings it found and scored. An archived
// one stays, whole, so the posting never comes back and can be put back.

/** Lower case, letters and digits only, accents dropped: "Café  GmbH" and "cafe gmbh" are the same. */
const normal = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * The dedupe key: a hash of the link without tracking parameters, else of
 * company, title and place, so the same job found through another source or
 * in a later run matches. A posting with none of those falls back to its
 * source's id.
 */
export function agentDedupeKey(posting: Pick<FoundPosting, "source" | "externalId" | "url" | "title" | "company" | "place">): string {
  const link = linkKey(posting.url);
  const facts = [posting.company, posting.title, posting.place].map(normal);
  const basis = link ? `link:${link}` : facts.some(Boolean) ? `job:${facts.join("|")}` : `id:${posting.source}:${posting.externalId}`;
  return createHash("sha256").update(basis).digest("hex");
}

/** Country names say nothing about which opening it is, and sources add them or don't. */
const placeOf = (place: string) => normal(place).replace(/\b(united states( of america)?|usa|us)\b/g, "").replace(/\s+/g, " ").trim();

/**
 * The job itself, whichever board or link it came from: company, title and
 * place. The same title in another place is another opening.
 */
export function jobKey(posting: Pick<FoundPosting, "title" | "company" | "place">): string {
  return createHash("sha256").update(`job:${[normal(posting.company), normal(posting.title), placeOf(posting.place)].join("|")}`).digest("hex");
}

/** Whether a title holds one of `words`, as a whole word. */
export function titleRuledOut(title: string, words: readonly string[]): boolean {
  return titleSkipWord(title, words) !== null;
}

/** The first of your "Job titles to skip" words the title has, as whole words, or null. */
export function titleSkipWord(title: string, words: readonly string[]): string | null {
  const text = ` ${title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  return words.find((word) => text.includes(` ${word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `)) ?? null;
}

/** A posting skipped by its title, for Archived: never scored, saying which word caught it, so the list can be checked. */
export function titleSkipFit(word: string) {
  return { score: 0, reasons: [`Not scored: “${word}” is on your Job titles to skip (Settings → Job agent).`], redFlags: [`Skipped by its title: “${word}”`] };
}

const BOARDS = /(^|\.)(linkedin|indeed|glassdoor|ziprecruiter|monster|simplyhired|talent|jooble|adzuna|google)\./i;

/** Whether a link is the employer's own rather than a job board's. */
export function isEmployerLink(url: string): boolean {
  try {
    return !BOARDS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** A posting as a new candidate, with its score. */
export function candidateData(posting: FoundPosting, score: PostingFit): Prisma.AgentCandidateCreateInput {
  return {
    source: posting.source,
    externalId: posting.externalId,
    title: posting.title,
    company: posting.company,
    place: posting.place,
    remote: posting.remote,
    salary: posting.salary,
    postedAt: posting.postedAt ? new Date(posting.postedAt) : null,
    url: posting.url,
    via: posting.via,
    description: posting.description,
    complete: posting.complete,
    score: score.score,
    reasons: score.reasons,
    redFlags: score.redFlags,
    breakdown: score.breakdown ?? Prisma.DbNull,
    dedupeKey: agentDedupeKey(posting),
    jobKey: jobKey(posting),
  };
}
/** A JSON list of strings, as reasons and red flags are stored; anything else reads as none. */
export function stringsOf(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
