import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../prisma/seed/built-ins";

import { loadSampleData, removeSampleData, SAMPLE_SETTING, sampleDataState } from "./sample-data";

const db = createTestClient();

beforeEach(async () => {
  await resetDatabase(db);
  await seedBuiltIns(db);
});
afterAll(() => db.$disconnect());

const now = new Date(Date.UTC(2026, 10, 3, 12));

describe("sample data", () => {
  it("fills in every part of Scout", async () => {
    expect(await sampleDataState(db)).toEqual({ loaded: false, loadedAt: null, canLoad: true, connected: false });
    // Once an LLM or a job source is connected, it stays off.
    expect(await sampleDataState(db, true)).toMatchObject({ canLoad: false, connected: true });
    expect(await loadSampleData(db, now, "Europe/Amsterdam")).toEqual({ applications: 12 });

    const applications = await db.application.findMany({ include: { documents: true, sentDocuments: true, notes: true } });
    expect(applications.every((application) => application.documents.some((document) => document.kind === "RESUME"))).toBe(true);
    expect(applications.filter((application) => application.sentAt).every((application) => application.sentDocuments.length >= 2)).toBe(true);
    expect(applications.find((application) => application.company === "Oaken Studio")!.notes.map((note) => note.kind)).toContain("INTERVIEW");
    expect(applications.filter((application) => application.awaitingReview)).toHaveLength(3);
    expect(await db.agentSearch.count()).toBe(5);
    expect(await db.agentCandidate.count()).toBe(14);
    // Three scheduled runs: this morning at 04:00 Amsterdam time, yesterday at 13:00 and 08:00.
    const runs = JSON.parse((await db.setting.findUniqueOrThrow({ where: { key: "agentRuns" } })).value) as { at: string; message: string }[];
    expect(runs.map((run) => run.at)).toEqual(["2026-11-03T03:00:00.000Z", "2026-11-02T12:00:00.000Z", "2026-11-02T07:00:00.000Z"]);
    expect(runs[0].message).toBe("23 postings found across 5 searches, 6 new. Scored 6; 2 drafts are waiting for your review.");
    expect(JSON.parse((await db.setting.findUniqueOrThrow({ where: { key: "agentUsage" } })).value)).toEqual({ day: "2026-11-03", scored: 6, drafted: 2 });
    expect(await db.postingSearch.count()).toBe(1);
    expect(await db.posting.count({ where: { savedAt: { not: null } } })).toBe(2);
    expect(await db.startup.count()).toBe(2);
    expect(await db.note.count({ where: { at: { gt: now } } })).toBe(0);
    expect(await sampleDataState(db)).toMatchObject({ loaded: true, canLoad: false });
  });

  it("isn't loaded twice, nor over the user's own data", async () => {
    await loadSampleData(db, now);
    await expect(loadSampleData(db, now)).rejects.toThrow("already loaded");
    await removeSampleData(db);
    await db.application.create({ data: { company: "Mine" } });
    await expect(loadSampleData(db, now)).rejects.toThrow("needs an empty Scout");
  });

  it("removes only what it added", async () => {
    await loadSampleData(db, now);
    const mine = await db.skill.create({ data: { name: "Kubernetes" } });
    const own = await db.application.create({ data: { company: "Mine" } });

    expect(await removeSampleData(db)).toEqual({ applications: 12 });
    expect(await db.application.findMany({ select: { id: true } })).toEqual([{ id: own.id }]);
    expect(await db.skill.findMany({ select: { id: true } })).toEqual([{ id: mine.id }]);
    expect(await db.profileField.count()).toBe(0);
    expect(await db.agentSearch.count()).toBe(0);
    expect(await db.agentCandidate.count()).toBe(0);
    expect(await db.startup.count()).toBe(0);
    expect(await db.postingSearch.count()).toBe(0);
    expect(await db.setting.count({ where: { key: { in: ["agentRuns", "agentUsage"] } } })).toBe(0);
    expect(await db.setting.findUnique({ where: { key: SAMPLE_SETTING } })).toBeNull();
    // Built-in themes stay.
    expect(await db.theme.count()).toBeGreaterThan(0);
  });
});
