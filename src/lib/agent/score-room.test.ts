import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings-data", () => ({ loadSettings: vi.fn(), saveSettings: vi.fn() }));

const { scoreRoom } = await import("./runs");

const day = { timeZone: "UTC", times: ["04:00", "08:30", "13:00"], shares: [100, 200, 100], daily: 400 };
const at = (time: string) => new Date(`2026-11-07T${time}:00Z`);

describe("scoreRoom", () => {
  it("gives each run time its share", () => {
    expect(scoreRoom({ ...day, now: at("04:05"), scored: 0 })).toBe(100);
    expect(scoreRoom({ ...day, now: at("08:35"), scored: 100 })).toBe(200);
    expect(scoreRoom({ ...day, now: at("13:05"), scored: 300 })).toBe(100);
  });

  it("carries what a run didn't use on to the next", () => {
    expect(scoreRoom({ ...day, now: at("08:35"), scored: 40 })).toBe(260);
  });

  it("has nothing left once the share so far is used, and never passes the day's budget", () => {
    expect(scoreRoom({ ...day, now: at("07:00"), scored: 100 })).toBe(0);
    expect(scoreRoom({ ...day, now: at("13:05"), daily: 300, scored: 290 })).toBe(10);
  });

  it("gives a Run now before the first time that time's share", () => {
    expect(scoreRoom({ ...day, now: at("02:00"), scored: 0 })).toBe(100);
  });

  it("splits evenly with no shares set", () => {
    expect(scoreRoom({ ...day, shares: [], daily: 150, now: at("04:05"), scored: 0 })).toBe(50);
  });

  it("keeps your shares when run times change: an added time gets none", () => {
    expect(scoreRoom({ ...day, times: ["04:00", "08:30", "13:00", "18:00"], now: at("19:00"), scored: 400 })).toBe(0);
    expect(scoreRoom({ ...day, times: ["04:00", "08:30"], now: at("09:00"), scored: 0 })).toBe(300);
  });
});
