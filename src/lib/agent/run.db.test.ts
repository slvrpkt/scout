import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";
import { demoProfile } from "@/lib/demo-profile";
import { searchPostings } from "@/lib/job-search";
import { JobSearchError } from "@/lib/job-search/errors";
import { jobSearchError } from "@/lib/job-search/errors";
import type { FoundPosting, SearchQuery } from "@/lib/job-search/search";
import type { JobContext } from "@/lib/jobs/runner";
import { sweepFinishedJobs } from "@/lib/jobs/retention";
import { encryptSecret, TYPESAFE_KEY } from "@/lib/secrets";
import { NEUTRAL_SCORING_PREFS } from "@/lib/scoring/preferences";
import { saveSettings, loadSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { MockProvider } from "../ai/providers/mock";
import { aiAnswer } from "../ai/tasks/score-answer.fixture";

import { agentDedupeKey } from "./candidates";
import { roundRobin, runAgentScan } from "./run";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
// Settings → Scoring reads DOSSIER_SCORER (#274).
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
// Drafts are their own jobs; here it's enough to see them queued.
vi.mock("@/lib/jobs/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/runner")>()),
  startJob: vi.fn(async () => "draft-job"),
}));
// The sweep also removes old PDF zips, which isn't what's tested here.
vi.mock("@/lib/jobs/zip-pdfs", () => ({ removeOldZips: async () => {} }));
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});

// A fake source that counts its requests, and a fake AI that scores by title.
const fake = vi.hoisted(() => ({
  postings: [] as FoundPosting[],
  searches: 0,
  source: "JSEARCH" as "JSEARCH" | "ADZUNA" | "ARBEITSAGENTUR" | null,
  ai: true,
  failOn: null as string | null,
  onScore: (() => {}) as (title: string) => void,
}));
vi.mock("@/lib/job-search", () => ({
  searchPostings: vi.fn(async () => {
    fake.searches += 1;
    return { postings: fake.postings, next: "page-2" };
  }),
}));
vi.mock("@/lib/job-search/config", () => ({
  loadJobSearchConfig: async () => ({
    source: fake.source,
    saved: true,
    jsearch: { key: "jsearch-key", host: "openwebninja", keyState: "set" },
    adzuna: { appId: "app", key: "adzuna-key", keyState: "set" },
  }),
  credentialsFor: () => ({ key: "jsearch-key", host: "openwebninja" }),
  requestContext: () => ({}),
}));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => fake.ai, loadAiConfig: async () => ({ provider: "ANTHROPIC" }) }));
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  getAiProvider: async () =>
    new MockProvider({
      reply: (call) => {
        const { title } = JSON.parse(call.messages[0].content.split("The posting's facts:\n")[1].split("\n\nThe posting:")[0]) as { title: string };
        fake.onScore(title);
        if (title === fake.failOn) return "not json at all";
        const score = /senior/i.test(title) ? 90 : /designer/i.test(title) ? 75 : 40;
        // The Senior one matches the search's first skip rule, when it has one.
        const criteria = call.messages[0].content.includes("Skip rule") ? [{ id: "skip:0", verdict: /senior/i.test(title) ? "yes" : "no", note: "PMP required." }] : undefined;
        return aiAnswer(score, { reasons: [`Fits ${title}.`], redFlags: [], ...(criteria ? { criteria } : {}) });
      },
    }),
}));

const prisma = () => db.client!;
const query: SearchQuery = { keywords: "Product designer", place: "Rotterdam", country: "nl", radiusKm: 25, remoteOnly: false, postedWithin: "any" };
/** Replaces the agent's saved searches with these, in order. */
const setSearches = async (...queries: SearchQuery[]) => {
  await prisma().agentSearch.deleteMany();
  // One page each, as before paging; the paging tests say otherwise.
  for (const [position, query] of queries.entries()) await prisma().agentSearch.create({ data: { name: query.keywords.trim() || "New search", query, position, maxPages: 1 } });
};

const now = new Date("2026-10-20T08:00:00Z");
const hour = 60 * 60 * 1000;

