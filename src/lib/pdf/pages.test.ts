import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { countPdfPages } from "./pages";

const pdf = async (pages: number, useObjectStreams: boolean) => {
  const doc = await PDFDocument.create();
  for (let page = 0; page < pages; page++) doc.addPage();
  return doc.save({ useObjectStreams });
};

describe("counting a PDF's pages", () => {
  it("counts plain page objects, as Chromium and render.ts write them", async () => {
    expect(countPdfPages(await pdf(3, false))).toBe(3);
  });

  it("never reads a PDF it can't count as fitting: compressed pages count as too many, not none", async () => {
    // A resume over its page limit was believed to fit when this came back 0.
    expect(countPdfPages(await pdf(3, true))).toBeGreaterThan(100);
  });
});
