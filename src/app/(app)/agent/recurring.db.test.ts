import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { recurringQuestions } from "@/lib/recurring-questions";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { answerRecurringQuestion, decideRecurringQuestion } from "./actions";

// The app's database client is the test database's, so nothing here touches real data.
const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const jobs = vi.hoisted(() => ({ started: [] as { applicationId: string; request: string }[] }));
vi.mock("@/lib/jobs/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/runner")>()),
  startJob: vi.fn(async (_job: unknown, input: { applicationId?: string; request?: string }) => {
    if (input.applicationId) jobs.started.push({ applicationId: input.applicationId, request: input.request ?? "" });
    return "job";
  }),
}));
vi.mock("@/lib/base-resume", () => ({ queueBaseResumeSummaries: vi.fn(async () => {}) }));

const prisma = () => db.client!;
const topic = "HIPAA / protected health information";
const draft = (id: string, company: string, suggestion: string) =>
  prisma().application.create({ data: { id, company, status: "DRAFT", awaitingReview: true, resumeSuggestions: [suggestion, "Something else."] } });

beforeEach(async () => {
  await resetDatabase(prisma());
  jobs.started.length = 0;
  await prisma().experience.create({ data: { id: "northwind", role: "Project Manager", company: "Northwind Health", bullets: "Led claims EDI work." } });
  await draft("acme", "Acme Health", "Name HIPAA.");
  await draft("globex", "Globex", "Mention PHI.");
  await draft("initech", "Initech", "Nothing about health.");
  await saveSettings({
    recurringTopics: {
      stamp: "x",
      topics: [
        {
          topic,
          roleId: "northwind",
          guess: "Handled PHI under HIPAA.",
          items: [
            { applicationId: "acme", company: "Acme Health", text: "Name HIPAA." },
            { applicationId: "globex", company: "Globex", text: "Mention PHI." },
          ],
        },
      ],
    },
    topicDecisions: {},
  });
});
afterAll(() => prisma().$disconnect());

describe("questions that keep coming up", () => {
  it("lists a topic two drafts raise, with the drafts that ask", async () => {
    const [question] = await recurringQuestions();
    expect(question).toMatchObject({ topic, roleLabel: "Project Manager at Northwind Health", drafts: [{ company: "Acme Health" }, { company: "Globex" }] });
  });

  it("Yes: keeps the fact in its role and changes only the ticked drafts, without flagging the others out of date", async () => {
    const before = await loadSettings();
    const result = await answerRecurringQuestion({ topic, text: "Handled PHI under HIPAA controls.", target: "northwind", applicationIds: ["acme"] });
    expect(result).toMatchObject({ ok: true, data: { started: 1 } });
    expect((await prisma().experience.findUniqueOrThrow({ where: { id: "northwind" } })).bullets).toBe("Led claims EDI work.\nHandled PHI under HIPAA controls.");
    expect(jobs.started).toEqual([{ applicationId: "acme", request: expect.stringContaining("Handled PHI under HIPAA controls.") }]);
    // The suggestion is answered on the draft that took it; the unticked draft keeps its own.
    expect((await prisma().application.findUniqueOrThrow({ where: { id: "acme" } })).resumeSuggestions).toEqual(["Something else."]);
    expect((await prisma().application.findUniqueOrThrow({ where: { id: "globex" } })).resumeSuggestions).toContain("Mention PHI.");
    const after = await loadSettings();
    expect(after.profileChangedAt).toBe(before.profileChangedAt);
    expect(after.profileStamp).not.toBe(before.profileStamp);
    expect(await recurringQuestions()).toEqual([]);
  });

  it("Not true: kept in Facts so it's never suggested again, and taken off the drafts", async () => {
    await decideRecurringQuestion({ topic, state: "not-true" });
    expect((await prisma().fact.findMany({ where: { applicationId: null } })).map((fact) => fact.text)).toEqual([`Not true for me, so never suggest it: ${topic}.`]);
    expect((await prisma().application.findUniqueOrThrow({ where: { id: "globex" } })).resumeSuggestions).toEqual(["Something else."]);
    expect(await recurringQuestions()).toEqual([]);
  });

  it("Later: away until the next day, or sooner when another draft raises it", async () => {
    await decideRecurringQuestion({ topic, state: "later" });
    expect(await recurringQuestions()).toEqual([]);
    expect(await recurringQuestions(new Date(Date.now() + 21 * 60 * 60 * 1000))).toHaveLength(1);
    // Initech now asks too: back at once.
    await prisma().application.update({ where: { id: "initech" }, data: { resumeSuggestions: ["Name HIPAA too."] } });
    const settings = await loadSettings();
    await saveSettings({ recurringTopics: { ...settings.recurringTopics, topics: [{ ...settings.recurringTopics.topics[0], items: [...settings.recurringTopics.topics[0].items, { applicationId: "initech", company: "Initech", text: "Name HIPAA too." }] }] } });
    expect((await recurringQuestions())[0].drafts.map((entry) => entry.company)).toEqual(["Acme Health", "Globex", "Initech"]);
  });

  it("asks once: a draft left unticked, and the same topic under another name, don't bring it back", async () => {
    await answerRecurringQuestion({ topic, text: "Handled PHI under HIPAA controls.", target: "northwind", applicationIds: ["acme"] });
    // Grouped again with Initech asking too, and the AI naming it differently.
    await prisma().application.update({ where: { id: "initech" }, data: { resumeSuggestions: ["Name PHI handling."] } });
    const settings = await loadSettings();
    await saveSettings({
      recurringTopics: {
        stamp: "y",
        topics: [
          {
            topic: "PHI and HIPAA compliance",
            roleId: null,
            guess: "",
            items: [
              { applicationId: "globex", company: "Globex", text: "Mention PHI." },
              { applicationId: "initech", company: "Initech", text: "Name PHI handling." },
            ],
          },
        ],
      },
      topicDecisions: settings.topicDecisions,
    });
    // Globex's suggestion was answered with the first; Initech alone isn't two drafts.
    expect(await recurringQuestions()).toEqual([]);
  });

  it("doesn't keep the same fact twice", async () => {
    await answerRecurringQuestion({ topic, text: "Handled PHI under HIPAA controls in claims EDI work.", target: "northwind", applicationIds: [] });
    await prisma().application.update({ where: { id: "acme" }, data: { resumeSuggestions: ["Name HIPAA again."] } });
    await answerRecurringQuestion({ topic: "Other", text: "Handled PHI under HIPAA controls in the claims EDI work.", target: "northwind", applicationIds: [] });
    expect((await prisma().experience.findUniqueOrThrow({ where: { id: "northwind" } })).bullets.split("\n")).toHaveLength(2);
  });

  it("Dismiss: away for good", async () => {
    await decideRecurringQuestion({ topic, state: "dismissed" });
    expect(await recurringQuestions(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))).toEqual([]);
  });
});
