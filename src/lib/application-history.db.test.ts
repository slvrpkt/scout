import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { demoLetterUnits, demoResumeUnits } from "@/lib/demo-profile";
import { createTestClient, resetDatabase } from "@/test/db";

import { loadHistory } from "./application-history";
import { saveSentCopies } from "./sent-documents";
import { applyStatusChange, undoStatusChange } from "./status-changes";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const client = () => db.client!;

beforeEach(() => resetDatabase(client()));
afterAll(() => client().$disconnect());

const t = (day: number, hour = 12) => new Date(Date.UTC(2026, 10, day, hour));

async function application(company = "Ledgerly") {
  return client().application.create({
    data: {
      company,
      role: "Product Designer",
      postingUrl: "https://example.com/jobs/1",
      createdAt: t(1, 8),
      documents: {
        create: [
          { kind: "RESUME", units: demoResumeUnits() },
          { kind: "COVER_LETTER", units: demoLetterUnits() },
          { kind: "EMAIL", units: [] },
        ],
      },
    },
  });
}

describe("what was sent", () => {
  it("keeps the resume and cover letter the first time an application is sent", async () => {
    const { id } = await application();
    const result = await applyStatusChange(client(), id, "SENT", t(2));
    if (result.outcome !== "changed") throw new Error(result.outcome);

    const copies = await client().sentDocument.findMany({ orderBy: { kind: "asc" } });
    expect(copies.map(({ kind, eventId, sentAt }) => ({ kind, eventId, sentAt }))).toEqual([
      { kind: "RESUME", eventId: result.event.id, sentAt: t(2) },
      { kind: "COVER_LETTER", eventId: result.event.id, sentAt: t(2) },
    ]);
    expect(copies[0].units).toEqual(demoResumeUnits());
  });

  it("stays as sent when the documents change later, and only the first send keeps copies", async () => {
    const { id } = await application();
    await applyStatusChange(client(), id, "SENT", t(2));
    await client().document.updateMany({ where: { applicationId: id, kind: "RESUME" }, data: { units: [] } });
    await applyStatusChange(client(), id, "INTERVIEW", t(3));

    const copies = await client().sentDocument.findMany({ where: { kind: "RESUME" } });
    expect(copies).toHaveLength(1);
    expect(copies[0].units).toEqual(demoResumeUnits());
  });

  it("goes when the send is undone", async () => {
    const { id } = await application();
    const result = await applyStatusChange(client(), id, "SENT", t(2));
    if (result.outcome !== "changed") throw new Error(result.outcome);
    await undoStatusChange(client(), result.event.id);
    expect(await client().sentDocument.count()).toBe(0);
  });

  it("keeps a send by hand without a status change", async () => {
    const { id } = await application();
    expect(await client().$transaction((tx) => saveSentCopies(tx, id, t(4)))).toBe(2);
    expect(await client().sentDocument.count({ where: { eventId: null, sentAt: t(4) } })).toBe(2);
  });
});

describe("loadHistory", () => {
  it("lists every application's history day by day, newest first", async () => {
    const ledgerly = await application();
    const tidewater = await application("Tidewater");
    await applyStatusChange(client(), ledgerly.id, "SENT", t(2, 9));
    await applyStatusChange(client(), tidewater.id, "SENT", t(2, 15));
    await client().note.create({ data: { applicationId: ledgerly.id, kind: "CALL", body: "Recruiter called.", at: t(3, 10) } });
    await applyStatusChange(client(), ledgerly.id, "INTERVIEW", t(3, 11));

    const log = await loadHistory({ timeZone: "UTC", now: t(5) });
    expect(log.days.map((day) => [day.key, day.summary])).toEqual([
      ["2026-11-03", "1 status change · 1 call"],
      ["2026-11-02", "2 applied"],
      ["2026-11-01", ""],
    ]);
    const [third, second] = log.days;
    expect(third.entries.map((entry) => [entry.time, entry.title, entry.application.company])).toEqual([
      ["11:00", "Moved to Interview", "Ledgerly"],
      ["10:00", "Call", "Ledgerly"],
    ]);
    expect(second.entries[0]).toMatchObject({ title: "Applied", application: { company: "Tidewater", postingUrl: "https://example.com/jobs/1" } });
    expect(second.entries[0].sent.map((copy) => copy.label)).toEqual(["Resume", "Cover letter"]);
    expect(log.totals).toEqual({ applied: 2, responses: 1, entries: 1 });
    expect(log.newer).toBeNull();
  });

  it("pages back by days, in the user's time zone", async () => {
    const { id } = await application();
    // 23:30 UTC on the 2nd is already the 3rd in Amsterdam.
    await applyStatusChange(client(), id, "SENT", new Date(Date.UTC(2026, 10, 2, 23, 30)));
    expect((await loadHistory({ timeZone: "Europe/Amsterdam", now: t(5) })).days[0].key).toBe("2026-11-03");

    const older = await loadHistory({ timeZone: "UTC", until: "2026-10-20", now: t(5) });
    expect(older.days).toEqual([]);
    expect(older.newer).toBe("2026-11-03");
  });
});
