import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { weekdaysBack } from "./redo-drafts";

const day = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()];

describe("redoing drafts after a profile change", () => {
  it("covers the last 2 weekdays, weekends not counted", () => {
    // Wednesday 11 Nov 2026: Tuesday and Wednesday.
    expect(day(weekdaysBack(new Date(2026, 10, 11, 15), 2))).toEqual([2026, 11, 10]);
    // Monday 16 Nov: Friday and Monday.
    expect(day(weekdaysBack(new Date(2026, 10, 16, 9), 2))).toEqual([2026, 11, 13]);
    // Sunday 15 Nov: Thursday and Friday.
    expect(day(weekdaysBack(new Date(2026, 10, 15, 9), 2))).toEqual([2026, 11, 12]);
  });
});
