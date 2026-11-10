import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadSentDocument } from "@/lib/application-documents";
import { demoResumeUnits } from "@/lib/demo-profile";
import { saveSentCopies } from "@/lib/sent-documents";
import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { redoDraftsJob } from "./redo-drafts";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/pdf/render", () => ({ renderPdf: vi.fn(async () => new TextEncoder().encode("<< /Type /Page >>")) }));
const tailor = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai", () => ({ getAiProvider: vi.fn(async () => ({})) }));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: vi.fn(async () => ({ creativity: "BALANCED", strict: true, language: null, maxPages: 2 })) }));
vi.mock("@/lib/ai/tasks", async (original) => ({ ...(await original<typeof import("@/lib/ai/tasks")>()), tailorResume: tailor }));
const toGrade = vi.hoisted(() => vi.fn(async () => ({ grade: null, attempts: 0, singleColumn: false })));
vi.mock("@/lib/ats-rewrite", () => ({ rewriteToGrade: toGrade }));

const prisma = () => db.client!;
const units = demoResumeUnits();
const written = [{ id: "summary", label: "Summary", text: "Rewritten." }];
const template = { fileName: "mine.pdf", marginX: 0.5, marginY: 0.5, nameSize: 14, headline: false, contacts: ["email" as const], order: ["summary" as const], entry: "inline" as const };
const resumeOf = (applicationId: string) => prisma().document.findFirstOrThrow({ where: { applicationId, kind: "RESUME" } });

beforeEach(async () => {
  await resetDatabase(prisma());
  tailor.mockReset();
  toGrade.mockClear();
  tailor.mockResolvedValue({ data: written, promptVersion: "tailor-resume@test", thirdPageReason: null });
  await prisma().application.create({ data: { id: "draft", documents: { create: { kind: "RESUME", units } } } });
  await prisma().application.create({ data: { id: "sent", status: "SENT", sentAt: new Date(), documents: { create: { kind: "RESUME", units } } } });
  await prisma().application.create({ data: { id: "gone", archivedAt: new Date(), documents: { create: { kind: "RESUME", units } } } });
});
afterAll(() => prisma().$disconnect());

describe("redoDraftsJob", () => {
  it("rewrites only unsent drafts, keeping what they were in their history", async () => {
    await saveSettings({ pageLimit: "2" });
    const result = await redoDraftsJob.run({}, { step: async () => {}, signal: new AbortController().signal } as never);
    expect(result).toEqual({ redone: 1, failed: 0 });
    expect((await resumeOf("draft")).units).toEqual(written);
    expect((await resumeOf("sent")).units).toEqual(units);
    expect((await resumeOf("gone")).units).toEqual(units);
    const versions = await prisma().documentVersion.findMany({ where: { document: { applicationId: "draft" } }, orderBy: { createdAt: "asc" } });
    expect(versions[0]).toMatchObject({ units, detail: "As it was before your template changed" });
  });

  it("checks each rewritten draft against its job and rewrites it toward an ATS A, unless Optimize for ATS is off", async () => {
    await redoDraftsJob.run({}, { step: async () => {}, signal: new AbortController().signal } as never);
    expect(toGrade).toHaveBeenCalledWith("draft");
    expect(toGrade).toHaveBeenCalledTimes(1);
    toGrade.mockClear();
    await saveSettings({ atsOptimize: false });
    await redoDraftsJob.run({}, { step: async () => {}, signal: new AbortController().signal } as never);
    expect(toGrade).not.toHaveBeenCalled();
  });

  it("goes on when one draft fails", async () => {
    await prisma().application.create({ data: { id: "draft-2", documents: { create: { kind: "RESUME", units } } } });
    tailor.mockRejectedValueOnce(new Error("no"));
    expect(await redoDraftsJob.run({}, { step: async () => {}, signal: new AbortController().signal } as never)).toEqual({ redone: 1, failed: 1 });
  });
});

describe("what was sent", () => {
  it("keeps the template it went out with, whatever the template is later", async () => {
    await saveSettings({ resumeTemplate: template });
    await prisma().$transaction((tx) => saveSentCopies(tx, "sent", new Date()));
    const copy = await prisma().sentDocument.findFirstOrThrow({ where: { applicationId: "sent" } });

    await saveSettings({ resumeTemplate: { ...template, nameSize: 30 } });
    expect((await loadSentDocument(copy.id))?.settings.resumeTemplate).toEqual(template);
    await saveSettings({ resumeTemplate: null });
    expect((await loadSentDocument(copy.id))?.settings.resumeTemplate).toEqual(template);
  });

  it("stays without a template if it went out without one", async () => {
    await prisma().$transaction((tx) => saveSentCopies(tx, "sent", new Date()));
    const copy = await prisma().sentDocument.findFirstOrThrow({ where: { applicationId: "sent" } });
    await saveSettings({ resumeTemplate: template });
    expect((await loadSentDocument(copy.id))?.settings.resumeTemplate).toBeNull();
  });
});
