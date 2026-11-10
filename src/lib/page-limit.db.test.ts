import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { demoProfile, demoResumeUnits } from "@/lib/demo-profile";
import { createTestClient, resetDatabase } from "@/test/db";

import { describeTrim, fitResumeToPages, rewriteForThreePages } from "./page-limit";
import { countPdfPages } from "./pdf/pages";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/pdf/render", () => ({ renderPdf: vi.fn(async () => new TextEncoder().encode("<< /Type /Page >> << /Type /Page >> << /Type /Page >>")) }));
const tailor = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai", () => ({ getAiProvider: vi.fn(async () => ({})) }));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: vi.fn(async () => ({ creativity: "BALANCED", strict: true, language: null, maxPages: 2 })) }));
vi.mock("@/lib/ai/tasks", async (original) => ({ ...(await original<typeof import("@/lib/ai/tasks")>()), tailorResume: tailor }));

const prisma = () => db.client!;
const units = demoResumeUnits();
const resume = async () => (await prisma().document.findFirstOrThrow({ where: { applicationId: "app-1", kind: "RESUME" } }));

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().application.create({ data: { id: "app-1", documents: { create: { kind: "RESUME", units } } } });
});
afterAll(() => prisma().$disconnect());

describe("fitResumeToPages (E10-10)", () => {
  // Four roles: three recent, and one older (2012) the rule starts at 5 bullets.
  const role = (id: string, endYear: number | null, bullets: number) => ({
    ...demoProfile().experience[0],
    id,
    company: `Company ${id}`,
    startYear: 2000,
    startMonth: 1,
    endYear,
    endMonth: endYear ? 6 : null,
    current: endYear === null,
    bullets: Array.from({ length: bullets }, (_, index) => `Point ${index + 1} at ${id}`).join("\n"),
  });
  const own = { ...demoProfile(), experience: [role("now", null, 4), role("r2", 2023, 3), role("r3", 2020, 3), role("old", 2012, 5)], projects: [], publications: [] };
  const roleUnits = own.experience.map((entry) => ({ id: `experience:${entry.id}`, label: `${entry.company} role`, text: entry.bullets }));
  const ownUnits = [{ id: "summary", label: "Summary", text: "A summary." }, ...roleUnits];
  const roleText = async (id: string) => ((await resume()).units as { id: string; text: string }[]).find((unit) => unit.id === `experience:${id}`)!.text;
  // Each length asked for, as the AI would give it.
  const condenser = vi.fn(async ({ company, counts }: { company: string; counts: number[] }) =>
    Object.fromEntries(counts.map((count) => [count, Array.from({ length: count }, (_, index) => `${company} in ${count}, part ${index + 1}`)])),
  );

  beforeEach(async () => {
    await prisma().document.updateMany({ where: { applicationId: "app-1", kind: "RESUME" }, data: { units: ownUnits } });
    condenser.mockClear();
  });

  it("gives up the skills lines before shortening the most recent jobs, and takes them back when it can", async () => {
    const row = () => prisma().application.findUniqueOrThrow({ where: { id: "app-1" } });
    const pages = async () => ((await row()).resumeNoSkills ? 1 : 2);
    expect(await fitResumeToPages("app-1", own, 1, pages, condenser)).toMatchObject({ fits: true });
    expect(await row()).toMatchObject({ resumeNoSkills: true });
    await fitResumeToPages("app-1", own, 1, async () => 1, condenser);
    expect(await row()).toMatchObject({ resumeNoSkills: false });
  });

  it("as its last resorts, before any recent role is shortened, drops the skills lines, then the certifications and tools with no bearing on the job", async () => {
    const row = () => prisma().application.findUniqueOrThrow({ where: { id: "app-1" } });
    const judge = vi.fn(async () => ["tool:jira"]);
    // Two pages until the irrelevant tools go.
    const pages = async () => ((await row()).resumeHide.length > 0 ? 1 : 2);
    const result = await fitResumeToPages("app-1", own, 1, pages, condenser, "deny", judge);
    expect(result.fits).toBe(true);
    expect(await row()).toMatchObject({ resumeNoSkills: true, resumeHide: ["tool:jira"] });
    expect(judge).toHaveBeenCalledTimes(1);
    // No recent role was shortened, and nothing was trimmed at all.
    expect(await roleText("now")).toBe(own.experience[0].bullets);
    expect(result.trimmed).toEqual([]);
  });

  it("doesn't judge certifications and tools when the skills lines are enough", async () => {
    const row = () => prisma().application.findUniqueOrThrow({ where: { id: "app-1" } });
    const judge = vi.fn(async () => ["tool:jira"]);
    const pages = async () => ((await row()).resumeNoSkills ? 1 : 2);
    expect((await fitResumeToPages("app-1", own, 1, pages, condenser, "deny", judge)).fits).toBe(true);
    expect(judge).not.toHaveBeenCalled();
    expect(await row()).toMatchObject({ resumeHide: [] });
  });

  it("leaves a resume that fits alone", async () => {
    expect(await fitResumeToPages("app-1", own, 1, async () => 1, condenser)).toEqual({ trimmed: [], fits: true });
    expect((await resume()).trimmed).toBeNull();
    expect(condenser).not.toHaveBeenCalled();
  });

  it("summarizes the oldest role first, keeping every role, with the fewest trims that fit", async () => {
    // One page once the older role is down to 3 bullets.
    const pages = vi.fn(async () => ((await roleText("old")).split("\n").length > 3 ? 2 : 1));
    const { trimmed, fits } = await fitResumeToPages("app-1", own, 1, pages, condenser);
    expect(fits).toBe(true);
    expect(pages).toHaveBeenCalledWith("/print/resume/app-1");
    expect(await roleText("old")).toBe("Company old in 3, part 1\nCompany old in 3, part 2\nCompany old in 3, part 3");
    // The recent roles are as they were, and nothing is left out.
    expect(await roleText("now")).toBe(own.experience[0].bullets);
    expect(trimmed).toEqual([{ kind: "summarized", unitId: "experience:old", label: "Company old role", original: own.experience[3].bullets, count: 3 }]);
    expect(describeTrim(trimmed, own, fits, 1)).toEqual(["Summarized the Company old role into 3 bullets, keeping its facts, to fit one page"]);
    // The trimmed resume is a version, one click from the draft before it (E8-10).
    expect(await db.client!.documentVersion.count({ where: { cause: "TRIMMED" } })).toBe(1);
  });

  it("never cuts points without an AI model: an older role keeps them until it goes to its title line", async () => {
    const pages = async () => ((await roleText("old")).split("\n").length > 3 ? 2 : 1);
    const { trimmed } = await fitResumeToPages("app-1", own, 1, pages, null);
    expect(trimmed).toEqual([{ kind: "bullets", unitId: "experience:old", label: "Company old role", lines: own.experience[3].bullets.split("\n") }]);
  });

  it("then brings the older role to its title line, then the recent roles one at a time to 2, then to 1, and says when it still doesn't fit", async () => {
    const { trimmed, fits } = await fitResumeToPages("app-1", own, 1, async () => 2, condenser);
    expect(fits).toBe(false);
    expect(await roleText("old")).toBe("");
    for (const id of ["now", "r2", "r3"]) expect((await roleText(id)).split("\n")).toHaveLength(1);
    expect(trimmed.map((item) => item.kind)).toEqual(["summarized", "summarized", "summarized", "bullets"]);
    expect(describeTrim(trimmed, own, fits, 1).at(-1)).toBe("It still runs over one page, so shorten it by hand if it has to fit");
    // One request per role trimmed, for every length its trims reach.
    expect(condenser).toHaveBeenCalledTimes(4);
  });

  it("asks before shortening the recent roles to fit two pages, leaving the resume as written, and fits three once allowed", async () => {
    // Three pages until the recent roles are shortened.
    const pages = async () => ((await roleText("now")).split("\n").length > 2 ? 3 : 2);
    expect(await fitResumeToPages("app-1", own, 2, pages, condenser, "ask")).toEqual({ trimmed: [], fits: false, ask: true });
    expect((await resume()).units).toEqual(ownUnits);
    const allowed = await fitResumeToPages("app-1", own, 2, pages, condenser, "allow");
    expect(allowed.fits).toBe(true);
    expect(await roleText("now")).toBe(own.experience[0].bullets);
    const denied = await fitResumeToPages("app-1", own, 2, pages, condenser, "deny");
    expect(denied.fits).toBe(true);
    expect((await roleText("now")).split("\n")).toHaveLength(2);
  });

  it("fits three pages without asking when that's the limit", async () => {
    const pages = async () => 3;
    expect(await fitResumeToPages("app-1", own, 3, pages, condenser, "ask")).toEqual({ trimmed: [], fits: true });
    expect((await resume()).units).toEqual(ownUnits);
  });
});