const posting = (id: string, title: string, posted: string, extra: Partial<FoundPosting> = {}): FoundPosting => ({
  source: "JSEARCH",
  externalId: id,
  title,
  company: `Company ${id}`,
  place: "Rotterdam",
  remote: false,
  salary: "",
  postedAt: posted,
  url: `https://jobs.example/${id}?utm_source=x`,
  via: "LinkedIn",
  description: `${title} at Company ${id}.`,
  complete: false,
  ...extra,
});
const page = [
  posting("a", "Senior Product Designer", "2026-10-19T00:00:00Z"),
  posting("b", "Product Designer", "2026-10-18T00:00:00Z"),
  // No link: its dedupe key is company, title and place.
  posting("c", "Office Manager", "2026-10-17T00:00:00Z", { url: "" }),
];

const context = (abort?: AbortController): JobContext & { steps: string[] } => {
  const steps: string[] = [];
  return { id: "agent-job", steps, step: async (name) => void steps.push(name), signal: (abort ?? new AbortController()).signal };
};

beforeEach(async () => {
  await resetDatabase(prisma());
  Object.assign(fake, { postings: page, searches: 0, source: "JSEARCH", ai: true, failOn: null, onScore: () => {} });
  // One run a day, as the limit tests expect: 3 in any 24 hours.
  await saveSettings({ agentEnabled: true, agentTimes: ["07:00"], agentAutoDraft: false, agentDraftScore: 0, scoringPrefs: NEUTRAL_SCORING_PREFS });
  await setSearches(query);
});
afterAll(() => prisma().$disconnect());

