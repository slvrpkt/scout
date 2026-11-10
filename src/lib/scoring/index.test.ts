import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiError } from "@/lib/ai/errors";
import { MockProvider } from "@/lib/ai/providers/mock";
import { demoProfile } from "@/lib/demo-profile";

import type { ScoringConfig } from "./config";
import { DEFAULT_SCORING_PREFS, NEUTRAL_SCORING_PREFS as NEUTRAL } from "./preferences";
import { loadPostingScorer, scoringProblem } from "./index";
import type { RubricItem } from "./rubric";

const state = vi.hoisted(() => ({
  config: { scorer: "AI", saved: false, key: null, keyState: "none" } as ScoringConfig,
  aiReady: true,
  provider: null as unknown,
  rubric: [] as RubricItem[],
  prefs: null as unknown,
}));

vi.mock("./config", async (importOriginal) => ({ ...(await importOriginal<typeof import("./config")>()), loadScoringConfig: async () => state.config }));
// No say of your own beyond the rubric: the fit counts as the rubric gives it, or alone without one.
const noPrefs = (rubric: { id: string; points: number }[]) => ({
  fitPoints: rubric.find((item) => item.id === "fit")?.points ?? (rubric.length > 0 ? 0 : 100),
  work: { points: 0, remote: 100, hybrid: 70, onsite: 30, unknown: 40 },
  pay: { points: 0, low: null, high: null, unknown: 50 },
  place: { points: 0, zip: "", miles: 30, ruleOutFar: false, unknown: 50 },
  ruleOut: [],
  fresh: { hours: 12, points: 0 },
});
vi.mock("@/lib/settings-data", () => ({ loadSettings: async () => ({ scoringRubric: state.rubric, scoringPrefs: state.prefs ?? noPrefs(state.rubric) }) }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => state.aiReady }));
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => state.provider }));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: async () => ({ creativity: "BALANCED", strict: true, language: null }) }));
vi.mock("./jev", () => ({ scoreWithJev: vi.fn(async () => ({ data: { score: 80, reasons: ["Covers: Figma"], redFlags: [] }, scoredWith: "score-posting-jev@1 (jev-1.14.0)" })) }));

const { scoreWithJev } = await import("./jev");

const profile = demoProfile();
const posting = { title: "Designer", company: "Ledgerly", place: "Amsterdam", remote: false, salary: "", description: "You know Figma." };
const signal = new AbortController().signal;
// The AI's four answers: 3 of 4 must-haves, close work, the right level, the same field: a fit of 90.
const fit90 = { mustHaves: 3, work: 3, level: 3, field: 2, workStyle: "unclear", payPerYear: null };

beforeEach(() => {
  state.config = { scorer: "AI", saved: false, key: null, keyState: "none" };
  state.aiReady = true;
  state.rubric = [];
  state.prefs = null;
  vi.mocked(scoreWithJev).mockClear();
});

describe("scoringProblem (#274)", () => {
  it("asks for an AI provider, or for Jev's key, whichever scores", async () => {
    expect(await scoringProblem()).toBeNull();
    state.aiReady = false;
    expect(await scoringProblem()).toBe("Choose an AI provider in Settings → AI provider first.");

    state.config = { scorer: "JEV", saved: true, key: null, keyState: "none" };
    expect(await scoringProblem()).toBe("Enter your TypeSafe key in Settings → Scoring first.");
    expect(await scoringProblem({ ...state.config, key: "ts", keyState: "set" })).toBeNull();
  });
});

