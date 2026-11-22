import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { FoundPosting } from "@/lib/job-search/search";
import { createTestClient, resetDatabase } from "@/test/db";

import { candidateData } from "./candidates";
import { checkSource } from "./source-check";
import { findAtSource } from "./source-finder";

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
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => ({ kind: "MOCK" }) }));
vi.mock("./source-finder", () => ({ findAtSource: vi.fn(async () => null) }));
const scored = vi.hoisted(() => ({ score: 84, skip: null as { rule: string; note: string } | null, rules: [] as readonly string[] }));
vi.mock("@/lib/scoring", () => ({
  loadPostingScorer: async () => async (_posting: unknown, _profile: unknown, _signal: unknown, rules: readonly string[] = []) => {
    scored.rules = rules;
    return { data: { score: scored.score, reasons: ["Fits."], redFlags: [] }, scoredWith: "test", skip: scored.skip };
  },
}));

const prisma = () => db.client!;
const posting: FoundPosting = {
  source: "JSEARCH",
  externalId: "acme-1",
  title: "Senior Program Manager",
  company: "Acme",
  place: "Arlington, VA",
  remote: false,
  salary: "",
  postedAt: null,
  url: "https://www.theladders.com/job/1",
  via: "Ladders",
  description: "A short relayed description.",
  complete: true,
  employerSite: "https://acme.com",
  applyLinks: [{ kind: "source", url: "https://www.theladders.com/job/1", publisher: "Ladders" }],
};
const now = new Date("2026-11-13T18:00:00Z");
const signal = new AbortController().signal;

beforeEach(async () => {
  await resetDatabase(prisma());
  Object.assign(scored, { score: 84, skip: null, rules: [] });
  vi.mocked(findAtSource).mockResolvedValue(null);
});
afterAll(() => prisma().$disconnect());

describe("looking on the company's site", () => {
  it("keeps the company's text, its page first to apply on, the board's text, and a score from the company's text", async () => {
    const search = await prisma().agentSearch.create({ data: { name: "PM", query: {}, skipRules: "PMP" } });
    const { id } = await prisma().agentCandidate.create({ data: { ...candidateData(posting, { score: 74, reasons: [], redFlags: [] }), search: { connect: { id: search.id } } } });
    vi.mocked(findAtSource).mockResolvedValue({ url: "https://acme.wd5.myworkdayjobs.com/External/job/1", description: "Acme's own, full description.", via: "board" });

    expect(await checkSource(id, signal, now)).toEqual({ found: true, score: 84, skipped: false });
    expect(findAtSource).toHaveBeenCalledWith(expect.objectContaining({ employerSite: "https://acme.com", company: "Acme" }), expect.anything(), signal);
    expect(scored.rules).toEqual(["PMP"]);
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id } })).toMatchObject({
      description: "Acme's own, full description.",
      boardDescription: "A short relayed description.",
      sourceUrl: "https://acme.wd5.myworkdayjobs.com/External/job/1",
      sourceCheck: "found",
      sourceCheckedAt: now,
      score: 84,
      applyLinks: [
        { kind: "direct", url: "https://acme.wd5.myworkdayjobs.com/External/job/1", publisher: "Acme" },
        { kind: "source", url: "https://www.theladders.com/job/1", publisher: "Ladders" },
      ],
    });
  });

  it("archives it when the company's text matches a What to skip rule", async () => {
    const { id } = await prisma().agentCandidate.create({ data: candidateData(posting, { score: 74, reasons: [], redFlags: [] }) });
    vi.mocked(findAtSource).mockResolvedValue({ url: "https://careers.acme.com/1", description: "PMP required.", via: "search" });
    scored.skip = { rule: "PMP", note: "PMP required." };
    expect(await checkSource(id, signal, now)).toMatchObject({ found: true, skipped: true });
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "DISMISSED", redFlags: ["Skipped by your rule “PMP”: PMP required."] });
  });

  it("notes when it isn't there, and changes nothing else", async () => {
    const { id } = await prisma().agentCandidate.create({ data: candidateData(posting, { score: 74, reasons: [], redFlags: [] }) });
    expect(await checkSource(id, signal, now)).toEqual({ found: false, score: null, skipped: false });
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id } })).toMatchObject({ sourceCheck: "not found", description: "A short relayed description.", score: 74, sourceUrl: null });
  });
});