describe("runAgentScan (E16-3)", () => {
  it("searches once, scores the new postings and keeps them, below the minimum too", async () => {
    const run = context();
    const result = await runAgentScan({ manual: false }, run, now);
    expect(fake.searches).toBe(1);
    expect(run.steps).toEqual(["Searching for new postings", "Scoring 3 postings"]);
    expect(result).toEqual({ found: 3, fresh: 3, scored: 3, drafted: 0, skipped: 0, message: "2 new postings are waiting for a look.", budget: { scored: 3, scoreLimit: 150, drafted: 0, draftLimit: 30 }, searches: [{ name: "Product designer", pages: 1, found: 3, fresh: 3, message: "3 postings found, 3 new." }] });
    const candidates = await prisma().agentCandidate.findMany({ orderBy: { score: "desc" } });
    expect(candidates.map((candidate) => [candidate.externalId, candidate.score, candidate.status])).toEqual([
      ["a", 90, "SCORED"],
      ["b", 75, "SCORED"],
      ["c", 40, "SCORED"],
    ]);
    expect(candidates[0]).toMatchObject({ title: "Senior Product Designer", reasons: ["Fits Senior Product Designer."], dedupeKey: agentDedupeKey(page[0]) });
    // Manual job search shows the scores too (#208).
    expect((await prisma().postingScore.findMany({ orderBy: { score: "desc" } })).map((row) => [row.externalId, row.score])).toEqual([["a", 90], ["b", 75], ["c", 40]]);
    // The run is on record, with how it ended.
    expect((await loadSettings()).agentRuns).toEqual([{ at: now.toISOString(), manual: false, message: "2 new postings are waiting for a look." }]);
  });

  it("keeps a posting skipped by its title in Archived, saying which word, without scoring it", async () => {
    await saveSettings({ agentTitleSkip: ["office manager"] });
    const scored: string[] = [];
    fake.onScore = (title) => void scored.push(title);
    await runAgentScan({ manual: false }, context(), now);
    expect(scored).not.toContain("Office Manager");
    const skipped = await prisma().agentCandidate.findFirstOrThrow({ where: { externalId: "c" } });
    expect(skipped).toMatchObject({ status: "DISMISSED", score: 0, redFlags: ["Skipped by its title: “office manager”"] });
    // Seen now: the next run doesn't keep it again.
    await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 2 * hour));
    expect(await prisma().agentCandidate.count({ where: { externalId: "c" } })).toBe(1);
  });

  it("scores with Jev when Settings → Scoring chose it, without an AI provider (#274)", async () => {
    fake.ai = false;
    await saveSettings({ scorer: "JEV" });
    expect(await runAgentScan({ manual: false }, context(), now)).toMatchObject({ found: 0, message: "Enter your TypeSafe key in Settings → Scoring first." });
    expect(fake.searches).toBe(0);

    await saveSettings({ typesafeKeyEnc: encryptSecret(TYPESAFE_KEY, "ts_secret") });
    // Jev at its most sure: every Score at the top for a designer's posting and at the bottom otherwise.
    const requests = stubFetch(({ body }) => {
      const { questions, state } = body as { questions: Record<string, { type: string; criteria?: unknown[] }>; state: { posting: { title: string } } };
      const fits = /designer/i.test(state.posting.title);
      const answer = (id: string, question: { type: string; criteria?: unknown[] }) =>
        question.type === "score"
          ? { type: "score", score: fits ? question.criteria!.length - 1 : 0, confidence: 0.9, probabilities: {} }
          : question.type === "choice"
            ? { type: "choice", choice: "required", confidence: 0.9, probabilities: {} }
            : { type: "noul", noul: id.endsWith("Shown") && fits ? 0.9 : 0.05 };
      return json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, answer(id, question)])) });
    });
    const result = await runAgentScan({ manual: false }, context(), now);
    vi.unstubAllGlobals();

    expect(result).toMatchObject({ found: 3, scored: 3, message: "2 new postings are waiting for a look." });
    expect(requests.map((request) => request.headers.get("authorization"))).toEqual(["Bearer ts_secret", "Bearer ts_secret", "Bearer ts_secret"]);
    const candidates = await prisma().agentCandidate.findMany({ orderBy: { externalId: "asc" } });
    expect(candidates.map((candidate) => [candidate.externalId, candidate.score])).toEqual([["a", 100], ["b", 100], ["c", 0]]);
    expect(candidates[0].reasons).toContain("Covers: Senior Product Designer at Company a.");
    expect(candidates[2].redFlags).toEqual(["The role's level is far from your experience.", "Missing: Office Manager at Company c."]);
    expect((await prisma().postingScore.findFirstOrThrow({ where: { externalId: "a" } })).scoredWith).toMatch(/^score-posting-jev@1 \(jev-1\.14\.0\) \+ rubric-/);
  });

  it("scores the newest new postings first, up to the cap", async () => {
    await saveSettings({ agentDailyScores: 2 });
    const scoredTitles: string[] = [];
    fake.onScore = (title) => scoredTitles.push(title);
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(scoredTitles).toEqual(["Senior Product Designer", "Product Designer"]);
    expect(result).toMatchObject({ fresh: 3, scored: 2 });
  });

  it("never brings back what it has seen, from another run or another source", async () => {
    await runAgentScan({ manual: false }, context(), now);
    const again = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 2 * hour));
    expect(again).toEqual({ found: 3, fresh: 0, scored: 0, drafted: 0, skipped: 3, message: "No new postings this time.", budget: expect.objectContaining({ scoreLimit: 150 }), searches: [{ name: "Product designer", pages: 1, found: 3, fresh: 0, message: "3 postings found, 0 new." }] });

    // The same jobs from Adzuna: one by its link, one by company, title and place.
    fake.postings = [
      posting("az-1", "Senior Product Designer", "2026-10-19T00:00:00Z", { source: "ADZUNA", url: "https://jobs.example/a?utm_medium=y" }),
      posting("az-2", "Office  Manager", "2026-10-18T00:00:00Z", { source: "ADZUNA", url: "", company: "COMPANY c" }),
      posting("az-3", "Brand Designer", "2026-10-20T00:00:00Z", { source: "ADZUNA" }),
    ];
    const third = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 4 * hour));
    expect(third).toMatchObject({ found: 3, fresh: 1, scored: 1, skipped: 2 });
  });

  it("counts the same job from another board once, for 90 days, with the employer's own link first", async () => {
    fake.postings = [
      posting("board", "Agile Lead", "2026-10-19T00:00:00Z", { company: "Acme", url: "https://www.linkedin.com/jobs/view/1" }),
      posting("own", "Agile Lead", "2026-10-19T00:00:00Z", { company: "ACME", url: "https://careers.acme.example/1" }),
    ];
    const first = await runAgentScan({ manual: true }, context(), now);
    expect(first).toMatchObject({ found: 2, fresh: 1, scored: 1 });
    expect((await prisma().agentCandidate.findFirstOrThrow()).url).toContain("careers.acme");

    fake.postings = [posting("other", "Agile Lead", "2026-10-19T00:00:00Z", { company: "Acme", url: "https://www.indeed.com/viewjob?jk=2" })];
    expect(await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 2 * hour))).toMatchObject({ fresh: 0, scored: 0 });

    // The same title in another place is another opening.
    fake.postings = [posting("elsewhere", "Agile Lead", "2026-10-19T00:00:00Z", { company: "Acme", place: "Denver", url: "https://www.indeed.com/viewjob?jk=3" })];
    expect(await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 4 * hour))).toMatchObject({ fresh: 1 });

    await prisma().agentCandidate.updateMany({ data: { createdAt: now } });
    fake.postings = [posting("later", "Agile Lead", "2026-10-19T00:00:00Z", { company: "Acme", url: "https://www.indeed.com/viewjob?jk=4" })];
    expect(await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 91 * 24 * hour))).toMatchObject({ fresh: 1 });
  });

  it("leaves out postings saved, dismissed or applied for in Manual job search", async () => {
    const application = await prisma().application.create({ data: {} });
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "a", savedAt: now } });
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "b", dismissedAt: now } });
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "c", applicationId: application.id } });
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(result).toMatchObject({ found: 3, fresh: 0, skipped: 3 });
    expect(await prisma().agentCandidate.count()).toBe(0);
  });

  it("searches each alternative title on its own at every location, after its own title", async () => {
    await prisma().agentSearch.updateMany({ data: { places: ["Austin", "Denver"].join(String.fromCharCode(10)), altTitles: ["TPM", "tpm", "AI Program Manager"].join(String.fromCharCode(10)) } });
    vi.mocked(searchPostings).mockClear();
    await runAgentScan({ manual: true }, context(), now);
    const asked = vi.mocked(searchPostings).mock.calls.map(([, , query]) => `${query.keywords} @ ${query.place}`);
    const own = (await prisma().agentSearch.findFirstOrThrow()).name;
    for (const title of [own, "TPM", "AI Program Manager"]) for (const place of ["Austin", "Denver"]) expect(asked).toContain(`${title} @ ${place}`);
    // The same title twice is searched once.
    expect(asked.filter((entry) => entry.toLowerCase() === "tpm @ austin")).toHaveLength(1);
  });

  it("searches each title at each company once, across the country in the profile, locations aside", async () => {
    await prisma().agentSearch.updateMany({ data: { places: "Austin", altTitles: "TPM", companies: ["Accenture", "Leidos"].join(String.fromCharCode(10)) } });
    await prisma().profileField.upsert({ where: { key: "country" }, create: { key: "country", value: "Canada" }, update: { value: "Canada" } });
    vi.mocked(searchPostings).mockClear();
    await runAgentScan({ manual: true }, context(), now);
    const asked = vi.mocked(searchPostings).mock.calls.map(([, , query]) => query);
    const own = (await prisma().agentSearch.findFirstOrThrow()).name;
    for (const title of [own, "TPM"]) {
      for (const company of ["Accenture", "Leidos"]) {
        expect(asked).toContainEqual(expect.objectContaining({ keywords: title, company, place: "", country: "ca" }));
      }
    }
    // Its location isn't searched while it has companies.
    expect(asked.some((query) => query.place === "Austin")).toBe(false);
    await prisma().profileField.deleteMany({ where: { key: "country" } });
  });

  it("searches companies across the US when the profile has no country", async () => {
    await prisma().agentSearch.updateMany({ data: { places: "", altTitles: "", companies: "Accenture" } });
    await prisma().profileField.deleteMany({ where: { key: "country" } });
    vi.mocked(searchPostings).mockClear();
    await runAgentScan({ manual: true }, context(), now);
    const asked = vi.mocked(searchPostings).mock.calls.map(([, , query]) => query);
    expect(asked).toContainEqual(expect.objectContaining({ company: "Accenture", country: "us", place: "" }));
  });

  it("searches the whole country for a location of Anywhere, with no place and no distance", async () => {
    await prisma().agentSearch.updateMany({ data: { places: ["Austin", "Anywhere"].join(String.fromCharCode(10)) } });
    vi.mocked(searchPostings).mockClear();
    await runAgentScan({ manual: true }, context(), now);
    const asked = vi.mocked(searchPostings).mock.calls.map(([, , query]) => query);
    expect(asked.some((query) => query.place === "Austin" && query.anyDistance)).toBe(true);
    expect(asked.some((query) => query.place === "" && !query.anyDistance)).toBe(true);
    expect(asked.some((query) => /anywhere/i.test(query.place))).toBe(false);
  });

  it("goes on to the next location when one fails, and says which", async () => {
    await prisma().agentSearch.updateMany({ data: { places: ["Austin", "Denver"].join(String.fromCharCode(10)) } });
    vi.useFakeTimers({ toFake: ["setTimeout"], shouldAdvanceTime: true, advanceTimeDelta: 2000 });
    const usual = vi.mocked(searchPostings).getMockImplementation()!;
    vi.mocked(searchPostings).mockImplementation(async (_source, _credentials, asked) => {
      if (asked.place === "Austin") throw new JobSearchError("unavailable", "The source is down.");
      return { postings: page.slice(0, 1), next: null };
    });
    const result = await runAgentScan({ manual: true }, context(), now);
    vi.useRealTimers();
    expect(result).toMatchObject({ found: 1, fresh: 1 });
    expect(result.searches?.[0].message).toContain("Couldn't search Austin: trying again in a few minutes");
    vi.mocked(searchPostings).mockImplementation(usual);
  });

  it("stops searching past the search's cost limit, and says so", async () => {
    await prisma().costEvent.create({ data: { center: "JSEARCH", kind: "search", amount: 6, at: now } });
    await saveSettings({ costLimits: { JSEARCH: { day: 5 } } });
    const searches = fake.searches;
    const result = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 60_000));
    expect(fake.searches).toBe(searches);
    expect(result.message).toContain("JSearch (job search) has reached $6.00 today, past your limit of $5.00.");
  });

  it("doesn't pay for a search once today's scores are used up", async () => {
    await saveSettings({ agentDailyScores: 2 });
    await runAgentScan({ manual: true }, context(), now);
    const searches = fake.searches;
    const next = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 2 * hour));
    expect(fake.searches).toBe(searches);
    expect(next.message).toMatch(/scoring budget so far is used up/);
  });

  it("stops without asking the source when it's off, not set up, or has run 3 times in 24 hours", async () => {
    const stop = async (manual = false) => (await runAgentScan({ manual }, context(), now)).message;
    await saveSettings({ agentEnabled: false });
    expect(await stop()).toBe("The job agent is off.");
    await saveSettings({ agentEnabled: true });
    await setSearches({ ...query, keywords: " " });
    expect(await stop()).toBe("Add what to look for in Settings → Job agent first.");
    await setSearches({ ...query, country: "" });
    expect(await stop()).toBe("Choose a country for the search in Settings → Job agent first.");
    await setSearches(query);
    fake.ai = false;
    expect(await stop()).toBe("Choose an AI provider in Settings → AI provider first.");
    fake.ai = true;
    fake.source = null;
    expect(await stop()).toBe("Choose a job source in Settings → Job search first.");
    // It never searches the Bundesagentur für Arbeit on its own (#223).
    fake.source = "ARBEITSAGENTUR";
    expect(await stop()).toBe("The job agent doesn't search the Bundesagentur für Arbeit. Choose JSearch, Adzuna or FreeHire in Settings → Job search for it.");
    fake.source = "JSEARCH";
    expect(fake.searches).toBe(0);
    expect((await loadSettings()).agentRuns).toEqual([]);
  });

  it("holds the daily limit from its own record, whatever the task-data sweep deletes", async () => {
    await saveSettings({ jobRetentionHours: 1 });
    for (const hours of [0, 2, 4]) {
      // Each run's Job row, as the runner leaves it, which the sweep deletes an hour later.
      const at = new Date(now.getTime() + hours * hour);
      await prisma().job.create({ data: { type: "agent-scan", key: "agent", status: "DONE", input: { manual: true }, finishedAt: at } });
      await runAgentScan({ manual: true }, context(), at);
      await sweepFinishedJobs(new Date(now.getTime() + (hours + 1.5) * hour));
    }
    expect(fake.searches).toBe(3);
    expect(await prisma().job.count()).toBe(0);
    const fourth = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 6 * hour));
    expect(fourth.message).toBe("The agent has run 3 times in the past 24 hours, as many as it may. Try again in 18 hours.");
    expect(fake.searches).toBe(3);
    // A day after the first, one may go again.
    await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 24 * hour + 1));
    expect(fake.searches).toBe(4);
  });

  it("records the run before it asks the source, so a failing source still counts", async () => {
    const { searchPostings } = await import("@/lib/job-search");
    vi.mocked(searchPostings).mockRejectedValueOnce(new Error("socket hang up"));
    await expect(runAgentScan({ manual: false }, context(), now)).rejects.toThrow("socket hang up");
    expect((await loadSettings()).agentRuns).toEqual([{ at: now.toISOString(), manual: false, message: null }]);
  });

  it("searches each location on its own, leaving the distance to the source", async () => {
    await prisma().agentSearch.updateMany({ data: { places: "Gaithersburg, Maryland\nCalifornia" } });
    vi.mocked(searchPostings).mockClear();
    await runAgentScan({ manual: false }, context(), now);
    const asked = vi.mocked(searchPostings).mock.calls.map(([, , query]) => [query.place, query.anyDistance]);
    expect(asked).toEqual([["Gaithersburg, Maryland", true], ["California", true]]);
  });

  it("applies the skip rules of every search that found a job, though it's scored once", async () => {
    await setSearches(query, { ...query, keywords: "Designer" });
    const [, second] = await prisma().agentSearch.findMany({ orderBy: { position: "asc" } });
    await prisma().agentSearch.update({ where: { id: second.id }, data: { skipRules: "PMP is required" } });
    await runAgentScan({ manual: false }, context(), now);
    const senior = await prisma().agentCandidate.findFirstOrThrow({ where: { externalId: "a" } });
    expect(senior.status).toBe("DISMISSED");
    expect(await prisma().agentCandidate.count()).toBe(3);
  });

  it("sends what a search's skip rules match straight to Archived, saying why", async () => {
    await prisma().agentSearch.updateMany({ data: { skipRules: "PMP is required\nSecurity clearance is required" } });
    const result = await runAgentScan({ manual: false }, context(), now);
    const candidates = await prisma().agentCandidate.findMany({ orderBy: { score: "desc" } });
    expect(candidates.map((candidate) => [candidate.externalId, candidate.status])).toEqual([["a", "DISMISSED"], ["b", "SCORED"], ["c", "SCORED"]]);
    expect(candidates[0].redFlags).toEqual(["Skipped by your rule “PMP is required”: PMP required."]);
    expect(result.scored).toBe(3);
    expect(result.message).toContain("1 skipped by your rules and moved to Archived.");
  });

  it("goes on when one score fails, and says what failed when none worked", async () => {
    fake.failOn = "Product Designer";
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(result).toMatchObject({ scored: 2 });
    expect((await prisma().agentCandidate.findMany()).map((candidate) => candidate.externalId).sort()).toEqual(["a", "c"]);

    await prisma().agentCandidate.deleteMany();
    fake.postings = [page[1]];
    const failed = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 2 * hour));
    expect(failed).toMatchObject({ scored: 0, message: "The model's answer didn't come back in the expected shape. Try again." });
  });

  it("stops between postings when it's cancelled", async () => {
    const abort = new AbortController();
    fake.onScore = () => abort.abort();
    const result = await runAgentScan({ manual: false }, context(abort), now);
    expect(result.scored).toBeLessThanOrEqual(1);
    expect(await prisma().agentCandidate.count()).toBeLessThanOrEqual(1);
  });

  it("queues drafts for the best new postings when auto-draft is on, up to the day's budget (#197)", async () => {
    const { startJob } = await import("@/lib/jobs/runner");
    vi.mocked(startJob).mockClear();
    expect((await runAgentScan({ manual: false }, context(), now)).drafted).toBe(0);
    expect(startJob).not.toHaveBeenCalled();

    await prisma().agentCandidate.deleteMany();
    await saveSettings({ agentAutoDraft: true, agentDailyDrafts: 1 });
    const result = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 2 * hour));
    expect(result).toMatchObject({ scored: 3, drafted: 1, message: "2 new postings are waiting for a look. Preparing a draft for the best one." });
    const best = await prisma().agentCandidate.findFirstOrThrow({ where: { externalId: "a" } });
    expect(startJob).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "agent-draft" }), { candidateId: best.id }, { key: `agent-candidate:${best.id}` });
  });

  it("says when nothing reached the minimum score", async () => {
    fake.postings = [page[2]];
    expect((await runAgentScan({ manual: false }, context(), now)).message).toBe("Scored 1 new posting; none reached your minimum score of 70.");
    expect(demoProfile().basics.name).toBe("Jane Doe");
  });
});

