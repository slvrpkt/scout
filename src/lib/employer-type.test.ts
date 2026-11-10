import { describe, expect, it } from "vitest";

import { employerLabel, guessEmployerType } from "./employer-type";

const guess = (extra: Partial<Parameters<typeof guessEmployerType>[0]>) =>
  guessEmployerType({ company: "Acme", postingUrl: "", postingText: "", fromStartups: false, ...extra });

describe("guessEmployerType", () => {
  it("knows government by its address, its name or what the posting says", () => {
    expect(guess({ postingUrl: "https://www.usajobs.gov/job/123" })).toBe("GOVERNMENT");
    expect(guess({ postingUrl: "https://careers.example.gov.uk/job/1" })).toBe("GOVERNMENT");
    expect(guess({ company: "City of Austin" })).toBe("GOVERNMENT");
    expect(guess({ company: "Gemeente Utrecht" })).toBe("GOVERNMENT");
    expect(guess({ company: "Department of Veterans Affairs" })).toBe("GOVERNMENT");
    expect(guess({ postingText: "This GS-12 position requires a security clearance required for all staff." })).toBe("GOVERNMENT");
  });

  it("knows a startup by where it came from or what the posting says", () => {
    expect(guess({ fromStartups: true })).toBe("STARTUP");
    expect(guess({ postingText: "We're a Series A startup, backed by top investors." })).toBe("STARTUP");
    expect(guess({ postingText: "Join us as our founding designer." })).toBe("STARTUP");
  });

  it("leaves everything else blank, private companies included", () => {
    expect(guess({ company: "Coolblue", postingUrl: "https://www.coolblue.nl/vacatures/1", postingText: "A product designer for our checkout." })).toBeNull();
    // Words that only sound public.
    expect(guess({ company: "Brightline Creative Agency" })).toBeNull();
    expect(guess({ postingText: "You'll work with our customer council and partner agencies." })).toBeNull();
  });
});

describe("employerLabel", () => {
  it("shows the user's choice over the guess, and nothing for a private company", () => {
    expect(employerLabel(null, "STARTUP")).toEqual({ type: "STARTUP", auto: true });
    expect(employerLabel("GOVERNMENT", "STARTUP")).toEqual({ type: "GOVERNMENT", auto: false });
    expect(employerLabel("PRIVATE", "GOVERNMENT")).toEqual({ type: null, auto: false });
    expect(employerLabel(null, null)).toEqual({ type: null, auto: true });
  });
});
