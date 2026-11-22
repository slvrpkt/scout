import { afterEach, describe, expect, it, vi } from "vitest";

import { boardJobs, boardOf, boardsIn } from "./employer-jobs";

vi.mock("@/lib/posting-fetch", () => ({ fetchHtml: vi.fn(), fetchPosting: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());
const signal = new AbortController().signal;

describe("employers' job boards", () => {
  it("knows a board from a link to a job or a careers page", () => {
    expect(boardOf("https://job-boards.greenhouse.io/acme/jobs/123")).toEqual({ tool: "greenhouse", slug: "acme" });
    expect(boardOf("https://boards.greenhouse.io/embed/job_board?for=acme")).toEqual({ tool: "greenhouse", slug: "acme" });
    expect(boardOf("https://jobs.lever.co/acme/1f2e")).toEqual({ tool: "lever", slug: "acme" });
    expect(boardOf("https://jobs.ashbyhq.com/acme")).toEqual({ tool: "ashby", slug: "acme" });
    expect(boardOf("https://acme.wd5.myworkdayjobs.com/en-US/External/job/Arlington/PM_R1")).toEqual({ tool: "workday", host: "acme.wd5.myworkdayjobs.com", tenant: "acme", site: "External" });
    expect(boardOf("https://www.linkedin.com/jobs/view/1")).toBeNull();
  });

  it("finds the boards a careers page links to, once each", () => {
    const html = '<a href="https://jobs.lever.co/acme">Jobs</a> <a href="https://jobs.lever.co/acme/1">One</a> <iframe src="https://acme.wd1.myworkdayjobs.com/Careers"></iframe>';
    expect(boardsIn(html)).toEqual([
      { tool: "lever", slug: "acme" },
      { tool: "workday", host: "acme.wd1.myworkdayjobs.com", tenant: "acme", site: "Careers" },
    ]);
  });

  it("lists a Greenhouse board's jobs with their text", async () => {
    const body = { jobs: [{ title: "Program Manager", location: { name: "Arlington, VA" }, absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1", content: "&lt;p&gt;Lead programs.&lt;/p&gt;" }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body))));
    const [job] = await boardJobs({ tool: "greenhouse", slug: "acme" }, "Program Manager", signal);
    expect(job).toMatchObject({ title: "Program Manager", location: "Arlington, VA", url: "https://job-boards.greenhouse.io/acme/jobs/1" });
    expect(await job.read()).toBe("Lead programs.");
  });

  it("searches a Workday board by title and reads a job on its own", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith("/jobs")
        ? new Response(JSON.stringify({ jobPostings: [{ title: "Program Manager", externalPath: "/job/Arlington/PM_R1", locationsText: "Arlington, VA" }] }))
        : new Response(JSON.stringify({ jobPostingInfo: { jobDescription: "<p>Lead programs.</p>" } })),
    );
    vi.stubGlobal("fetch", fetch);
    const [job] = await boardJobs({ tool: "workday", host: "acme.wd5.myworkdayjobs.com", tenant: "acme", site: "External" }, "Program Manager", signal);
    expect(job.url).toBe("https://acme.wd5.myworkdayjobs.com/External/job/Arlington/PM_R1");
    expect(await job.read()).toBe("Lead programs.");
    expect(fetch).toHaveBeenCalledWith("https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs", expect.objectContaining({ method: "POST" }));
  });

  it("finds no jobs on a board that isn't there", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404 })));
    expect(await boardJobs({ tool: "lever", slug: "nobody" }, "Program Manager", signal)).toEqual([]);
  });
});
