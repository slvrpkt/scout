import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { countAgentQueue, loadAgentView } from "./view";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
// Settings → Scoring reads DOSSIER_SCORER (#274).
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
vi.mock("@/lib/time-zone", () => ({ lastKnownTimeZone: async () => "Europe/Berlin" }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => true }));
vi.mock("@/lib/job-search/config", () => ({
  loadJobSearchConfig: async () => ({ source: "JSEARCH", saved: true, jsearch: { key: "k", host: "openwebninja", keyState: "set" }, adzuna: { appId: "", key: null, keyState: "none" } }),
  credentialsFor: () => ({ key: "k", host: "openwebninja" }),
}));

const prisma = () => db.client!;
const now = new Date("2026-10-20T10:00:00Z");
const candidate = (externalId: string, score: number, data: Record<string, unknown> = {}) =>
  prisma().agentCandidate.create({ data: { source: "JSEARCH", externalId, dedupeKey: externalId, title: `Posting ${externalId}`, company: "Ledgerly", place: "Berlin", remote: true, score, via: "LinkedIn", postedAt: new Date("2026-10-18T00:00:00Z"), ...data } });

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().agentSearch.create({
    data: { id: "search-1", name: "Data scientist", query: { keywords: "Data scientist", place: "Berlin", country: "de", radiusKm: 25, remoteOnly: false, postedWithin: "any" }, lastMessage: "12 postings found, 3 new." },
  });
  await saveSettings({
    agentEnabled: true,
    agentTimes: ["07:00"],
    agentRuns: [{ at: "2026-10-20T05:00:00Z", manual: false, message: "2 new postings are waiting for a look." }],
  });
});
afterAll(() => prisma().$disconnect());

describe("the Agent screen's data (E16-6)", () => {
  it("splits the queue into drafts, scored postings and those below the minimum, best first", async () => {
    const application = await prisma().application.create({ data: { origin: "AGENT", awaitingReview: true } });
    await candidate("draft", 90, { status: "DRAFTED", applicationId: application.id });
    const good = await candidate("good", 75);
    await candidate("better", 88);
    await candidate("low", 30);
    await candidate("gone", 95, { status: "DISMISSED" });
    await candidate("kept", 95, { status: "APPROVED" });
    const job = await prisma().job.create({ data: { type: "agent-draft", key: `agent-candidate:${good.id}`, input: { candidateId: good.id } } });

    const view = await loadAgentView(now);
    expect(view.drafts.map((entry) => entry.title)).toEqual(["Posting draft"]);
    expect(view.scored.map((entry) => entry.title)).toEqual(["Posting better", "Posting good"]);
    expect(view.belowMinimum.map((entry) => entry.title)).toEqual(["Posting low"]);
    expect(view.scored[1]).toMatchObject({ facts: "Berlin · Remote", origin: "via LinkedIn on JSearch", postedOn: expect.any(String), foundOn: expect.any(String), draftJobId: job.id });
    expect(view).toMatchObject({
      searches: [{ id: "search-1", line: "Data scientist · Berlin, 15 miles · via JSearch", enabled: true, lastMessage: "12 postings found, 3 new." }],
      setupProblem: null,
      limitReached: false,
      lastRun: { at: "Tue 20 Oct, 7:00 AM", message: "2 new postings are waiting for a look." },
      nextRun: "Wed 21 Oct, 7:00 AM",
    });
    // The badge: the drafts waiting for review, nothing else.
    expect(await countAgentQueue()).toBe(1);
  });

  it("says what's missing, and when the day's runs are used up", async () => {
    await prisma().agentSearch.deleteMany();
    await saveSettings({
      agentEnabled: false,
      agentRuns: ["09:30", "08:00", "06:00"].map((time) => ({ at: `2026-10-20T${time}:00Z`, manual: true, message: null })),
    });
    expect(await loadAgentView(now)).toMatchObject({
      enabled: false,
      searches: [],
      setupProblem: "Add what to look for in Settings → Job agent first.",
      setupSection: "agent",
      limitReached: true,
      nextRun: null,
    });
  });
});
