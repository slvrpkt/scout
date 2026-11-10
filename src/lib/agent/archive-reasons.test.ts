import { describe, expect, it } from "vitest";

import { archiveReasonOf, periodStart } from "./archive-reasons";

describe("why a posting is archived", () => {
  it("reads the reason from the note it was archived with", () => {
    expect(archiveReasonOf(["Skipped by its title: “director”"])).toBe("title");
    expect(archiveReasonOf(["Skipped by your rule “TS/SCI”: the posting mentions it"])).toBe("word");
    expect(archiveReasonOf(["Skipped by your rule “within 75 miles”: On-site, about 140 miles from 10001"])).toBe("distance");
    expect(archiveReasonOf(["Skipped by your rule “minimum score 60”: the best it could reach is 55"])).toBe("minimum");
    expect(archiveReasonOf(["Skipped by your rule “PMP is required”: PMP required."])).toBe("search");
    expect(archiveReasonOf(["Dutch is required."])).toBe("you");
    expect(archiveReasonOf([])).toBe("you");
  });

  it("starts today, this week on Monday, and this month on the 1st", () => {
    const sunday = new Date(2026, 10, 8, 15, 30);
    expect(new Date(periodStart("today", sunday))).toEqual(new Date(2026, 10, 8));
    expect(new Date(periodStart("week", sunday))).toEqual(new Date(2026, 10, 2));
    expect(new Date(periodStart("month", sunday))).toEqual(new Date(2026, 10, 1));
  });
});
