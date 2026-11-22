import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { JobContext } from "@/lib/jobs/runner";
import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../../prisma/seed/built-ins";
import { MockProvider } from "../ai/providers/mock";

import { prepareDraftJob } from "./prepare-draft";

// The app's database client is the test database's, so nothing here touches real data.
const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});
// A fake AI that answers each step of reading and writing.
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  getAiProvider: async () =>
    new MockProvider({
      reply: (call) => {
        switch (call.json?.name) {
          case "extracted_posting":
            return {
              title: "Senior Product Designer · Ledgerly",
              company: "Ledgerly",
              role: "Senior Product Designer",
              location: "Amsterdam",
              mode: "Hybrid",
              salary: "",
              deadline: null,
              requirements: [{ text: "Strong prototyping skills in Figma", kind: "skill", skill: "Figma", years: null, language: null }],
              asksForReferences: false,
              language: "English",
            };
          case "requirement_matches":
            return { matches: [{ requirement: 1, skill: "Figma", language: null }] };
          case "tailored_resume":
            return { summary: "Product designer for payments.", roles: [], projects: [], skills: ["Figma"], education: [] };
          default:
            throw new Error(`No answer for ${call.json?.name}`);
        }
      },
    }),
}));

const prisma = () => db.client!;
const steps: string[] = [];
const context = (id: string): JobContext => ({ id, step: async (name) => void steps.push(name), signal: new AbortController().signal });
const text = "Ledgerly is hiring a Senior Product Designer. Strong prototyping skills in Figma.";

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  steps.length = 0;
  // Trimming renders PDFs: not what these tests are about.
  await saveSettings({ pageLimit: "none" });
});
afterAll(() => prisma().$disconnect());

describe("Prepare draft (New application, the job agent's way)", () => {
  it("reads the posting, writes the resume and saves a Draft linked to the posting kept in Saved for later", async () => {
    const posting = await prisma().posting.create({ data: { source: "JSEARCH", externalId: "pasted:1", pasted: true, title: "Pasted posting", description: text, savedAt: new Date() } });
    await prisma().job.create({ data: { id: "prep-1", type: "prepare-draft", status: "RUNNING", input: {} } });
    const { applicationId } = await prepareDraftJob.run({ posting: text, postingUrl: "", postingId: posting.id, startupId: null }, context("prep-1"));

    const application = await prisma().application.findUniqueOrThrow({ where: { id: applicationId }, include: { documents: true } });
    // In the Job application log as a Draft, ready to review, like an approved agent draft.
    expect(application).toMatchObject({ status: "DRAFT", awaitingReview: false, company: "Ledgerly", role: "Senior Product Designer", postingUrl: "", postingText: text });
    expect(application.documents.map((document) => document.kind).sort()).toEqual(["COVER_LETTER", "RESUME"]);
    // Named after what was read, and linked: it stays where it can be found again.
    expect(await prisma().posting.findUniqueOrThrow({ where: { id: posting.id } })).toMatchObject({ applicationId, title: "Senior Product Designer", company: "Ledgerly" });
    expect(steps).toEqual(expect.arrayContaining(["Reading the posting", "Tailoring your resume", "Saving the application"]));
  });

  it("makes one application however often it runs, e.g. resumed after a restart", async () => {
    await prisma().job.create({ data: { id: "prep-2", type: "prepare-draft", status: "RUNNING", input: {} } });
    const first = await prepareDraftJob.run({ posting: text, postingUrl: "https://jobs.ledgerly.example/1", postingId: null, startupId: null }, context("prep-2"));
    const again = await prepareDraftJob.run({ posting: text, postingUrl: "https://jobs.ledgerly.example/1", postingId: null, startupId: null }, context("prep-2"));
    expect(again.applicationId).toBe(first.applicationId);
    expect(await prisma().application.count()).toBe(1);
  });
});
