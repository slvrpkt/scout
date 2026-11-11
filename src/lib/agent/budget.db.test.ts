import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { lastRunResults, loadUsage, scoredToday, spend } from "./budget";
import { candidateData } from "./candidates";

const client = vi.hoisted(() => ({ db: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  client.db = createTestClient();
  return { prisma: client.db };
});
const db = new Proxy({} as ReturnType<typeof createTestClient>, { get: (_, key) => Reflect.get(client.db!, key) });
beforeEach(() => resetDatabase(client.db!));
afterAll(() => client.db!.$disconnect());

const now = new Date("2026-11-11T15:00:00.000Z");
const zone = "America/New_York";

describe("today's counts (the Today tile)", () => {
  it("never loses a count when scorings land at the same moment", async () => {
    await Promise.all(Array.from({ length: 20 }, () => spend(now, zone, { scored: 1 })));
    await spend(now, zone, { drafted: 2 });
    expect(await loadUsage(now, zone)).toEqual({ day: "2026-11-11", scored: 20, drafted: 2 });
  });

  it("says how many of today's scores are in the list, and how many a rule skipped after scoring", async () => {
    const posting = (id: string) => ({
      source: "JSEARCH" as const, externalId: id, title: `Job ${id}`, company: "Ledgerly", place: "Arlington, VA", remote: false,
      salary: "", postedAt: null, url: `https://example.com/${id}`, via: "", description: "", complete: true,
    });
    const make = (id: string, status: "SCORED" | "DISMISSED", redFlags: string[], createdAt = now) =>
      db.agentCandidate.create({ data: { ...candidateData(posting(id), { score: 80, reasons: [], redFlags }), status, createdAt } });
    await make("a", "SCORED", []);
    await make("b", "SCORED", []);
    await make("c", "DISMISSED", ["Skipped by your rule “PMP”: PMP required."]);
    await make("d", "DISMISSED", []); // archived by you
    await make("e", "SCORED", [], new Date("2026-11-10T12:00:00.000Z")); // yesterday
    expect(await scoredToday(now, zone)).toEqual({ inList: 2, skipped: 1 });
  });

  it("breaks the last run's new postings down the way the tiles show them", async () => {
    const posting = (id: string) => ({
      source: "JSEARCH" as const, externalId: id, title: `Job ${id}`, company: "Ledgerly", place: "Arlington, VA", remote: false,
      salary: "", postedAt: null, url: `https://example.com/${id}`, via: "", description: "", complete: true,
    });
    const make = (id: string, score: number, status: "SCORED" | "DISMISSED", redFlags: string[] = [], createdAt = now) =>
      db.agentCandidate.create({ data: { ...candidateData(posting(id), { score, reasons: [], redFlags }), status, createdAt } });
    await make("aside", 0, "DISMISSED", ["Set aside before scoring, by your settings: within 75 miles."]);
    await make("high", 85, "SCORED");
    await make("low", 40, "SCORED");
    await make("rule", 82, "DISMISSED", ["Skipped by your rule “PMP”: required."]);
    await make("you", 75, "DISMISSED");
    await make("old", 90, "SCORED", [], new Date("2026-11-10T12:00:00.000Z"));
    const app = await db.application.create({ data: { company: "Ledgerly" } });
    await db.agentCandidate.create({ data: { ...candidateData(posting("drafted"), { score: 88, reasons: [], redFlags: [] }), status: "DRAFTED", application: { connect: { id: app.id } }, createdAt: now } });
    await db.queuedPosting.create({ data: { jobKey: "q", searchId: "s", rules: [], posting: posting("q"), createdAt: now } });
    expect(await lastRunResults(new Date(now.getTime() - 60_000), 60)).toEqual({ found: 7, waiting: 1, scored: 5, setAside: 1, atMin: 1, below: 1, drafted: 1, skipped: 1, archived: 1 });
  });
});
