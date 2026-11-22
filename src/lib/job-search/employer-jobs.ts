import "server-only";

import { fetchHtml, fetchPosting } from "@/lib/posting-fetch";
import { decodeEntities, htmlToText } from "@/lib/startups/text";

import { companyWords } from "./company";

// Employers' own job boards: the hiring tool behind a company's careers page
// (Greenhouse, Lever, Ashby, Workday), found from links on its website or
// guessed from its name, and read through the tool's public job list, which
// needs no key and costs nothing. Used to find a posting a job board only
// relayed, with its full text and the page to apply on.

/** A company's board on a hiring tool. */
export type Board =
  | { tool: "greenhouse" | "lever" | "ashby"; slug: string }
  | { tool: "workday"; host: string; tenant: string; site: string };

/** One job on a board: enough to pick the right one before reading it. */
export type BoardJob = { title: string; location: string; url: string; read: () => Promise<string | null> };

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 5_000_000;
const SLUG = /^[a-z0-9][a-z0-9_.-]{0,80}$/i;
const WORKDAY_HOST = /^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/i;

/** JSON from a hiring tool's public API, or null when it isn't there (an unknown board is a 404). */
async function getJson(url: string, signal: AbortSignal, init: RequestInit = {}): Promise<unknown> {
  try {
    const response = await fetch(url, { ...init, headers: { accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]), redirect: "follow" });
    if (!response.ok) return null;
    const text = await response.text();
    return text.length > MAX_BYTES ? null : JSON.parse(text);
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
}

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object") : []);
const field = (value: unknown, key: string): unknown => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined);

/** The board a link to a job or a careers page is on, if it's one of the tools read here. */
export function boardOf(link: string): Board | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const [first, second] = url.pathname.split("/").filter(Boolean);
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const slug = url.searchParams.get("for") ?? (first === "embed" ? null : first);
    return slug && SLUG.test(slug) ? { tool: "greenhouse", slug } : null;
  }
  if (host === "jobs.lever.co" && first && SLUG.test(first)) return { tool: "lever", slug: first };
  if (host === "jobs.ashbyhq.com" && first && SLUG.test(decodeURIComponent(first))) return { tool: "ashby", slug: decodeURIComponent(first) };
  const workday = WORKDAY_HOST.exec(host);
  if (workday) {
    // The path starts with an optional locale ("en-US"), then the site.
    const site = /^[a-z]{2}-[A-Z]{2}$/.test(first ?? "") ? second : first;
    return site && SLUG.test(site) ? { tool: "workday", host, tenant: workday[1].toLowerCase(), site } : null;
  }
  return null;
}

/** Links to the hiring tools read here, in a page's HTML, once each. */
export function boardsIn(html: string): Board[] {
  const found = new Map<string, Board>();
  for (const match of html.matchAll(/https?:\/\/[a-z0-9.-]+\.(?:greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com)[^\s"'<>)\\]*/gi)) {
    const board = boardOf(decodeEntities(match[0]));
    if (board) found.set(JSON.stringify(board), board);
  }
  return [...found.values()];
}

/**
 * The boards a company may have: those its website links to (its home page,
 * /careers and /jobs), then its name as a Greenhouse, Lever or Ashby board.
 */
export async function findBoards(company: string, site: string, signal: AbortSignal): Promise<Board[]> {
  const found = new Map<string, Board>();
  const add = (board: Board) => found.set(JSON.stringify(board), board);
  let origin: string | null = null;
  try {
    origin = site ? new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`).origin : null;
  } catch {
    origin = null;
  }
  if (origin) {
    for (const path of ["/careers", "/jobs", "/"]) {
      if (signal.aborted) break;
      const page = await fetchHtml(`${origin}${path}`, { timeoutMs: TIMEOUT_MS });
      if (page.ok) for (const board of [...boardsIn(page.html), ...[boardOf(page.url)].filter((board): board is Board => board !== null)]) add(board);
    }
  }
  const words = companyWords(company);
  for (const slug of new Set([words.join(""), words.join("-")])) {
    if (!SLUG.test(slug)) continue;
    for (const tool of ["greenhouse", "lever", "ashby"] as const) add({ tool, slug });
  }
  return [...found.values()];
}

/** The jobs on a board whose titles may match, each readable in full; none when the board doesn't exist. */
export async function boardJobs(board: Board, title: string, signal: AbortSignal): Promise<BoardJob[]> {
  if (board.tool === "greenhouse") {
    const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.slug)}/jobs?content=true`, signal);
    return list(field(data, "jobs")).map((job) => ({
      title: str(job.title),
      location: str(field(job.location, "name")),
      url: str(job.absolute_url),
      read: async () => htmlToText(decodeEntities(str(job.content))) || null,
    }));
  }
  if (board.tool === "lever") {
    const data = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(board.slug)}?mode=json`, signal);
    return list(data).map((job) => ({
      title: str(job.text),
      location: str(field(job.categories, "location")),
      url: str(job.hostedUrl),
      read: async () =>
        [str(job.descriptionPlain), ...list(job.lists).map((part) => `${str(part.text)}\n${htmlToText(str(part.content))}`), str(job.additionalPlain)].filter(Boolean).join("\n\n") || null,
    }));
  }
  if (board.tool === "ashby") {
    const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.slug)}`, signal);
    return list(field(data, "jobs")).map((job) => ({
      title: str(job.title),
      location: str(job.location),
      url: str(job.jobUrl),
      read: async () => str(job.descriptionPlain) || htmlToText(str(job.descriptionHtml)) || null,
    }));
  }
  if (board.tool !== "workday") return [];
  // Workday searches by title; its list has no text, so each job is read on its own.
  const base = `https://${board.host}/wday/cxs/${board.tenant}/${board.site}`;
  const data = await getJson(`${base}/jobs`, signal, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: title }),
  });
  return list(field(data, "jobPostings")).map((job) => {
    const path = str(job.externalPath);
    return {
      title: str(job.title),
      location: str(job.locationsText),
      url: path ? `https://${board.host}/${board.site}${path}` : "",
      read: async () => {
        const detail = path ? await getJson(`${base}${path}`, signal) : null;
        return htmlToText(str(field(field(detail, "jobPostingInfo"), "jobDescription"))) || null;
      },
    };
  });
}

/**
 * The text of the job at `link`: through its hiring tool's API where it's one
 * read here (Workday pages need a browser to show it), else from the page.
 */
export async function readJobPage(link: string, signal: AbortSignal): Promise<string | null> {
  const board = boardOf(link);
  if (board?.tool === "workday") {
    const path = new URL(link).pathname.replace(/^\/[a-z]{2}-[A-Z]{2}(?=\/)/, "").replace(new RegExp(`^/${board.site}`), "");
    const detail = await getJson(`https://${board.host}/wday/cxs/${board.tenant}/${board.site}${path}`, signal);
    const info = field(detail, "jobPostingInfo");
    const text = htmlToText(str(field(info, "jobDescription")));
    return text ? [str(field(info, "title")), str(field(info, "location")), text].filter(Boolean).join("\n\n") : null;
  }
  const page = await fetchPosting(link, { timeoutMs: TIMEOUT_MS });
  return page.ok ? page.text : null;
}
