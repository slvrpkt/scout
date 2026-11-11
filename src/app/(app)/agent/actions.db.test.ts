import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchQuery } from "@/lib/job-search/search";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { setStatus } from "@/lib/status-actions";
import { createTestClient, resetDatabase } from "@/test/db";

import { addAgentSearch, changeAgentSearch, dismissAgentCandidate, prepareAgentDraft, removeAgentSearch, restoreAgentCandidate, runAgentNow, saveAgentSettings } from "./actions";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
// Settings → Scoring reads DOSSIER_SCORER (#274).
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/jobs/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/runner")>()),
  startJob: vi.fn(async () => "new-run"),
}));
const setup = vi.hoisted(() => ({ ai: true, source: "JSEARCH" as "JSEARCH" | null }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => setup.ai }));
vi.mock("@/lib/job-search/config", () => ({
  loadJobSearchConfig: async () => ({ source: setup.source, saved: true, jsearch: { key: "k", host: "openwebninja", keyState: "set" }, adzuna: { appId: "", key: null, keyState: "none" } }),
  credentialsFor: () => ({ key: "k", host: "openwebninja" }),
  requestContext: () => ({}),
}));

const prisma = () => db.client!;
const candidate = (data: { status?: "SCORED" | "DRAFTED" | "DRAFTING"; applicationId?: string } = {}) =>
  prisma().agentCandidate.create({
    data: { source: "JSEARCH", externalId: `job-${Math.random()}`, dedupeKey: `key-${Math.random()}`, title: "Data Scientist", company: "Ledgerly", url: "https://jobs.example/1", score: 88, reasons: ["Python"], ...data },
  });
const query: SearchQuery = { keywords: "Data scientist", place: "", country: "de", radiusKm: 25, remoteOnly: false, postedWithin: "any" };
/** Replaces the agent's saved searches with these, in order. */
const setSearches = async (...queries: SearchQuery[]) => {
  await prisma().agentSearch.deleteMany();
  for (const [position, query] of queries.entries()) await prisma().agentSearch.create({ data: { name: query.keywords.trim() || "New search", query, position } });
};


beforeEach(async () => {
  Object.assign(setup, { ai: true, source: "JSEARCH" });
  await resetDatabase(prisma());
  // One run a day, as the limit tests expect: 3 in any 24 hours.
  await saveSettings({ agentEnabled: true, agentTimes: ["07:00"] });
  await setSearches(query);
});
afterAll(() => prisma().$disconnect());

describe("Run now (E16-4)", () => {
  it("starts a run, keyed so the schedule and the screen find it", async () => {
    const { startJob } = await import("@/lib/jobs/runner");
    expect(await runAgentNow({})).toEqual({ ok: true, data: { jobId: "new-run", reused: false } });
    expect(startJob).toHaveBeenLastCalledWith(expect.objectContaining({ type: "agent-scan" }), { manual: true }, { key: "agent" });
  });

  it("reuses a run that's queued or running", async () => {
    const running = await prisma().job.create({ data: { type: "agent-scan", key: "agent", status: "RUNNING", input: { manual: false } } });
    expect(await runAgentNow({})).toEqual({ ok: true, data: { jobId: running.id, reused: true } });
  });

  it("says what's missing before it starts", async () => {
    await saveSettings({ agentEnabled: false });
    expect(await runAgentNow({})).toEqual({ ok: false, error: "Turn the job agent on in Settings → Job agent first." });
    await saveSettings({ agentEnabled: true });
    await setSearches({ ...query, keywords: "" });
    expect(await runAgentNow({})).toMatchObject({ ok: false, error: "Add what to look for in Settings → Job agent first." });
    await setSearches(query);
    setup.ai = false;
    expect(await runAgentNow({})).toMatchObject({ ok: false, error: "Choose an AI provider in Settings → AI provider first." });
    setup.ai = true;
    setup.source = null;
    expect(await runAgentNow({})).toMatchObject({ ok: false, error: "Choose a job source in Settings → Job search first." });
  });

  it("waits an hour after the previous run, and keeps to 3 a day", async () => {
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
    await saveSettings({ agentRuns: [{ at: at(20), manual: false, message: null }] });
    expect(await runAgentNow({})).toEqual({ ok: false, error: "The agent ran less than an hour ago. Try again in 40 minutes." });
    await saveSettings({ agentRuns: [at(70), at(200), at(400)].map((time) => ({ at: time, manual: true, message: null })) });
    expect(await runAgentNow({})).toMatchObject({ ok: false, error: expect.stringMatching(/^The agent has run 3 times in the past 24 hours/) });
  });
});