describe("runAgentScan with several saved searches", () => {
  const engineer: SearchQuery = { ...query, keywords: "UX engineer" };
  // Back to the one page for every search that the other tests expect.
  afterEach(() =>
    vi.mocked(searchPostings).mockImplementation(async () => {
      fake.searches += 1;
      return { postings: fake.postings, next: "page-2" };
    }),
  );
  const byKeywords = (pages: Record<string, FoundPosting[]>) =>
    vi.mocked(searchPostings).mockImplementation(async (_source, _credentials, asked) => {
      fake.searches += 1;
      return { postings: pages[asked.keywords] ?? [], next: null };
    });

  it("asks each search once, scores a job two of them find once, and takes turns", async () => {
    await setSearches(query, engineer);
    byKeywords({
      "Product designer": [page[0], page[1]],
      // The senior role again, through another search: scored once, for the first.
      "UX engineer": [page[0], posting("d", "UX Engineer", "2026-10-19T12:00:00Z")],
    });
    await saveSettings({ agentDailyScores: 3 });
    const run = context();
    const result = await runAgentScan({ manual: true }, run, now);
    expect(fake.searches).toBe(2);
    expect(run.steps).toEqual(["Searching for “Product designer” (1 of 2)", "Searching for “UX engineer” (2 of 2)", "Scoring 3 postings"]);
    expect(result).toMatchObject({
      found: 4,
      fresh: 3,
      skipped: 1,
      scored: 3,
      searches: [
        { name: "Product designer", found: 2, fresh: 2, message: "2 postings found, 2 new." },
        { name: "UX engineer", found: 2, fresh: 1, message: "2 postings found, 1 new." },
      ],
    });
    // One from each search, newest first: the senior role (search 1) and the UX engineer (search 2).
    const candidates = await prisma().agentCandidate.findMany({ include: { search: true }, orderBy: { externalId: "asc" } });
    expect(candidates.map((candidate) => [candidate.externalId, candidate.search?.name])).toEqual([
      ["a", "Product designer"],
      ["b", "Product designer"],
      ["d", "UX engineer"],
    ]);
    expect((await prisma().agentSearch.findMany({ orderBy: { position: "asc" } })).map((search) => search.lastMessage)).toEqual(["2 postings found, 2 new.", "2 postings found, 1 new."]);
  });

  it("goes on with the other searches when one fails, and skips the ones switched off", async () => {
    await setSearches(query, engineer, { ...query, keywords: "Switched off" });
    await prisma().agentSearch.updateMany({ where: { name: "Switched off" }, data: { enabled: false } });
    vi.mocked(searchPostings).mockImplementation(async (_source, _credentials, asked) => {
      fake.searches += 1;
      if (asked.keywords === "Product designer") throw jobSearchError("quota", "JSEARCH");
      return { postings: [posting("d", "UX Engineer", "2026-10-19T12:00:00Z")], next: null };
    });
    const result = await runAgentScan({ manual: true }, context(), now);
    expect(fake.searches).toBe(2);
    expect(result.scored).toBe(1);
    expect(result.searches[0]).toMatchObject({ name: "Product designer", found: 0, fresh: 0 });
    expect(result.searches[0].message).toBe(jobSearchError("quota", "JSEARCH").message);
    expect(result.searches).toHaveLength(2);
  });

  it("says why when every search fails", async () => {
    await setSearches(query, engineer);
    vi.mocked(searchPostings).mockImplementation(async () => {
      throw jobSearchError("quota", "JSEARCH");
    });
    expect(await runAgentScan({ manual: true }, context(), now)).toMatchObject({ found: 0, scored: 0, message: jobSearchError("quota", "JSEARCH").message });
  });
});

