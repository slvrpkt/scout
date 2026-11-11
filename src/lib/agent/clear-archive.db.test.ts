import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { candidateData } from "./candidates";
import { clearArchive, CLEARED_KEEP_DAYS } from "./clear-archive";

// The app's database client is the test database's, so nothing here touches real data.
const client = vi.hoisted(() => ({
  db: undefined as ReturnType<typeof createTestClient> | undefined,
}));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  client.db = createTestClient();
  return { prisma: client.db };
});
const db = () => client.db!;
beforeEach(() => resetDatabase(db()));
afterAll(() => db().$disconnect());

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-11T15:00:00.000Z");
const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
const posting = (id: string) => ({
  source: "JSEARCH" as const,
  externalId: id,
  title: `Job ${id}`,
  company: "Ledgerly",
  place: "Arlington, VA",
  remote: false,
  salary: "",
  postedAt: null,
  url: `https://example.com/${id}`,
  via: "",
  description: "A long posting.",
  complete: true,
});
const make = (id: string, status: "SCORED" | "DISMISSED", archived: Date) =>
  db().agentCandidate.create({
    data: {
      ...candidateData(posting(id), { score: 50, reasons: [], redFlags: [] }),
      status,
      updatedAt: archived,
    },
  });

describe("clearing the Archive", () => {
  it("deletes archived agent jobs and never-applied archived applications older than the setting, keeps the rest, and remembers what it deleted", async () => {
    await make("old", "DISMISSED", ago(91));
    await make("recent", "DISMISSED", ago(10));
    await make("listed", "SCORED", ago(200));
    // An agent draft you archived without applying: it goes, with its job.
    const draft = await db().application.create({ data: { company: "Ledgerly", archivedAt: ago(120) } });
    await db().agentCandidate.create({
      data: { ...candidateData(posting("drafted"), { score: 85, reasons: [], redFlags: [] }), status: "DISMISSED", updatedAt: ago(120), application: { connect: { id: draft.id } } },
    });
    // One you applied to, then archived: it stays, with its job.
    const applied = await db().application.create({ data: { company: "Northwind", archivedAt: ago(400), sentAt: ago(420), status: "SENT" } });
    await db().agentCandidate.create({
      data: { ...candidateData(posting("applied"), { score: 90, reasons: [], redFlags: [] }), status: "DISMISSED", updatedAt: ago(400), application: { connect: { id: applied.id } } },
    });
    // An archived application that's still recent stays too.
    await db().application.create({ data: { company: "Kestrel", archivedAt: ago(5) } });

    expect(await clearArchive(now, 90)).toBe(2);
    const left = await db().agentCandidate.findMany({ select: { externalId: true } });
    expect(left.map((row) => row.externalId).sort()).toEqual(["applied", "listed", "recent"]);
    expect((await db().application.findMany({ select: { company: true } })).map((row) => row.company).sort()).toEqual(["Kestrel", "Northwind"]);
    const keys = (await db().clearedJob.findMany()).map((row) => row.key);
    expect(keys).toEqual(expect.arrayContaining(["JSEARCH:old", "JSEARCH:drafted"]));
    // The tally of what went, for the agent's all-time totals.
    const tally = await db().setting.findUnique({ where: { key: "agentClearedTally" } });
    expect(JSON.parse(tally?.value ?? "{}")).toMatchObject({ setAside: 0, skipped: 0, archived: 1, drafted: 1 });
  });

  it("deletes nothing when it's set to Never, and forgets old keys", async () => {
    await make("old", "DISMISSED", ago(500));
    await db().clearedJob.create({
      data: { key: "JSEARCH:ancient", createdAt: ago(CLEARED_KEEP_DAYS + 1) },
    });
    expect(await clearArchive(now, 0)).toBe(0);
    expect(await db().agentCandidate.count()).toBe(1);
    expect(await db().clearedJob.count()).toBe(0);
  });
});
