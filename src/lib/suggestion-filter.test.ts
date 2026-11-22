import { describe, expect, it } from "vitest";

import { keptSuggestions, worthRaising } from "./suggestion-filter";

describe("suggestions worth the candidate's time", () => {
  it("drops logistics, generic soft skills and nice-to-haves", () => {
    expect(worthRaising("The posting asks for a commute to Ashburn, VA. If true, state it in your summary.")).toBe(false);
    expect(worthRaising("The posting asks for excellent interpersonal and verbal/written communication. Name them.")).toBe(false);
    expect(worthRaising("The posting lists PMP as a plus. If not, no action is needed.")).toBe(false);
    expect(worthRaising("The posting asks for up to 20% travel; add a line if you can.")).toBe(false);
  });

  it("keeps real gaps and implied work, at most five", () => {
    const idea = "The posting asks for SELC documents; your Consulting role implies them. If true, name the documents in that role.";
    expect(worthRaising(idea)).toBe(true);
    expect(keptSuggestions([` ${idea} `, "Name problem solving outright.", ...Array(6).fill(idea)])).toHaveLength(5);
    expect(keptSuggestions(["", "Name problem solving outright."])).toEqual([]);
  });
});
