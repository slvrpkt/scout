import { periodStart, type ArchiveReason } from "./agent/archive-reasons";
import type { ArchiveKind, ArchiveRow } from "./archive-data";

// The Archive's filters and sorting, apart from the screen so they can be tested.

export const ARCHIVE_SORT_KEYS = ["archivedAt", "title", "company", "location", "pay", "score", "why", "kind", "foundBy"] as const;
export type ArchiveSortKey = (typeof ARCHIVE_SORT_KEYS)[number];
export type ArchiveSort = { key: ArchiveSortKey; reversed: boolean };

/** Newest first: what was archived last is what you'd check first. */
export const DEFAULT_ARCHIVE_SORT: ArchiveSort = { key: "archivedAt", reversed: false };

export type ArchiveFilters = {
  when: "all" | "today" | "week" | "month" | "range";
  /** For "range": the first and last day, "YYYY-MM-DD", either may be empty. */
  from: string;
  to: string;
  why: "all" | ArchiveReason;
  kind: "all" | ArchiveKind;
  title: string;
  company: string;
  location: string;
  /** Yearly pay at least this much; rows without pay are left out once it's set. */
  minPay: number | null;
  /** A score at least this; rows without a score are left out once it's set. */
  minScore: number | null;
  foundBy: string;
};

export const NO_ARCHIVE_FILTERS: ArchiveFilters = { when: "all", from: "", to: "", why: "all", kind: "all", title: "", company: "", location: "", minPay: null, minScore: null, foundBy: "all" };

const has = (text: string, needle: string) => !needle.trim() || text.toLowerCase().includes(needle.trim().toLowerCase());
const dayStart = (day: string) => new Date(`${day}T00:00:00`).getTime();

export function filterArchive(rows: readonly ArchiveRow[], filters: ArchiveFilters, now: Date): ArchiveRow[] {
  const since = filters.when === "today" || filters.when === "week" || filters.when === "month" ? periodStart(filters.when, now) : null;
  const from = filters.when === "range" && filters.from ? dayStart(filters.from) : null;
  const until = filters.when === "range" && filters.to ? dayStart(filters.to) + 86_400_000 : null;
  return rows.filter((row) => {
    const at = Date.parse(row.archivedAt);
    return (
      (since === null || at >= since) &&
      (from === null || at >= from) &&
      (until === null || at < until) &&
      (filters.why === "all" || row.why === filters.why) &&
      (filters.kind === "all" || row.kind === filters.kind) &&
      // The title box finds the word that archived it too.
      has(`${row.title} ${row.note}`, filters.title) &&
      has(row.company, filters.company) &&
      has(row.location, filters.location) &&
      (filters.minPay === null || (row.pay !== null && row.pay >= filters.minPay)) &&
      (filters.minScore === null || (row.score !== null && row.score >= filters.minScore)) &&
      (filters.foundBy === "all" || row.foundBy === filters.foundBy)
    );
  });
}

const VALUE: Record<ArchiveSortKey, (row: ArchiveRow) => string | number | null> = {
  archivedAt: (row) => Date.parse(row.archivedAt),
  title: (row) => row.title.toLowerCase(),
  company: (row) => row.company.toLowerCase() || null,
  location: (row) => row.location.toLowerCase() || null,
  pay: (row) => row.pay,
  score: (row) => row.score,
  why: (row) => row.why,
  kind: (row) => row.kind,
  foundBy: (row) => row.foundBy?.toLowerCase() ?? null,
};

/** Numbers and dates high to low first, words A to Z first; `reversed` flips that. What's unknown always goes last. */
export function sortArchive(rows: readonly ArchiveRow[], { key, reversed }: ArchiveSort): ArchiveRow[] {
  const value = VALUE[key];
  const downward = key === "archivedAt" || key === "pay" || key === "score";
  return rows.toSorted((a, b) => {
    const [x, y] = [value(a), value(b)];
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return (downward ? -order : order) * (reversed ? -1 : 1);
  });
}
