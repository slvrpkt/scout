import { describe, expect, it } from "vitest";

import { centersInUse, costOfTokens, DEFAULT_COST_LIMITS, dollars, limitsPassed, overLimitBlock, overLimitText, resumesOn } from "./cost-rates";

describe("costOfTokens", () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 };

  it("adds up each kind of token at its price", () => {
    expect(costOfTokens("claude-haiku-5-5", usage)).toBeCloseTo(0.1 + 0.5 + 0.125 + 0.01);
  });

  it("is half that in a batch", () => {
    expect(costOfTokens("claude-haiku-5-5", usage, { batch: true })).toBeCloseTo(0.3675);
  });

  it("takes the higher price for a model it doesn't know", () => {
    expect(costOfTokens("some-new-model", { input_tokens: 1_000_000, output_tokens: 0 })).toBe(1);
  });
});

describe("limitsPassed", () => {
  const empty = { ANTHROPIC: 0, OPENAI: 0, MISTRAL: 0, LOCAL_AI: 0, TYPESAFE: 0, JSEARCH: 0, ADZUNA: 0, FREEHIRE: 0, ARBEITSAGENTUR: 0 };
  const totals = { day: { ...empty, ANTHROPIC: 2, JSEARCH: 0.1 }, week: { ...empty, ANTHROPIC: 9 }, month: { ...empty, ANTHROPIC: 16, JSEARCH: 3 } };

  it("finds the limits reached, by day, week and month", () => {
    expect(limitsPassed({ ANTHROPIC: { day: 5, week: 8, month: 15 } }, totals)).toEqual([
      { center: "ANTHROPIC", period: "week", limit: 8, spent: 9 },
      { center: "ANTHROPIC", period: "month", limit: 15, spent: 16 },
    ]);
  });

  it("leaves services without a limit alone", () => {
    expect(limitsPassed({ ANTHROPIC: { day: null, month: null } }, totals)).toEqual([]);
  });

  it("words it", () => {
    expect(overLimitText({ center: "JSEARCH", period: "week", limit: 1, spent: 1.2 })).toBe("JSearch (job search) has reached $1.20 this week, past your limit of $1.00. Job searches are paused.");
    expect(dollars(0.004)).toBe("under $0.01");
  });
});

describe("centersInUse", () => {
  const spent = { ANTHROPIC: 0, OPENAI: 2, MISTRAL: 0, LOCAL_AI: 0, TYPESAFE: 0, JSEARCH: 0, ADZUNA: 0, FREEHIRE: 0, ARBEITSAGENTUR: 0 };

  it("lists what's chosen and what's cost something, and nothing else", () => {
    expect(centersInUse(["ANTHROPIC", "JSEARCH", null], spent)).toEqual(["ANTHROPIC", "OPENAI", "JSEARCH"]);
  });
});

describe("the limits every install starts with, and the alert when one is passed", () => {
  it("starts with JSearch and hosted AI capped, and free services not", () => {
    expect(DEFAULT_COST_LIMITS.JSEARCH).toEqual({ day: 0.3, week: 1.5, month: 6 });
    expect(DEFAULT_COST_LIMITS.ANTHROPIC).toEqual({ day: 1, week: 5, month: 15 });
    expect(DEFAULT_COST_LIMITS.LOCAL_AI).toBeUndefined();
  });

  // Wednesday 12 November 2026, 3 PM in New York.
  const now = new Date("2026-11-12T20:00:00Z");
  it("says when each period's limit lets work carry on", () => {
    expect(resumesOn("day", now, "America/New_York")).toBe("tomorrow (Fri, Nov 13)");
    expect(resumesOn("week", now, "America/New_York")).toBe("next Monday (Mon, Nov 16)");
    expect(resumesOn("month", now, "America/New_York")).toBe("December 1");
  });

  it("shows the limit and what's used, and what's paused until when", () => {
    const block = overLimitBlock({ center: "JSEARCH", period: "day", limit: 0.3, spent: 0.31 }, now, "America/New_York");
    expect(block.title).toBe("JSearch (job search): daily limit reached");
    expect(block.amounts).toBe("Your limit: $0.30 a day · Used today: $0.31");
    expect(block.paused).toBe("Job searches are paused until tomorrow (Fri, Nov 13). Raise the limit in Settings → Estimated cost to carry on now.");
  });
});
