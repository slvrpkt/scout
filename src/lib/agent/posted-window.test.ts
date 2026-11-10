import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { postedWindow } from "./run";

const now = new Date("2026-11-10T13:00:00Z");
const hours = (count: number) => new Date(now.getTime() - count * 60 * 60 * 1000);

describe("how far back an agent search looks", () => {
  it("72 hours on its first run, then only what's new since the last run", () => {
    expect(postedWindow({ createdAt: hours(1), lastRunAt: null }, now)).toBe("3days");
    // A day old, run this morning: new since then, not 72 hours again.
    expect(postedWindow({ createdAt: hours(30), lastRunAt: hours(5) }, now)).toBe("day");
  });

  it("72 hours again after a gap of more than a day, so nothing posted meanwhile is missed", () => {
    expect(postedWindow({ createdAt: hours(200), lastRunAt: hours(40) }, now)).toBe("3days");
  });
});
