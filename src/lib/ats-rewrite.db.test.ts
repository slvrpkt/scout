import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { demoProfile, demoResumeUnits } from "@/lib/demo-profile";
import { createTestClient, resetDatabase } from "@/test/db";

import { rewriteToGrade } from "./ats-rewrite";

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
vi.mock("@/lib/profile-data", async (original) => ({ ...(await original<typeof import("@/lib/profile-data")>()), loadProfile: vi.fn(async () => demoProfile()) }));

const prisma = () => db.client!;
const units = demoResumeUnits();
const requirement = (skill: string) => ({ text: `Experience with ${skill}`, kind: "skill", skill, years: null, language: null });
const extracted = {
  title: "Designer", company: "Acme", role: "Designer", location: null, mode: null, salary: null, deadline: null, language: "English", asksForReferences: false,
  requirements: [requirement("Kubernetes"), requirement("Terraform")],
};
const withWord = (word: string) => units.map((unit) => (unit.id === "summary" ? { ...unit, text: `${unit.text} ${word}` } : unit));
const answer = (word: string) => ({ data: withWord(word), promptVersion: "tailor-resume@test", thirdPageReason: null });

beforeEach(async () => {
  await resetDatabase(prisma());
  tailor.mockReset();
  await prisma().application.create({ data: { id: "app-1", extracted, followThemeLayout: true, documents: { create: { kind: "RESUME", units } } } });
});
afterAll(() => prisma().$disconnect());

describe("rewriteToGrade", () => {
  it("names what's missing and stops as soon as it reaches an A", async () => {
    tailor.mockResolvedValueOnce(answer("Kubernetes")).mockResolvedValueOnce(answer("Kubernetes Terraform"));
    const { grade, attempts } = await rewriteToGrade("app-1");
    expect(attempts).toBe(2);
    expect(tailor.mock.calls[0][1].focus).toEqual(["Kubernetes", "Terraform"]);
    expect(tailor.mock.calls[1][1].focus).toEqual(["Terraform"]);
    expect(grade?.match).toBe(100);
    expect((await prisma().application.findUniqueOrThrow({ where: { id: "app-1" } })).followThemeLayout).toBe(false);
  });

  it("stops once a rewrite doesn't raise the grade, and keeps the best version it made", async () => {
    tailor.mockResolvedValueOnce(answer("Kubernetes")).mockResolvedValue(answer("Nothing"));
    const { grade, attempts } = await rewriteToGrade("app-1");
    // The first rewrite helped; the second didn't, so there's no third.
    expect(attempts).toBe(2);
    expect(tailor).toHaveBeenCalledTimes(2);
    expect(grade?.match).toBe(50);
    const resume = await prisma().document.findFirstOrThrow({ where: { applicationId: "app-1", kind: "RESUME" } });
    expect(JSON.stringify(resume.units)).toContain("Kubernetes");
  });
});
