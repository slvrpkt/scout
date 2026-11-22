import "server-only";

import type { AIProvider } from "@/lib/ai/provider";
import { companyWords } from "@/lib/job-search/company";
import { boardJobs, findBoards, readJobPage, type BoardJob } from "@/lib/job-search/employer-jobs";
import type { FoundPosting } from "@/lib/job-search/search";

import { isEmployerLink } from "./candidates";

// Find it on the company's site: a posting a job board relayed, found where
// the employer published it, for its full text and the page to apply on.
// Cheapest first: the employer's link the source gave, then the company's
// own job board (free), then a web search (paid, about a cent a search).
// Only a job whose title and company match is taken; otherwise nothing.

/** What it's looking for. */
export type SourceQuery = {
  title: string;
  company: string;
  place: string;
  /** The company's website, when the source said. */
  employerSite: string;
  applyLinks: NonNullable<FoundPosting["applyLinks"]>;
};

/** Where it was found: the page to apply on, its text, and which way found it. */
export type SourceHit = { url: string; description: string; via: "link" | "board" | "search" };

/** The least text taken as a posting. */
const MIN_TEXT = 300;

/** Boards that only relay postings: never the employer's own page, so never searched. */
export const RELAY_SITES = [
  "linkedin.com", "indeed.com", "glassdoor.com", "ziprecruiter.com", "monster.com", "simplyhired.com", "talent.com", "jooble.org",
  "theladders.com", "learn4good.com", "jobgether.com", "jobleads.com", "womenforhire.com", "jobmesh.io", "trabajo.org", "snagajob.com",
  "recruit.net", "jobrapido.com", "careerbuilder.com", "dice.com", "builtin.com", "adzuna.com", "upwork.com", "clearancejobs.com", "lensa.com",
];

// Words that don't tell two job titles apart, and the short forms written either way.
const TITLE_NOISE = new Set(["a", "an", "and", "the", "of", "for", "to", "in", "at", "with", "remote", "hybrid", "onsite", "on", "site", "us", "usa", "f", "m", "d", "w"]);
const SHORT: Record<string, string> = { sr: "senior", jr: "junior", mgr: "manager", eng: "engineer", engr: "engineer", dev: "developer", mgmt: "management", assoc: "associate", admin: "administrator" };

/** A title as words to compare. */
export function titleWords(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .map((word) => SHORT[word] ?? word)
    .filter((word) => word && !TITLE_NOISE.has(word));
}

/** How alike two titles are, 0 to 1: the words they share, over all their words. */
export function titleLikeness(a: string, b: string): number {
  const left = new Set(titleWords(a));
  const right = new Set(titleWords(b));
  if (left.size === 0 || right.size === 0) return 0;
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / new Set([...left, ...right]).size;
}

/** Whether a page's text is about this job at this company: most of the title's words near the top, and the company named. */
export function pageIsJob(text: string, title: string, company: string): boolean {
  const head = text.slice(0, 4000).toLowerCase();
  const words = titleWords(title);
  const present = words.filter((word) => new RegExp(`\\b${word.replace(/[+#]/g, "\\$&")}`).test(head)).length;
  const named = companyWords(company).every((word) => text.toLowerCase().includes(word));
  return words.length > 0 && present / words.length >= 0.75 && named;
}

/** The place's city and state, lower case, to prefer a job in the same place. */
const placeWords = (place: string) => place.toLowerCase().split(/,\s*/).map((part) => part.trim()).filter((part) => part && part !== "united states" && part !== "usa");

/** The board job that's this posting: the closest title, in the same place when several are as close. */
export function pickJob(jobs: readonly BoardJob[], title: string, place: string): BoardJob | null {
  const close = jobs.map((job) => ({ job, likeness: titleLikeness(job.title, title) })).filter(({ likeness }) => likeness >= 0.7);
  if (close.length === 0) return null;
  const best = Math.max(...close.map(({ likeness }) => likeness));
  const top = close.filter(({ likeness }) => likeness === best).map(({ job }) => job);
  const where = placeWords(place);
  return top.find((job) => where.some((part) => job.location.toLowerCase().includes(part))) ?? top[0];
}

/** The first web address in a model's answer to "which page is it", or null when it says it found none. */
export function urlInAnswer(answer: string): string | null {
  const json = /\{[^{}]*"url"\s*:\s*(null|"[^"]*")[^{}]*\}/.exec(answer);
  if (json) return json[1] === "null" ? null : JSON.parse(json[1]) || null;
  return /https?:\/\/[^\s"'<>)]+/.exec(answer)?.[0] ?? null;
}

const onRelaySite = (url: string) => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return RELAY_SITES.some((site) => host === site || host.endsWith(`.${site}`));
  } catch {
    return true;
  }
};

/** The page at `url`, when it's this job's: its text and address. */
async function jobAt(url: string, query: SourceQuery, via: SourceHit["via"], signal: AbortSignal): Promise<SourceHit | null> {
  if (onRelaySite(url)) return null;
  const text = await readJobPage(url, signal);
  return text && text.length >= MIN_TEXT && pageIsJob(text, query.title, query.company) ? { url, description: text, via } : null;
}

/**
 * The posting on the employer's own site, or null when it can't be found
 * with confidence. `provider` searches the web as a last resort; without one
 * that can, it stops at the free ways.
 */
export async function findAtSource(query: SourceQuery, provider: AIProvider | null, signal: AbortSignal): Promise<SourceHit | null> {
  // 1. The employer's own page, when the source gave it, marked as such or not (a careers site it relayed from).
  for (const link of query.applyLinks.filter((entry) => isEmployerLink(entry.url) && !onRelaySite(entry.url))) {
    const hit = await jobAt(link.url, query, "link", signal);
    if (hit) return hit;
  }

  // 2. The company's job board: the right job by title and place, read through the board.
  for (const board of await findBoards(query.company, query.employerSite, signal)) {
    const job = pickJob(await boardJobs(board, query.title, signal), query.title, query.place);
    if (!job?.url) continue;
    const text = await job.read();
    if (text && text.length >= MIN_TEXT) return { url: job.url, description: text, via: "board" };
  }

  // 3. A web search for the page, which is then read and checked here.
  if (!provider?.searchWeb) return null;
  const answer = await provider.searchWeb({
    system:
      "You find the official page of a job posting: on the employer's own careers site, or its hiring system (Workday, Greenhouse, Lever, iCIMS, SmartRecruiters, Taleo and the like), never a job board that relays it. Answer with JSON only.",
    prompt: `Find the official posting for this job:\n\nTitle: ${query.title}\nCompany: ${query.company}\nLocation: ${query.place || "not given"}${query.employerSite ? `\nCompany website: ${query.employerSite}` : ""}\n\nAnswer {"url": "<the posting's address>"}, or {"url": null} if you can't find that exact job.`,
    maxSearches: 1,
    blockedDomains: RELAY_SITES,
    kind: "source_search",
    signal,
  });
  const url = urlInAnswer(answer);
  return url ? jobAt(url, query, "search", signal) : null;
}
