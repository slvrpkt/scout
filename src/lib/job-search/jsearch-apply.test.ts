import { describe, expect, it } from "vitest";

import { applyLinksOf } from "./jsearch";

type Job = Parameters<typeof applyLinksOf>[0];
const job = (extra: Partial<Job>): Job => ({ job_id: "1", ...extra }) as Job;

describe("where a JSearch job can be applied to", () => {
  it("lists the employer's own page, then LinkedIn, then where JSearch found it", () => {
    expect(
      applyLinksOf(
        job({
          job_publisher: "Indeed",
          job_apply_link: "https://www.indeed.com/viewjob?jk=1",
          apply_options: [
            { publisher: "Indeed", apply_link: "https://www.indeed.com/viewjob?jk=1", is_direct: false },
            { publisher: "LinkedIn", apply_link: "https://www.linkedin.com/jobs/view/123", is_direct: false },
            { publisher: "Ledgerly Careers", apply_link: "https://ledgerly.wd1.myworkdayjobs.com/job/1", is_direct: true },
          ],
        }),
      ),
    ).toEqual([
      { kind: "direct", url: "https://ledgerly.wd1.myworkdayjobs.com/job/1", publisher: "Ledgerly Careers" },
      { kind: "linkedin", url: "https://www.linkedin.com/jobs/view/123", publisher: "LinkedIn" },
      { kind: "source", url: "https://www.indeed.com/viewjob?jk=1", publisher: "Indeed" },
    ]);
  });

  it("leaves out what JSearch doesn't give, and the same link twice", () => {
    expect(applyLinksOf(job({ job_publisher: "LinkedIn", job_apply_link: "https://www.linkedin.com/jobs/view/9", apply_options: [{ publisher: "LinkedIn", apply_link: "https://www.linkedin.com/jobs/view/9", is_direct: false }] }))).toEqual([
      { kind: "linkedin", url: "https://www.linkedin.com/jobs/view/9", publisher: "LinkedIn" },
    ]);
    expect(applyLinksOf(job({ apply_options: [{ publisher: "X", apply_link: "javascript:alert(1)", is_direct: true }] }))).toEqual([]);
  });
});
