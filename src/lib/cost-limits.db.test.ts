import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
vi.mock("@/lib/time-zone", () => ({ lastKnownTimeZone: async () => "UTC" }));

const { AnthropicProvider } = await import("./ai/providers/anthropic");
const { jsearch } = await import("./job-search/jsearch");
const { costLimitsPassed, limitReached, loadCosts } = await import("./costs");
const { saveSettings } = await import("./settings-data");

const prisma = () => db.client!;
const spend = (center: string, amount: number, at = new Date()) => prisma().costEvent.create({ data: { center, kind: "test", amount, at } });

/** Writes a resume through Anthropic, as every AI task does. */
function writing() {
  const provider = new AnthropicProvider("https://api.anthropic.com", "key", "claude-haiku-5-5", 1000);
  const chat = vi.spyOn(provider as unknown as { chat: () => Promise<unknown> }, "chat").mockResolvedValue({ text: "A resume.", cutOff: false });
  return { run: () => provider.complete({ system: "Write", messages: [{ role: "user", content: "Go" }] }), chat };
}

const search = () => jsearch.search({ keywords: "pm", place: "", country: "us", radiusKm: 25, remoteOnly: false, postedWithin: "any" }, { key: "k", host: "openwebninja" } as never, null, {});

beforeEach(async () => {
  await resetDatabase(prisma());
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { jobs: [] } }), { status: 200 })));
});
afterAll(() => prisma().$disconnect());

describe("cost limits", () => {
  it("stops resume writing past the AI limit, without sending anything", async () => {
    await spend("ANTHROPIC", 6);
    await saveSettings({ costLimits: { ANTHROPIC: { day: 5 } } });
    const { run, chat } = writing();
    await expect(run()).rejects.toThrow(/Anthropic \(AI\) has reached \$6\.00 today/);
    expect(chat).not.toHaveBeenCalled();
  });

  it("stops job searches past their limit, without calling the source", async () => {
    await spend("JSEARCH", 2);
    await saveSettings({ costLimits: { JSEARCH: { day: 1 } } });
    await expect(search()).rejects.toThrow(/JSearch \(job search\) has reached \$2\.00 today/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("leaves resume writing alone when only the job search limit is passed", async () => {
    await spend("JSEARCH", 2);
    await saveSettings({ costLimits: { JSEARCH: { day: 1 } } });
    await expect(writing().run()).resolves.toBe("A resume.");
  });

  it("leaves job searches alone when only the AI limit is passed", async () => {
    await spend("ANTHROPIC", 6);
    await saveSettings({ costLimits: { ANTHROPIC: { day: 5 } } });
    await expect(search()).resolves.toMatchObject({ postings: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("unlocks as soon as the limit is raised", async () => {
    await spend("ANTHROPIC", 6);
    await saveSettings({ costLimits: { ANTHROPIC: { month: 5 } } });
    await expect(writing().run()).rejects.toThrow(/this month/);
    await saveSettings({ costLimits: { ANTHROPIC: { month: 20 } } });
    await expect(writing().run()).resolves.toBe("A resume.");
  });

  it("counts a calendar week, Monday to Sunday, not the last 7 days", async () => {
    const limits = { ANTHROPIC: { week: 5 } };
    // Tuesday 3 Nov: last Sunday is outside this week, though it's only 2 days back.
    const now = new Date("2026-11-03T12:00:00Z");
    await spend("ANTHROPIC", 6, new Date("2026-11-01T12:00:00Z"));
    expect(await costLimitsPassed(limits, now, "UTC")).toEqual([]);
    await spend("ANTHROPIC", 6, new Date("2026-11-02T12:00:00Z"));
    expect(await costLimitsPassed(limits, now, "UTC")).toMatchObject([{ period: "week", spent: 6 }]);
  });

  it("counts a calendar month, from the 1st", async () => {
    const limits = { ANTHROPIC: { month: 5 } };
    const now = new Date("2026-11-03T12:00:00Z");
    await spend("ANTHROPIC", 6, new Date("2026-10-31T12:00:00Z"));
    expect(await costLimitsPassed(limits, now, "UTC")).toEqual([]);
    await spend("ANTHROPIC", 6, new Date("2026-11-01T00:30:00Z"));
    expect(await costLimitsPassed(limits, now, "UTC")).toMatchObject([{ period: "month", spent: 6 }]);
  });

  it("has no limit reached for a service that's free", async () => {
    expect(await limitReached(null)).toBeNull();
  });

  it("adds up each period for the filter", async () => {
    const now = new Date("2026-11-20T12:00:00Z");
    await spend("JSEARCH", 1, new Date("2026-11-19T12:00:00Z"));
    await spend("JSEARCH", 2, new Date("2026-09-15T12:00:00Z"));
    await spend("JSEARCH", 4, new Date("2026-06-15T12:00:00Z"));
    await spend("JSEARCH", 8, new Date("2026-01-15T12:00:00Z"));
    const { periods } = await loadCosts(now, "UTC");
    expect(Object.fromEntries(Object.entries(periods).map(([period, amounts]) => [period, amounts.JSEARCH]))).toEqual({ today: 0, week: 1, month: 1, months3: 3, months6: 7, all: 15 });
  });
});
