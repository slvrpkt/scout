import { describe, expect, it } from "vitest";

import { applyPage, letterText } from "./apply-steps";

describe("where to apply (Quick Apply)", () => {
  it("opens the employer's own page first, naming its hiring tool", () => {
    const links = [
      { kind: "source" as const, url: "https://www.theladders.com/job/1", publisher: "Ladders" },
      { kind: "direct" as const, url: "https://acme.wd5.myworkdayjobs.com/en-US/careers/job/1", publisher: "Acme" },
    ];
    expect(applyPage(links, "")).toEqual({ url: "https://acme.wd5.myworkdayjobs.com/en-US/careers/job/1", label: "the company's site (via Workday)", direct: true });
  });

  it("then LinkedIn, then where it was found, saying it isn't the employer's page", () => {
    expect(applyPage([{ kind: "linkedin", url: "https://www.linkedin.com/jobs/view/1", publisher: "LinkedIn" }], "")).toMatchObject({ label: "LinkedIn", direct: false });
    expect(applyPage([{ kind: "source", url: "https://www.theladders.com/job/1", publisher: "Ladders" }], "")).toEqual({ url: "https://www.theladders.com/job/1", label: "Ladders", direct: false });
  });

  it("without links, the posting's own link: the employer's unless it's a job board", () => {
    expect(applyPage([], "https://careers.gevernova.com/job/1")).toEqual({ url: "https://careers.gevernova.com/job/1", label: "the company's site", direct: true });
    expect(applyPage([], "https://www.indeed.com/viewjob?jk=1")).toMatchObject({ label: "Indeed", direct: false });
    expect(applyPage([], "")).toBeNull();
  });
});

describe("the cover letter as text", () => {
  it("is the greeting, the paragraphs, the sign-off and the name, without the sender, date or recipient", () => {
    const units = [
      { id: "sender", text: "Sam Lee\nsam@example.com" },
      { id: "date", text: "November 13, 2026" },
      { id: "recipient", text: "Hiring team, Acme" },
      { id: "greeting", text: "Dear hiring team," },
      { id: "paragraph:1", text: "First paragraph." },
      { id: "paragraph:2", text: " Second paragraph. " },
      { id: "sign-off", text: "Sincerely," },
      { id: "signature", text: "Sam Lee" },
    ];
    expect(letterText(units)).toBe("Dear hiring team,\n\nFirst paragraph.\n\nSecond paragraph.\n\nSincerely,\nSam Lee");
  });
});
