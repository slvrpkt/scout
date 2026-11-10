import { describe, expect, it } from "vitest";

import { fitsOnePage, wordsIn, wordsToAim } from "./letter-fit";

describe("fitting a cover letter", () => {
  it("is fine on one page up to 85% full", () => {
    expect(fitsOnePage({ pages: 1, fill: 0.75 })).toBe(true);
    expect(fitsOnePage({ pages: 1, fill: 0.86 })).toBe(false);
    expect(fitsOnePage({ pages: 2, fill: 0.1 })).toBe(false);
  });

  it("aims for three quarters of the page, however far over it is", () => {
    expect(wordsToAim(300, { pages: 1, fill: 1 })).toBe(225);
    expect(wordsToAim(400, { pages: 2, fill: 0.25 })).toBe(240);
    expect(wordsToAim(130, { pages: 2, fill: 0.9 })).toBe(120);
  });

  it("counts the paragraphs, not the address or the sign-off", () => {
    expect(wordsIn([{ id: "sender", text: "Name and address" }, { id: "paragraph:1", text: "Two words" }, { id: "sign-off", text: "Warm regards," }])).toBe(2);
  });
});