describe("roundRobin", () => {
  it("takes one from each list in turn", () => {
    expect(roundRobin([[1, 2, 3], [4], [5, 6]])).toEqual([1, 4, 5, 2, 6, 3]);
    expect(roundRobin([])).toEqual([]);
  });
});

describe("runAgentScan reading several pages", () => {
  const pages = (byCursor: Record<string, { postings: FoundPosting[]; next: string | null }>, failAt?: string) =>
    vi.mocked(searchPostings).mockImplementation(async (_source, _credentials, _query, next) => {
      fake.searches += 1;
      if (next === failAt) throw jobSearchError("quota", "JSEARCH");
      return byCursor[next ?? "first"];
    });
  afterEach(() =>
    vi.mocked(searchPostings).mockImplementation(async () => {
      fake.searches += 1;
      return { postings: fake.postings, next: "page-2" };
    }),
  );
  const fivePages = async () => {
    await setSearches(query);
    await prisma().agentSearch.updateMany({ data: { maxPages: 5 } });
  };

  it("follows the next page up to the search's limit", async () => {
    await fivePages();
    await prisma().agentSearch.updateMany({ data: { maxPages: 2 } });
    pages({
      first: { postings: [page[0]], next: "p2" },
      p2: { postings: [page[1]], next: "p3" },
      p3: { postings: [page[2]], next: null },
    });
    const run = context();
    const result = await runAgentScan({ manual: true }, run, now);
    expect(fake.searches).toBe(2);
    expect(run.steps.slice(0, 2)).toEqual(["Searching for new postings", "Searching for new postings, page 2"]);
    expect(result.searches).toEqual([{ name: "Product designer", pages: 2, found: 2, fresh: 2, message: "2 postings found on 2 pages, 2 new." }]);
  });

  it("stops at the last page, and at a page with nothing new", async () => {
    await fivePages();
    pages({ first: { postings: [page[0]], next: "p2" }, p2: { postings: [page[1]], next: null } });
    expect((await runAgentScan({ manual: true }, context(), now)).searches[0]).toMatchObject({ pages: 2, fresh: 2 });

    // Seen them all now: the first page brings nothing new, so the second isn't asked for.
    fake.searches = 0;
    await saveSettings({ agentRuns: [] });
    expect((await runAgentScan({ manual: true }, context(), now)).searches[0]).toMatchObject({ pages: 1, fresh: 0 });
    expect(fake.searches).toBe(1);
  });

  it("keeps what earlier pages found when a later one fails", async () => {
    await fivePages();
    pages({ first: { postings: [page[0], page[1]], next: "p2" } }, "p2");
    const result = await runAgentScan({ manual: true }, context(), now);
    expect(result).toMatchObject({ found: 2, fresh: 2, scored: 2 });
    expect(result.searches[0].message).toBe(`2 postings found on 2 pages, 2 new. Then: ${jobSearchError("quota", "JSEARCH").message}`);
  });
});