describe("the drafts' actions (E16-5)", () => {
  it("prepares a draft in its own job, reuses one under way, and answers with one already made", async () => {
    const { startJob } = await import("@/lib/jobs/runner");
    const scored = await candidate();
    expect(await prepareAgentDraft({ candidateId: scored.id })).toEqual({ ok: true, data: { jobId: "new-run", applicationId: null } });
    expect(startJob).toHaveBeenLastCalledWith(expect.objectContaining({ type: "agent-draft" }), { candidateId: scored.id }, { key: `agent-candidate:${scored.id}` });

    const queued = await prisma().job.create({ data: { type: "agent-draft", key: `agent-candidate:${scored.id}`, input: { candidateId: scored.id } } });
    expect(await prepareAgentDraft({ candidateId: scored.id })).toEqual({ ok: true, data: { jobId: queued.id, applicationId: null } });

    const application = await prisma().application.create({ data: { origin: "AGENT", awaitingReview: true } });
    const drafted = await candidate({ status: "DRAFTED", applicationId: application.id });
    expect(await prepareAgentDraft({ candidateId: drafted.id })).toEqual({ ok: true, data: { jobId: null, applicationId: application.id } });
    expect(await prepareAgentDraft({ candidateId: "gone" })).toEqual({ ok: false, error: "That posting is no longer in the agent's queue." });
  });

  it("archives a posting, keeping it whole, and puts it back", async () => {
    const scored = await candidate();
    expect(await dismissAgentCandidate({ candidateId: scored.id })).toEqual({ ok: true, data: { archivedApplicationId: null } });
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id: scored.id } })).toMatchObject({ status: "DISMISSED", url: "https://jobs.example/1", reasons: ["Python"] });
    expect(await restoreAgentCandidate({ id: scored.id })).toEqual({ ok: true, data: null });
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id: scored.id } })).toMatchObject({ status: "SCORED", url: "https://jobs.example/1", reasons: ["Python"] });
  });

  it("archives a draft into the Job application log instead of deleting it", async () => {
    const application = await prisma().application.create({ data: { origin: "AGENT", awaitingReview: true } });
    const drafted = await candidate({ status: "DRAFTED", applicationId: application.id });
    expect(await dismissAgentCandidate({ candidateId: drafted.id })).toEqual({ ok: true, data: { archivedApplicationId: application.id } });
    expect(await prisma().application.findUniqueOrThrow({ where: { id: application.id } })).toMatchObject({ awaitingReview: false, archivedAt: expect.any(Date) });
  });

  it("approves a draft waiting for review when its status moves on (#195)", async () => {
    const application = await prisma().application.create({ data: { origin: "AGENT", awaitingReview: true } });
    const drafted = await candidate({ status: "DRAFTED", applicationId: application.id });
    expect(await setStatus({ id: application.id, to: "SENT" })).toMatchObject({ ok: true });
    expect(await prisma().application.findUniqueOrThrow({ where: { id: application.id } })).toMatchObject({ status: "SENT", awaitingReview: false });
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id: drafted.id } })).toMatchObject({ status: "APPROVED" });
  });
});