describe("rewriteForThreePages", () => {
  it("rewrites this resume with room for three pages, keeping what it was in its history", async () => {
    const written = [{ id: "summary", label: "Summary", text: "Written for three pages." }];
    tailor.mockResolvedValue({ data: written, promptVersion: "tailor-resume@test", thirdPageReason: null });
    await prisma().document.updateMany({ where: { applicationId: "app-1" }, data: { trimmed: [{ kind: "unit", unit: units[0], index: 0 }] } });
    expect(await rewriteForThreePages("app-1", demoProfile())).toBe(true);
    expect(tailor.mock.calls[0][2]).toMatchObject({ maxPages: 3 });
    const after = await resume();
    expect(after.units).toEqual(written);
    expect(after.trimmed).toBeNull();
    expect(after.writtenWith).toBe("tailor-resume@test");
    const versions = await prisma().documentVersion.findMany({ where: { documentId: after.id }, orderBy: { createdAt: "asc" } });
    expect(versions.map((version) => version.cause)).toEqual(["BEFORE_RESTORE", "REGENERATED"]);
    expect(versions[0].units).toEqual(units);
    expect(versions[0].detail).toBe("As it was before the three-page rewrite");
    expect((await prisma().setting.findMany({ where: { key: "pageLimit" } }))).toEqual([]);
  });
});

describe("countPdfPages", () => {
  it("counts page objects, not the page tree", () => {
    const pdf = new TextEncoder().encode("<< /Type /Pages /Count 2 >> << /Type /Page >> << /Type/Page /Parent 1 0 R >>");
    expect(countPdfPages(pdf)).toBe(2);
  });
});
