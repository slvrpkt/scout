import { describe, expect, it } from "vitest";

import type { ArchiveRow } from "@/lib/archive-data";

import { weekStart, weeklyCounts, WEEKS } from "./archive-charts";

const row = (archivedAt: Date): ArchiveRow => ({
  kind: "posting",
  id: archivedAt.toISOString(),
  archivedAt: archivedAt.toISOString(),
  title: "Job",
  company: "",
  location: "",
  salary: "",
  pay: null,
  score: null,
  why: "distance",
  note: "",
  foundBy: null,
  href: "",
});

describe("weeks for the Archive's bar chart", () => {
  it("run Monday to Sunday", () => {
    // Wed 11 Nov 2026 and Sun 15 Nov 2026 are in the week of Mon 9 Nov; Mon 16 Nov starts the next.
    expect(weekStart(new Date(2026, 10, 11, 15)).getDate()).toBe(9);
    expect(weekStart(new Date(2026, 10, 15, 23)).getDate()).toBe(9);
    expect(weekStart(new Date(2026, 10, 16, 0, 30)).getDate()).toBe(16);
    expect(weekStart(new Date(2026, 10, 9)).getDay()).toBe(1);
  });

  it("counts each week's archived records, the latest week last", () => {
    const now = new Date(2026, 10, 11, 12);
    const weeks = weeklyCounts(
      [
        row(new Date(2026, 10, 9, 8)),
        row(new Date(2026, 10, 15, 22)),
        row(new Date(2026, 10, 8, 22)),
        row(new Date(2025, 0, 1)),
      ],
      now,
    );
    expect(weeks).toHaveLength(WEEKS);
    expect(weeks.at(-1)).toMatchObject({ count: 2 });
    expect(weeks.at(-2)).toMatchObject({ count: 1 });
    expect(weeks.reduce((sum, week) => sum + week.count, 0)).toBe(3);
  });
});
