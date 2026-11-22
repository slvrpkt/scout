import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AIProvider } from "@/lib/ai/provider";
import { boardJobs, findBoards, readJobPage } from "@/lib/job-search/employer-jobs";

import { findAtSource, pageIsJob, pickJob, titleLikeness, urlInAnswer } from "./source-finder";

vi.mock("@/lib/job-search/employer-jobs", () => ({ findBoards: vi.fn(async () => []), boardJobs: vi.fn(async () => []), readJobPage: vi.fn(async () => null) }));

const long = (title: string, company: string) => `${company}: ${title}\n\nArlington, VA\n\n${"We are hiring someone to lead programs and delivery. ".repeat(10)}`;
const query = { title: "Sr. Program Manager", company: "Acme Corp", place: "Arlington, VA", employerSite: "https://acme.com", applyLinks: [] };
const job = (title: string, location: string, url: string, text: string | null = long(title, "Acme")) => ({ title, location, url, read: vi.fn(async () => text) });
const searcher = (answer: string) => ({ searchWeb: vi.fn(async () => answer) }) as unknown as AIProvider;
const signal = new AbortController().signal;

beforeEach(() => vi.clearAllMocks());

describe("telling the same job apart", () => {
  it("compares titles by their words, short forms written out", () => {
    expect(titleLikeness("Sr. Program Manager", "Senior Program Manager")).toBe(1);
    expect(titleLikeness("Program Manager", "Program Manager - Remote")).toBe(1);
    expect(titleLikeness("Program Manager", "Product Designer")).toBe(0);
  });

  it("takes a page as the job when its title's words lead it and the company is named", () => {
    expect(pageIsJob(long("Senior Program Manager", "Acme"), "Sr. Program Manager", "Acme Corp")).toBe(true);
    expect(pageIsJob(long("Senior Program Manager", "Globex"), "Sr. Program Manager", "Acme Corp")).toBe(false);
    expect(pageIsJob(long("Payroll Clerk", "Acme"), "Sr. Program Manager", "Acme Corp")).toBe(false);
  });

  it("picks the closest title on a board, in the same place when several are as close", () => {
    const jobs = [
      job("Program Manager", "Denver, CO", "https://a/1"),
      job("Senior Program Manager", "Austin, TX", "https://a/2"),
      job("Senior Program Manager", "Arlington, VA", "https://a/3"),
      job("Designer", "Arlington, VA", "https://a/4"),
    ];
    expect(pickJob(jobs, "Sr. Program Manager", "Arlington, VA")?.url).toBe("https://a/3");
    expect(pickJob([job("Designer", "Arlington, VA", "https://a/4")], "Sr. Program Manager", "Arlington, VA")).toBeNull();
  });

  it("reads the address out of the search's answer", () => {
    expect(urlInAnswer('{"url": "https://acme.wd5.myworkdayjobs.com/careers/job/1"}')).toBe("https://acme.wd5.myworkdayjobs.com/careers/job/1");
    expect(urlInAnswer('I could not find it. {"url": null}')).toBeNull();
    expect(urlInAnswer("It is at https://careers.acme.com/jobs/9")).toBe("https://careers.acme.com/jobs/9");
  });
});

describe("finding it on the company's site", () => {
  it("takes the employer's link the source gave, when its page is the job", async () => {
    vi.mocked(readJobPage).mockResolvedValueOnce(long("Senior Program Manager", "Acme"));
    const hit = await findAtSource({ ...query, applyLinks: [{ kind: "direct", url: "https://careers.acme.com/jobs/1", publisher: "Acme" }] }, null, signal);
    expect(hit).toMatchObject({ url: "https://careers.acme.com/jobs/1", via: "link" });
    expect(findBoards).not.toHaveBeenCalled();
  });

  it("then the company's job board, for free, before any search", async () => {
    vi.mocked(findBoards).mockResolvedValueOnce([{ tool: "greenhouse", slug: "acme" }]);
    vi.mocked(boardJobs).mockResolvedValueOnce([job("Senior Program Manager", "Arlington, VA", "https://job-boards.greenhouse.io/acme/jobs/7")]);
    const provider = searcher('{"url": "https://acme.com/x"}');
    expect(await findAtSource(query, provider, signal)).toMatchObject({ url: "https://job-boards.greenhouse.io/acme/jobs/7", via: "board" });
    expect(provider.searchWeb).not.toHaveBeenCalled();
  });

  it("searches the web last, keeping job boards out, and checks the page it names", async () => {
    vi.mocked(readJobPage).mockResolvedValueOnce(long("Senior Program Manager", "Acme"));
    const provider = searcher('{"url": "https://acme.wd5.myworkdayjobs.com/careers/job/Arlington/Senior-Program-Manager_R1"}');
    expect(await findAtSource(query, provider, signal)).toMatchObject({ via: "search" });
    expect(provider.searchWeb).toHaveBeenCalledWith(
      expect.objectContaining({ maxSearches: 1, kind: "source_search", blockedDomains: expect.arrayContaining(["linkedin.com", "theladders.com"]) }),
    );
  });

  it("finds nothing rather than the wrong job: a job board's page, or another job's", async () => {
    expect(await findAtSource(query, searcher('{"url": "https://www.theladders.com/job/1"}'), signal)).toBeNull();
    vi.mocked(readJobPage).mockResolvedValueOnce(long("Payroll Clerk", "Acme"));
    expect(await findAtSource(query, searcher('{"url": "https://careers.acme.com/jobs/2"}'), signal)).toBeNull();
    expect(await findAtSource(query, searcher('{"url": null}'), signal)).toBeNull();
    expect(await findAtSource(query, null, signal)).toBeNull();
  });
});
