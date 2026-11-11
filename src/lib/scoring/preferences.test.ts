import { describe, expect, it } from "vitest";

import { bestPossible, DEFAULT_SCORING_PREFS, factsOf, milesBetween, PAY_FLOOR, payOf, payShare, placeShare, prefLines, ruledOut, ruleOutWord, workStyleOf } from "./preferences";
import { rubricScore } from "./rubric";

const posting = (patch: Partial<Parameters<typeof workStyleOf>[0]> = {}) => ({ title: "Technical Project Manager", description: "Lead delivery.", remote: null, salary: "", ...patch });
const prefs = DEFAULT_SCORING_PREFS;
const fairfax = { lat: 38.85, lng: -77.3 };
const dc = { lat: 38.9, lng: -77.03 };
const chicago = { lat: 41.88, lng: -87.63 };

describe("work style", () => {
  it("reads hybrid from the words, before the source's remote flag", () => {
    expect(workStyleOf(posting({ remote: true, description: "This is a hybrid role, 3 days a week in the office." }))).toBe("hybrid");
    expect(workStyleOf(posting({ description: "Expected 2 days per week on-site in Reston." }))).toBe("hybrid");
  });
  it("doesn't take hybrid cloud for hybrid work", () => {
    expect(workStyleOf(posting({ description: "Experience with hybrid cloud environments." }))).toBeNull();
    // Remote said plainly wins over a passing mention of hybrid work or an office.
    expect(workStyleOf(posting({ title: "Rebar Project Manager (Remote North East Coast)", description: "Visit sites on-site as needed." }))).toBe("remote");
    expect(workStyleOf(posting({ description: "This position is fully remote. Our Reston teams work hybrid." }))).toBe("remote");
    expect(workStyleOf(posting({ title: "Project Manager (Hybrid / Remote)", description: "3 days a week in the office." }))).toBe("hybrid");
    expect(workStyleOf(posting({ remote: false, description: "This is a 100% U.S. based remote position. Visit the office on-site once a year." }))).toBe("remote");
    expect(workStyleOf(posting({ remote: false, description: "This is not a remote position; on-site in Reston." }))).toBe("onsite");
  });
  it("reads remote and on-site from the flag or the words, and says when it can't tell", () => {
    expect(workStyleOf(posting({ remote: true }))).toBe("remote");
    expect(workStyleOf(posting({ description: "This role is fully remote." }))).toBe("remote");
    expect(workStyleOf(posting({ remote: false }))).toBe("onsite");
    expect(workStyleOf(posting({ description: "Work on-site at our plant." }))).toBe("onsite");
    expect(workStyleOf(posting())).toBeNull();
  });
});

describe("pay", () => {
  it("reads a yearly range from the source, or from the posting's words, hourly rates made yearly", () => {
    expect(payOf(posting({ salary: "USD 120,000–150,000 a year" }))).toEqual({ low: 120_000, high: 150_000 });
    expect(payOf(posting({ description: "The pay range is $130K - $160K plus bonus." }))).toEqual({ low: 130_000, high: 160_000 });
    expect(payOf(posting({ salary: "$55–$65 an hour" }))).toEqual({ low: 114_400, high: 135_200 });
    expect(payOf(posting({ description: "We have 401k matching and 3 offices." }))).toBeNull();
    expect(payOf(posting({ description: "Up to $52,000 in tuition help. The salary range is $135,150 - $182,850." }))).toEqual({ low: 135_150, high: 182_850 });
    expect(payOf(posting({ description: "Raised $20,000,000 last year." }))).toBeNull();
  });
  it("rises across your range, and below your lowest falls but never to nothing", () => {
    const range = prefs.pay;
    expect(payShare({ low: 140_000, high: 160_000 }, range)).toBe(100);
    expect(payShare({ low: 100_000, high: 130_000 }, range)).toBe(85);
    expect(payShare({ low: 90_000, high: 110_000 }, range)).toBe(70);
    expect(payShare({ low: 80_000, high: 99_000 }, range)).toBe(55);
    expect(payShare({ low: 40_000, high: 50_000 }, range)).toBe(PAY_FLOOR);
  });
});

describe("distance and ruling out", () => {
  it("measures miles between points", () => {
    expect(Math.round(milesBetween(fairfax, dc))).toBe(15);
  });
  it("gives remote jobs all the distance points, and closer ones more", () => {
    const place = { ...prefs.place, zip: "22030" };
    expect(placeShare({ style: "remote", pay: null, miles: 600 }, place)).toBe(100);
    expect(placeShare({ style: "onsite", pay: null, miles: 15 }, place)).toBe(80);
    expect(placeShare({ style: "hybrid", pay: null, miles: 50 }, place)).toBe(20);
    expect(placeShare({ style: "hybrid", pay: null, miles: null }, place)).toBe(place.unknown);
  });
  it("sets aside a hybrid or on-site job too far away, but not a remote one or one it can't place", () => {
    const set = { ...prefs, place: { ...prefs.place, zip: "22030" } };
    const far = posting({ remote: false, ...chicago });
    expect(ruledOut(far, factsOf(far, fairfax), set)).toEqual({ rule: "within 30 miles", note: expect.stringMatching(/^On-site, about \d+ miles from 22030$/) });
    const remote = posting({ remote: true, ...chicago });
    expect(ruledOut(remote, factsOf(remote, fairfax), set)).toBeNull();
    const unsure = posting({ ...chicago });
    expect(ruledOut(unsure, factsOf(unsure, fairfax), set)).toBeNull();
    expect(ruledOut(far, factsOf(far, fairfax), { ...set, place: { ...set.place, ruleOutFar: false } })).toBeNull();
  });
  it("rules out by your words as whole words, in any case", () => {
    expect(ruleOutWord(posting({ description: "Requires an active TS/SCI clearance." }), ["ts/sci"])).toBe("ts/sci");
    expect(ruleOutWord(posting({ description: "Commission only, uncapped." }), ["commission  only"])).toBe("commission  only");
    expect(ruleOutWord(posting({ description: "Our clearances team" }), ["clearance"])).toBeNull();
  });
});

describe("the score", () => {
  it("adds the AI's fit to your settings' points", () => {
    const facts = { style: "hybrid" as const, pay: { low: 120_000, high: 150_000 }, miles: 15 };
    const { score, breakdown } = rubricScore([], 80, [], { fitPoints: prefs.fitPoints, lines: prefLines(facts, prefs) });
    // Fit 48 of 60, hybrid 14 of 20, pay 15 of 15, distance 4 of 5.
    expect(breakdown.map((line) => [line.label, line.earned, line.points])).toEqual([
      ["How well it fits your profile", 48, 60],
      ["Work style: Hybrid", 14, 20],
      ["Pay: $120k–$150k a year", 15, 15],
      ["Distance: about 15 miles", 4, 5],
    ]);
    expect(score).toBe(81);
  });
  it("knows the best a job could reach before the AI, counting what code can't tell as its best", () => {
    expect(bestPossible({ style: "onsite", pay: { low: 60_000, high: 70_000 }, miles: 20 }, prefs, 0)).toBe(73);
    expect(bestPossible({ style: null, pay: null, miles: null }, prefs, 0)).toBe(100);
  });
});
