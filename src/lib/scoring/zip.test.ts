import { describe, expect, it } from "vitest";

import { milesBetween } from "./preferences";
import { hasZipTable, zipNoteOf, zipPoint } from "./zip";

describe("ZIP codes", () => {
  it("finds a ZIP code's place on the map, in the app", async () => {
    expect(await hasZipTable()).toBe(true);
    const fairfax = await zipPoint("22030");
    const manhattan = await zipPoint("10001");
    expect(fairfax && manhattan && Math.round(milesBetween(fairfax, manhattan) / 10) * 10).toBe(220);
    expect(await zipPoint("00000")).toBeNull();
  });
  it("says why distance can't be measured, or nothing", async () => {
    expect(await zipNoteOf("22030")).toBeNull();
    expect(await zipNoteOf("")).toMatch(/Add your ZIP code/);
    expect(await zipNoteOf("00000")).toMatch(/isn't a ZIP code Scout knows/);
  });
});