describe("loadPostingScorer", () => {
  it("scores with Jev and its key once chosen, without the AI provider", async () => {
    state.config = { scorer: "JEV", saved: true, key: "ts", keyState: "set" };
    state.aiReady = false;
    const score = await loadPostingScorer();
    const scored = await score(posting, profile, signal);
    expect(scored.data).toMatchObject({ score: 80, reasons: ["Covers: Figma"], redFlags: [] });
    expect(scored.scoredWith).toMatch(/^score-posting-jev@1 \(jev-1\.14\.0\) \+ rubric-\w+ \+ prefs-\w+$/);
    expect(scoreWithJev).toHaveBeenCalledWith(posting, profile, { key: "ts", signal }, []);
  });

  it("scores with the AI model's score-posting otherwise, keeping its prompt version", async () => {
    const provider = new MockProvider({ reply: () => ({ ...fit90, reasons: ["Knows Figma."], redFlags: [] }) });
    state.provider = provider;
    const score = await loadPostingScorer();
    const scored = await score(posting, profile, signal);
    expect(scored.data).toMatchObject({ score: 90, reasons: ["Knows Figma."], redFlags: [] });
    expect(scored.scoredWith).toMatch(/^score-posting@4 \+ rubric-/);
    expect(provider.calls[0].messages[0].content).toContain("Ledgerly: Designer");
    expect(scoreWithJev).not.toHaveBeenCalled();
  });

  it("has the chosen scorer judge a search's skip rules, without touching the score", async () => {
    const reply = (verdict: string) => ({ ...fit90, reasons: ["Knows Figma."], redFlags: [], criteria: [{ id: "skip:1", verdict, note: "PMP required." }] });
    state.provider = new MockProvider({ reply: () => reply("yes") });
    const rules = ["security clearance", "PMP is required"];
    const hit = await (await loadPostingScorer())(posting, profile, signal, rules);
    expect(hit.data.score).toBe(90);
    expect(hit.skip).toEqual({ rule: "PMP is required", note: "PMP required." });
    expect((state.provider as MockProvider).calls[0].messages[0].content).toContain("PMP is required");
    for (const verdict of ["partly", "no", "unknown"]) {
      state.provider = new MockProvider({ reply: () => reply(verdict) });
      expect((await (await loadPostingScorer())(posting, profile, signal, rules)).skip).toBeUndefined();
    }
  });

  it("fails with what's missing", async () => {
    state.aiReady = false;
    await expect(loadPostingScorer()).rejects.toThrow(new AiError("config", "Choose an AI provider in Settings → AI provider first."));
    state.config = { scorer: "JEV", saved: true, key: null, keyState: "unreadable" };
    await expect(loadPostingScorer()).rejects.toThrow("Your saved TypeSafe key can't be read. Enter it again in Settings → Scoring.");
  });

  describe("with your own rubric (#42)", () => {
    const rubric: RubricItem[] = [
      { id: "fit", label: "How well it fits your profile", points: 50 },
      { id: "remote", label: "Remote", points: 25 },
      { id: "hybrid", label: "Hybrid", points: 25 },
    ];

    it("has the AI judge each criterion and adds up the points itself", async () => {
      state.rubric = rubric;
      const provider = new MockProvider({
        reply: () => ({
          ...fit90,
          reasons: ["Knows Figma."],
          redFlags: [],
          criteria: [
            { id: "remote", verdict: "yes", note: "Fully remote." },
            { id: "hybrid", verdict: "no", note: "" },
            { id: "made-up", verdict: "yes", note: "" },
          ],
        }),
      });
      state.provider = provider;
      const score = await loadPostingScorer();
      const { data, scoredWith } = await score(posting, profile, signal);
      // 45 of 50 for the fit, 25 for Remote, 0 for Hybrid: 70 of 100.
      expect(data.score).toBe(70);
      expect(data.breakdown?.map((line) => line.earned)).toEqual([45, 25, 0]);
      expect(data).not.toHaveProperty("criteria");
      expect(scoredWith).toMatch(/^score-posting@4 \+ rubric-/);
      expect(provider.calls[0].messages[0].content).toContain('"criterion": "Remote"');
      expect(provider.calls[0].messages[0].content).not.toContain("How well it fits your profile");
    });

    it("asks Jev the criteria in the same request", async () => {
      state.rubric = rubric.slice(1);
      state.config = { scorer: "JEV", saved: true, key: "ts", keyState: "set" };
      vi.mocked(scoreWithJev).mockResolvedValueOnce({
        data: { score: 80, reasons: [], redFlags: [], criteria: [{ id: "remote", verdict: "partly", note: "" }] },
        scoredWith: "score-posting-jev@1 (jev-1.14.0)",
      } as never);
      const score = await loadPostingScorer();
      expect((await score(posting, profile, signal)).data.score).toBe(50);
      expect(scoreWithJev).toHaveBeenCalledWith(posting, profile, { key: "ts", signal }, [
        { id: "remote", label: "Remote" },
        { id: "hybrid", label: "Hybrid" },
      ]);
    });
  });

  describe("with your settings (work style, pay, words that rule a job out)", () => {
    const prefs = { ...DEFAULT_SCORING_PREFS, ruleOut: ["TS/SCI"] };

    it("sets aside a posting with one of your words before the AI, for free, when the job agent asks", async () => {
      state.prefs = prefs;
      const provider = new MockProvider({ reply: () => ({ ...fit90, reasons: ["x"], redFlags: [] }) });
      state.provider = provider;
      const score = await loadPostingScorer();
      const cleared = { ...posting, description: "Needs an active TS/SCI clearance." };
      const set = await score(cleared, profile, signal, [], { gate: { cutoff: 80 } });
      expect(set).toMatchObject({ free: true, skip: { rule: "TS/SCI", note: "the posting mentions it" } });
      expect(provider.calls).toHaveLength(0);
      // Scored by hand, it's scored, with the word flagged.
      const scored = await score(cleared, profile, signal);
      expect(scored.data.redFlags[0]).toMatch(/Mentions .TS\/SCI., one of your words/);
      expect(provider.calls).toHaveLength(1);
    });

    it("doesn't pay the AI for a job that can't reach the minimum score even with a perfect fit", async () => {
      state.prefs = prefs;
      const provider = new MockProvider({ reply: () => ({ ...fit90, reasons: ["x"], redFlags: [] }) });
      state.provider = provider;
      const lowPay = { ...posting, remote: false, salary: "USD 50,000 a year" };
      // On-site 6 of 20, pay 3.75 of 15, distance unknown, so at best 5 of 5, a perfect fit 60: 74 at best.
      const set = await (await loadPostingScorer())(lowPay, profile, signal, [], { gate: { cutoff: 80 } });
      expect(set).toMatchObject({ free: true, data: { score: 74 }, skip: { rule: "minimum score 80" } });
      expect(provider.calls).toHaveLength(0);
    });

    it("gives a job posted within the window its extra points, and says so", async () => {
      state.prefs = { ...NEUTRAL, fresh: { hours: 12, points: 5 } };
      state.provider = new MockProvider({ reply: () => ({ ...fit90, reasons: ["Fits."], redFlags: [] }) });
      const justPosted = { ...posting, postedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() };
      const { data } = await (await loadPostingScorer())(justPosted, profile, signal);
      expect(data.score).toBe(95);
      expect(data.reasons.at(-1)).toBe("Posted 2 hours ago: +5 for applying early.");
      const old = { ...posting, postedAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString() };
      expect((await (await loadPostingScorer())(old, profile, signal)).data.score).toBe(90);
    });

    it("adds the AI's fit to your settings' points, using what the AI read when code couldn't tell", async () => {
      state.prefs = prefs;
      state.provider = new MockProvider({ reply: () => ({ ...fit90, workStyle: "remote", payPerYear: { low: 140_000, high: 160_000 }, reasons: ["x"], redFlags: [] }) });
      const { data } = await (await loadPostingScorer())({ ...posting, remote: null }, profile, signal, [], { gate: { cutoff: 80 } });
      // Fit 54 of 60, remote 20 of 20, pay 15 of 15, distance (remote) 5 of 5: 94.
      expect(data.score).toBe(94);
      expect(data.breakdown?.map((line) => line.label)).toEqual(["How well it fits your profile", "Work style: Remote", "Pay: $140k–$160k a year", "Distance: remote"]);
    });
  });
});
