import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
const fake = vi.hoisted(() => ({ sent: [] as unknown[] }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  getAiProvider: async () => ({
    kind: "ANTHROPIC",
    model: "m",
    listModels: async () => [],
    test: async () => ({ model: "m", latencyMs: 1 }),
    complete: async () => ({ score: 90, reasons: ["Fits."], redFlags: [] }),
    sendBatch: async (items: unknown[]) => {
      fake.sent.push(...items);
      return "batch-1";
    },
  }),
}));
vi.mock("@/lib/ai/config", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/ai/config")>()), isAiConfigured: async () => true }));

const { enqueue, SCORE_WAIT_MS, startDueScoring } = await import("./score-queue");
const { loadSettings, saveSettings } = await import("@/lib/settings-data");

const prisma = () => db.client!;
const now = new Date("2026-11-07T04:30:00Z");
const posting = (id: string) => ({ source: "JSEARCH", externalId: id, title: "Agile Lead", company: `Acme ${id}`, place: "Austin", remote: false, salary: "", postedAt: "2026-11-07T00:00:00Z", url: `https://acme.example/${id}`, via: "", description: "A job.", complete: true }) as never;

beforeEach(async () => {
  await resetDatabase(prisma());
  fake.sent.length = 0;
  await saveSettings({ agentTimes: ["04:00"], agentShares: [100], agentDailyScores: 400, agentScoreAt: new Date(now.getTime() - 1000).toISOString() });
  await enqueue([{ posting: posting("1"), searchId: "s1", rules: [] }], now);
});
afterAll(() => prisma().$disconnect());

describe("waiting for the search before scoring", () => {
  it("does nothing before its time", async () => {
    await saveSettings({ agentScoreAt: new Date(now.getTime() + 1000).toISOString() });
    expect(await startDueScoring(now, "UTC", false)).toBe(0);
    expect(fake.sent).toHaveLength(0);
  });

  it("waits another half hour while the search is still running", async () => {
    expect(await startDueScoring(now, "UTC", true)).toBe(0);
    expect(fake.sent).toHaveLength(0);
    expect((await loadSettings()).agentScoreAt).toBe(new Date(now.getTime() + SCORE_WAIT_MS).toISOString());
  });

  it("sends what's waiting as a batch once the search is done", async () => {
    expect(await startDueScoring(now, "UTC", false)).toBe(1);
    expect(fake.sent).toHaveLength(1);
    expect(await loadSettings()).toMatchObject({ agentBatchId: "batch-1", agentScoreAt: null });
  });
});
