import { describe, expect, it } from "vitest";

import { looksCutShort, SHORT_POSTING_CHARS, shortPostingWarning } from "./posting-length";

describe("a job description cut short", () => {
  it("is one under the threshold, but not an empty one", () => {
    expect(looksCutShort("x".repeat(596))).toBe(true);
    expect(looksCutShort("x".repeat(SHORT_POSTING_CHARS))).toBe(false);
    expect(looksCutShort("   ")).toBe(false);
  });

  it("is said in one short line", () => {
    expect(shortPostingWarning(` ${"x".repeat(1150)} `)).toBe("Warning: this job description seems too short, only 1,150 characters.");
  });
});