describe("saving the agent's settings (E16-7)", () => {
  it("saves each change, and turns on only with a complete search that's on", async () => {
    await saveSettings({ agentEnabled: false });
    await setSearches({ ...query, keywords: "" }, { ...query, keywords: "Analyst", country: "" });
    const error = "Add a search with keywords and a country before turning the agent on.";
    expect(await saveAgentSettings({ enabled: true })).toEqual({ ok: false, error });
    const [first] = await prisma().agentSearch.findMany({ orderBy: { position: "asc" } });
    expect(await changeAgentSearch({ id: first.id, query, enabled: false })).toEqual({ ok: true, data: null });
    expect(await saveAgentSettings({ enabled: true })).toEqual({ ok: false, error });
    expect(await changeAgentSearch({ id: first.id, enabled: true })).toEqual({ ok: true, data: null });
    expect(await saveAgentSettings({ enabled: true })).toEqual({ ok: true, data: null });
    expect(await saveAgentSettings({ times: ["13:00", "04:00", "08:00"], minScore: 80, autoDraft: true, dailyDrafts: 50 })).toEqual({ ok: true, data: null });
    expect(await loadSettings()).toMatchObject({ agentEnabled: true, agentTimes: ["04:00", "08:00", "13:00"], agentMinScore: 80, agentAutoDraft: true, agentDailyDrafts: 50, agentDailyScores: 150 });
    expect(await saveAgentSettings({ dailyScores: 1001 })).toMatchObject({ ok: false });
  });

  it("remembers when it was switched on, and only then", async () => {
    await saveSettings({ agentEnabled: false, agentOnSince: null });
    const before = Date.now();
    expect(await saveAgentSettings({ enabled: true })).toEqual({ ok: true, data: null });
    const onSince = (await loadSettings()).agentOnSince;
    expect(Date.parse(onSince ?? "")).toBeGreaterThanOrEqual(before);
    // Saving other settings, or "on" again while it's on, keeps the time.
    expect(await saveAgentSettings({ enabled: true, minScore: 75 })).toEqual({ ok: true, data: null });
    expect((await loadSettings()).agentOnSince).toBe(onSince);
  });
});

describe("the agent's saved searches", () => {
  it("adds searches at the end, named by their keywords, up to 20", async () => {
    await setSearches();
    const added = await addAgentSearch({ query });
    expect(added).toMatchObject({ ok: true });
    await addAgentSearch({ query: { ...query, keywords: "  ML engineer " } });
    expect((await prisma().agentSearch.findMany({ orderBy: { position: "asc" } })).map((search) => [search.name, search.position])).toEqual([
      ["Data scientist", 0],
      ["ML engineer", 1],
    ]);
    for (let index = 2; index < 20; index++) await addAgentSearch({ query });
    expect(await addAgentSearch({ query })).toEqual({ ok: false, error: "The agent can keep 20 searches at most. Remove one first." });
  });

  it("renames a search with its keywords, and says when it's gone", async () => {
    const [search] = await prisma().agentSearch.findMany();
    expect(await changeAgentSearch({ id: search.id, query: { ...query, keywords: "Data engineer" } })).toEqual({ ok: true, data: null });
    expect(await prisma().agentSearch.findUniqueOrThrow({ where: { id: search.id } })).toMatchObject({ name: "Data engineer", query: { ...query, keywords: "Data engineer" } });
    expect(await changeAgentSearch({ id: "gone", enabled: false })).toEqual({ ok: false, error: "That search no longer exists." });
  });

  it("removes a search but keeps what it found", async () => {
    const [search] = await prisma().agentSearch.findMany();
    const found = await prisma().agentCandidate.create({
      data: { source: "JSEARCH", externalId: "x", dedupeKey: "x", title: "Data Scientist", score: 80, search: { connect: { id: search.id } } },
    });
    expect(await removeAgentSearch({ id: search.id })).toEqual({ ok: true, data: null });
    expect(await prisma().agentSearch.count()).toBe(0);
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id: found.id } })).toMatchObject({ searchId: null });
  });
});

describe("pages per saved search", () => {
  it("reads one page through JSearch and five through the others, unless changed", async () => {
    setup.source = "JSEARCH";
    const jsearch = await addAgentSearch({ query });
    setup.source = null;
    const other = await addAgentSearch({ query });
    expect(jsearch).toMatchObject({ ok: true, data: { maxPages: 1 } });
    expect(other).toMatchObject({ ok: true, data: { maxPages: 5 } });
    if (!jsearch.ok) return;
    expect(await changeAgentSearch({ id: jsearch.data.id, maxPages: 3 })).toEqual({ ok: true, data: null });
    expect(await prisma().agentSearch.findUniqueOrThrow({ where: { id: jsearch.data.id } })).toMatchObject({ maxPages: 3 });
    expect(await changeAgentSearch({ id: jsearch.data.id, maxPages: 6 })).toMatchObject({ ok: false });
  });
});
