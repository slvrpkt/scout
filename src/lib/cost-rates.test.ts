import { describe, expect, it } from "vitest";

import { centersInUse, costOfTokens, dollars, limitsPassed, overLimitText } from "./cost-rates";

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