describe("runAgentScan's daily budgets", () => {
  it("scores no more than the day's budget across runs, and starts again the next day", async () => {
    await saveSettings({ agentDailyScores: 2, agentRuns: [] });
    const first = await runAgentScan({ manual: true }, context(), now);
    expect(first).toMatchObject({ fresh: 3, scored: 2, budget: { scored: 2, scoreLimit: 2 } });
    expect(first.message).toMatch(/Today's scoring budget is used up: 1 posting wasn't scored\.$/);

    // Later the same day: the one left over is found again, but the budget is spent.
    await saveSettings({ agentRuns: [] });
    const later = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 2 * hour));
    expect(later).toMatchObject({ found: 0, scored: 0, message: "Today's scoring budget so far is used up, so this run didn't search. It picks up again at the next run time, or tomorrow." });

    // The next day it's scored.
    await saveSettings({ agentRuns: [] });
    expect(await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 24 * hour))).toMatchObject({ scored: 1, budget: { scored: 1 } });
  });

  it("drafts the day's best, this run's or an earlier one's, up to the day's draft budget", async () => {
    const { startJob } = await import("@/lib/jobs/runner");
    vi.mocked(startJob).mockClear();
    await saveSettings({ agentAutoDraft: false, agentRuns: [] });
    await runAgentScan({ manual: true }, context(), now);
    expect(startJob).not.toHaveBeenCalled();

    // Turned on later that day: the morning's best two get drafts, then the budget is spent.
    await saveSettings({ agentAutoDraft: true, agentDailyDrafts: 2, agentRuns: [] });
    fake.postings = [];
    const result = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 2 * hour));
    expect(result).toMatchObject({ drafted: 2, budget: { drafted: 2, draftLimit: 2 } });
    expect(vi.mocked(startJob).mock.calls.map(([, input]) => input)).toHaveLength(2);
    await saveSettings({ agentRuns: [] });
    expect((await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 3 * hour))).drafted).toBe(0);
  });
});
