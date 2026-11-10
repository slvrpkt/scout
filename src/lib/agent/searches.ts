import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { EMPTY_QUERY, searchQuerySchema, type JobSource, type SearchQuery } from "@/lib/job-search/search";
import { prisma } from "@/lib/prisma";

// The job agent's saved searches: every run goes through all the ones
// switched on, one after another, and keeps what's new from each.

/** How many saved searches the agent may have. */
export const MAX_AGENT_SEARCHES = 20;

/** The most pages of results a search reads in a run; each page is one request to the job source. */
export const MAX_AGENT_PAGES = 5;

/**
 * How many pages a new search reads: as many as allowed, but one through
 * JSearch, whose free plan is 200 requests a month (5 searches × 5 pages
 * would use it up in a week).
 */
export const defaultPages = (source: JobSource | null) => (source === "JSEARCH" ? 1 : MAX_AGENT_PAGES);

export type AgentSearch = {
  id: string;
  name: string;
  query: SearchQuery;
  enabled: boolean;
  position: number;
  /** 1–MAX_AGENT_PAGES. */
  maxPages: number;
  /** What to skip, one rule per line (skipRuleList). */
  skipRules: string;
  /** Where to look, one location per line (skipRuleList); empty uses the query's own place. */
  places: string;
  /** Other titles searched too, each on its own, one per line (skipRuleList). */
  altTitles: string;
  /** Companies to search, one per line (skipRuleList): with them, the search is across the country, not its locations. */
  companies: string;
  createdAt: Date;
  lastRunAt: Date | null;
  lastMessage: string | null;
};

/** Whether a search is complete enough to run: keywords and a country. */
export const agentQueryReady = (query: SearchQuery) => Boolean(query.keywords.trim() && query.country);

/** The ones a run goes through: switched on and complete. */
export const readySearches = (searches: readonly AgentSearch[]) => searches.filter((search) => search.enabled && agentQueryReady(search.query));

/** A search's name: its keywords, as they're typed. */
const nameOf = (query: SearchQuery) => query.keywords.trim() || "New search";

const toSearch = (row: { createdAt: Date; id: string; name: string; query: Prisma.JsonValue; enabled: boolean; position: number; maxPages: number; skipRules: string; places: string; altTitles: string; companies: string; lastRunAt: Date | null; lastMessage: string | null }): AgentSearch => ({
  ...row,
  maxPages: Math.min(Math.max(row.maxPages, 1), MAX_AGENT_PAGES),
  // A query the schema no longer reads counts as an empty one, which never runs.
  query: searchQuerySchema.catch(EMPTY_QUERY).parse(row.query),
});

/** Every saved search, in their order. */
export async function loadAgentSearches(): Promise<AgentSearch[]> {
  const rows = await prisma.agentSearch.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  return rows.map(toSearch);
}

/** Adds a search at the end of the list; null when the list is full. */
export async function createAgentSearch(query: SearchQuery, maxPages: number = MAX_AGENT_PAGES): Promise<AgentSearch | null> {
  return prisma.$transaction(async (tx) => {
    const count = await tx.agentSearch.count();
    if (count >= MAX_AGENT_SEARCHES) return null;
    const last = await tx.agentSearch.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
    const row = await tx.agentSearch.create({ data: { name: nameOf(query), query, maxPages, position: (last?.position ?? -1) + 1 } });
    return toSearch(row);
  });
}

/** Changes a search's query, pages or switch; null when it no longer exists. */
export async function updateAgentSearch(id: string, changes: { query?: SearchQuery; enabled?: boolean; maxPages?: number; skipRules?: string; places?: string; altTitles?: string; companies?: string }): Promise<AgentSearch | null> {
  const { count } = await prisma.agentSearch.updateMany({
    where: { id },
    data: { enabled: changes.enabled, maxPages: changes.maxPages, skipRules: changes.skipRules, places: changes.places, altTitles: changes.altTitles, companies: changes.companies, ...(changes.query ? { query: changes.query, name: nameOf(changes.query) } : {}) },
  });
  if (count === 0) return null;
  return toSearch(await prisma.agentSearch.findUniqueOrThrow({ where: { id } }));
}

/** Removes a search; what it found stays. */
export async function deleteAgentSearch(id: string): Promise<void> {
  // What it found and hasn't been scored goes with it.
  await prisma.queuedPosting.deleteMany({ where: { searchId: id } });
  await prisma.agentSearch.deleteMany({ where: { id } });
}

/** Notes how a search went in a run, for the Agent screen. */
export async function recordSearchRun(id: string, at: Date, message: string): Promise<void> {
  await prisma.agentSearch.updateMany({ where: { id }, data: { lastRunAt: at, lastMessage: message } });
}
