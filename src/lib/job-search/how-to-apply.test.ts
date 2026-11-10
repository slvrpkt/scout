import { describe, expect, it } from "vitest";

import { howToApply } from "./how-to-apply";

describe("howToApply", () => {
  it("names the hiring tool or job board, whatever the subdomain", () => {
    expect(howToApply("https://job-boards.greenhouse.io/acme/jobs/1")).toEqual({ label: "Apply via Greenhouse", url: "https://job-boards.greenhouse.io/acme/jobs/1" });
    expect(howToApply("https://acme.wd5.myworkdayjobs.com/careers/1")?.label).toBe("Apply via Workday");
    expect(howToApply("https://www.linkedin.com/jobs/view/1")?.label).toBe("Apply via LinkedIn");
  });

  it("falls back to the company's website, and to nothing without a real link", () => {
    expect(howToApply("https://careers.acme.com/1")?.label).toBe("Apply on the company's website");
    expect(howToApply("https://notlinkedin.com/1")?.label).toBe("Apply on the company's website");
    expect(howToApply("")).toBeNull();
    expect(howToApply("javascript:alert(1)")).toBeNull();
  });
});
