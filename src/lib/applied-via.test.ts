import { describe, expect, it } from "vitest";

import { guessAppliedVia } from "./applied-via";

describe("Applied Using: Scout's guess", () => {
  it("takes the job source's via first", () => {
    expect(guessAppliedVia({ via: "LinkedIn", postingUrl: "https://boards.greenhouse.io/acme/jobs/1" })).toBe("LinkedIn");
    expect(guessAppliedVia({ via: "glassdoor", postingUrl: "" })).toBe("Glassdoor");
  });

  it("then the posting link's platform, subdomains included", () => {
    expect(guessAppliedVia({ postingUrl: "https://boards.greenhouse.io/acme/jobs/1" })).toBe("Greenhouse");
    expect(guessAppliedVia({ postingUrl: "https://acme.wd5.myworkdayjobs.com/en-US/careers/job/1" })).toBe("Workday");
    expect(guessAppliedVia({ postingUrl: "https://www.linkedin.com/jobs/view/1" })).toBe("LinkedIn");
    expect(guessAppliedVia({ postingUrl: "https://hiring.cafe/job/1" })).toBe("hiring.cafe");
  });

  it("calls any other link the company's website, and has no guess without one", () => {
    expect(guessAppliedVia({ via: "Some Board", postingUrl: "https://careers.acme.com/1" })).toBe("Company Website");
    expect(guessAppliedVia({ postingUrl: "" })).toBeNull();
  });
});
