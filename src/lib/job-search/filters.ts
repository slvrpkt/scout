import { payOf, workStyleOf, type WorkStyle } from "@/lib/scoring/preferences";

import type { FoundPosting, SearchPage, SearchQuery } from "./search";

// A search's filters, the same on Manual job search and each of the job
// agent's searches. Date posted, employment type and remote-only go to the
// job source; the rest is checked here on what comes back. A posting is
// hidden only when it clearly doesn't fit: one that doesn't say its work
// mode, level or pay stays.

export const WORK_MODES = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "On-site" },
] as const satisfies readonly { value: WorkStyle; label: string }[];

export const LEVELS = [
  { value: "entry", label: "Entry level" },
  { value: "senior", label: "Senior" },
  { value: "manager", label: "Manager" },
  { value: "director", label: "Director" },
  { value: "executive", label: "Executive" },
] as const;
export type Level = (typeof LEVELS)[number]["value"];

export const EMPLOYMENT_TYPES = [
  { value: "fulltime", label: "Full-time", source: "FULLTIME" },
  { value: "parttime", label: "Part-time", source: "PARTTIME" },
  { value: "contract", label: "Contract", source: "CONTRACTOR" },
  { value: "internship", label: "Internship", source: "INTERN" },
  { value: "volunteer", label: "Volunteer", source: null },
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]["value"];

// ─── What's searched for ─────────────────────────────────────────────────────

// Levels in what you type don't narrow the search: "Senior IT PM" finds IT project managers at every level; the level filter does that.
const LEVEL_WORDS = /\b(?:senior|sr\.?|junior|jr\.?|lead|principal|staff|entry[- ]level|mid[- ]level|associate|i{1,3}|iv)(?=[\s,]|$)/gi;

/**
 * What's sent to the job source for what you typed: level words dropped,
 * and PM, PMO and TPM spelled out. A product manager is only meant when it
 * says "product".
 */
export function searchTerms(keywords: string): string {
  let text = ` ${keywords} `;
  const product = /\bproduct\b/i.test(text);
  text = text.replace(LEVEL_WORDS, " ");
  if (!product) {
    text = text.replace(/\bTPMs?\b/gi, "technical project manager OR technical program manager");
    text = text.replace(/\bPMOs?\b|\bPMs?\b/gi, "project manager");
  }
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned || keywords.trim();
}

// ─── What's kept ─────────────────────────────────────────────────────────────

/** The level a posting is for, from its title and the years it asks for; null when it doesn't say. */
export function levelOf(posting: Pick<FoundPosting, "title" | "description">): Level | null {
  const title = posting.title.toLowerCase();
  if (/\b(?:chief|c[eotfi]o|vp|vice president|svp|evp|head of|president)\b/.test(title)) return "executive";
  if (/\bdirector\b/.test(title)) return "director";
  if (/\b(?:senior|sr\.?|lead|principal|staff|iii|iv)\b/.test(title)) return "senior";
  if (/\b(?:junior|jr\.?|entry|graduate|intern|apprentice|trainee)\b/.test(title)) return "entry";
  const years = /\b(\d{1,2})\s*\+?\s*(?:-|–|to)?\s*\d{0,2}\s*\+?\s*years?\b/i.exec(posting.description);
  if (years) {
    const least = Number(years[1]);
    if (least >= 7) return "senior";
    if (least <= 2) return "entry";
  }
  if (/\bmanager\b|\bmanagement\b/.test(title)) return "manager";
  return null;
}

const VOLUNTEER = /\b(?:volunteer|unpaid)\b/i;

/** The kind of employment a posting states, in the filter's terms; null when it doesn't say. */
function typeOf(posting: Pick<FoundPosting, "title" | "description" | "employmentType">): EmploymentType | null {
  if (VOLUNTEER.test(posting.title) || /\bvolunteer (?:role|position|opportunity)\b/i.test(posting.description)) return "volunteer";
  const given = (posting.employmentType ?? "").toUpperCase();
  return EMPLOYMENT_TYPES.find((type) => type.source && given.includes(type.source))?.value ?? null;
}

/** Whether a posting fits the search's filters. What a posting doesn't say never hides it. */
export function passesFilters(posting: FoundPosting, query: Pick<SearchQuery, "workModes" | "levels" | "types" | "minSalary">): boolean {
  const modes = query.workModes ?? [];
  if (modes.length > 0) {
    const style = workStyleOf(posting);
    if (style && !modes.includes(style)) return false;
  }
  const levels = query.levels ?? [];
  if (levels.length > 0) {
    const level = levelOf(posting);
    if (level && !levels.includes(level)) return false;
  }
  const types = query.types ?? [];
  if (types.length > 0) {
    const type = typeOf(posting);
    if (type && !types.includes(type)) return false;
  }
  if (query.minSalary) {
    const pay = payOf(posting);
    if (pay && pay.high < query.minSalary) return false;
  }
  return true;
}

/** A page with the postings the filters hide taken out, and how many that was. */
export function filterPage(page: SearchPage, query: SearchQuery): SearchPage {
  const postings = page.postings.filter((posting) => passesFilters(posting, query));
  return { ...page, postings, hidden: page.postings.length - postings.length };
}

/** The source's employment types for the search, or null to ask for all (Volunteer isn't one a source knows). */
export function sourceTypes(query: Pick<SearchQuery, "types">): string[] | null {
  const types = query.types ?? [];
  if (types.length === 0 || types.includes("volunteer")) return null;
  return EMPLOYMENT_TYPES.filter((type) => types.includes(type.value) && type.source).map((type) => type.source!);
}

/** Whether only remote jobs are wanted, which the sources can filter themselves. */
export const remoteOnly = (query: Pick<SearchQuery, "workModes" | "remoteOnly">) =>
  query.workModes && query.workModes.length > 0 ? query.workModes.length === 1 && query.workModes[0] === "remote" : query.remoteOnly;
