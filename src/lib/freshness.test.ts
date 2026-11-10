import { describe, expect, it } from "vitest";

import { freshFirst, freshLabel, withoutStaleBonus } from "./freshness";

const now = new Date("2026-11-09T18:00:00.000Z");

describe("freshly posted", () => {
  it("says how many hours ago, within the window", () => {
    expect(freshLabel("2026-11-09T15:00:00.000Z", now, 12)).toBe("Posted 3 hours ago");
    expect(freshLabel("2026-11-09T17:30:00.000Z", now, 12)).toBe("Posted under an hour ago");
    expect(freshLabel("2026-11-09T17:00:00.000Z", now, 12)).toBe("Posted 1 hour ago");
    expect(freshLabel("2026-11-09T05:00:00.000Z", now, 12)).toBeNull();
  });

  it("with only the date, says Posted today on that day", () => {
    expect(freshLabel("2026-11-09T00:00:00.000Z", now, 12)).toBe("Posted today");
    expect(freshLabel("2026-11-08T00:00:00.000Z", now, 12)).toBeNull();
  });

  it("says nothing when it's off or unknown", () => {
    expect(freshLabel("2026-11-09T15:00:00.000Z", now, 0)).toBeNull();
    expect(freshLabel(null, now, 12)).toBeNull();
  });

  it("lists fresh ones first, then by score", () => {
    const items = [{ id: "a", score: 90 }, { id: "b", score: 60, fresh: "Posted today" }, { id: "c", score: 70, fresh: "Posted 2 hours ago" }];
    expect(freshFirst(items).map((item) => item.id)).toEqual(["c", "b", "a"]);
  });
});

describe("withoutStaleBonus", () => {
  const now = new Date("2026-11-10T15:00:00Z");
  const scored = { score: 80, reasons: ["Strong delivery background.", "Posted 2 hours ago: +5 for applying early."] };
  it("keeps the bonus while the posting is fresh", () => {
    expect(withoutStaleBonus(scored, "2026-11-10T08:00:00Z", now, 12)).toEqual(scored);
  });
  it("takes off exactly the bonus, and its reason, once it's past the window", () => {
    expect(withoutStaleBonus(scored, "2026-11-10T01:00:00Z", now, 12)).toEqual({ score: 75, reasons: ["Strong delivery background."] });
  });
  it("leaves a score that never had the bonus as it is", () => {
    const plain = { score: 70, reasons: ["Good fit."] };
    expect(withoutStaleBonus(plain, "2026-11-01T01:00:00Z", now, 12)).toBe(plain);
  });
});
