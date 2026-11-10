import type { AIProvider } from "@/lib/ai/provider";
import "server-only";

import { getAiProvider } from "@/lib/ai";
import { isAiConfigured } from "@/lib/ai/config";
import { AiError } from "@/lib/ai/errors";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { scorePosting } from "@/lib/ai/tasks";
import type { PostingFit } from "@/lib/fit";
import { postingText, type FoundPosting } from "@/lib/job-search/search";
import type { ProfileData } from "@/lib/profile";
import { loadSettings } from "@/lib/settings-data";

import { jevKey, loadScoringConfig, type ScoringConfig } from "./config";
import { scoreWithJev } from "./jev";
import { freshLabel } from "@/lib/freshness";

import { bestPossible, factsOf, prefLines, ruledOut, ruleOutWord, type ScoringPrefs } from "./preferences";
import { criteriaOf, rubricScore, rubricTag, skipCriteria, skipHit, type Judgment, type RubricItem } from "./rubric";
import { zipPoint } from "./zip";

// Scoring a posting against the profile (#208, #274), with whatever Settings →
// Scoring chose: the AI model's score-posting, or Jev. Find jobs' Score and
// the job agent both come here.

export type ScorablePosting = Pick<FoundPosting, "title" | "company" | "place" | "remote" | "salary" | "description" | "lat" | "lng"> & Partial<Pick<FoundPosting, "postedAt" | "companySearch">>;

/** With `gate`, the job agent's: postings your settings rule out, or that can't reach `cutoff` (your minimum score) even with a perfect fit, are set aside without the AI. */
export type ScoreOptions = { gate?: { cutoff: number } };

/**
 * Scores one posting; `scoredWith` is kept with the score (PostingScore). `skip` is the first of `skipRules` it clearly matches,
 * or why your settings set it aside; `free` when that happened before anything was paid for.
 */
export type PostingScorer = (
  posting: ScorablePosting,
  profile: ProfileData,
  signal: AbortSignal,
  skipRules?: readonly string[],
  options?: ScoreOptions,
) => Promise<{ data: PostingFit; scoredWith: string; skip?: { rule: string; note: string } | null; free?: boolean }>;

/** A short, stable tag for your settings in `scoredWith`. */
function prefsTag(prefs: ScoringPrefs): string {
  let hash = 0;
  for (const char of JSON.stringify(prefs)) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return `prefs-${(hash >>> 0).toString(36)}`;
}

type Answer = { data: PostingFit & { criteria?: Judgment[]; workStyle?: "remote" | "hybrid" | "onsite" | null; payPerYear?: { low: number; high: number } | null }; scoredWith: string };

export const AI_PROVIDER_MISSING = "Choose an AI provider in Settings → AI provider first.";

/** Why postings can't be scored, in words, or null when the chosen scorer is set up. */
export async function scoringProblem(config?: ScoringConfig): Promise<string | null> {
  const settled = config ?? (await loadScoringConfig());
  if (settled.scorer === "JEV") return jevKey(settled).problem;
  return (await isAiConfigured()) ? null : AI_PROVIDER_MISSING;
}

/**
 * The scorer Settings → Scoring chose, set up once for any number of
 * postings. Fails as an AiError when it isn't set up.
 */
export async function loadPostingScorer(given?: AIProvider): Promise<PostingScorer> {
  const [config, { scoringRubric: rubric, scoringPrefs: prefs }] = await Promise.all([loadScoringConfig(), loadSettings()]);
  const home = prefs.place.zip ? await zipPoint(prefs.place.zip) : null;
  const criteria = criteriaOf(rubric).map(({ id, label }) => ({ id, label }));
  const criteriaPoints = criteriaOf(rubric).reduce((sum, item) => sum + item.points, 0);
  const asked = (rules: readonly string[]) => [...criteria, ...skipCriteria(rules)];
  const tag = `${rubricTag(rubric)} + ${prefsTag(prefs)}`;

  // Posted within your window: its extra points and how new it is.
  const freshBonus = (posting: ScorablePosting) => {
    const label = freshLabel(posting.postedAt ?? null, new Date(), prefs.fresh.hours);
    return label && prefs.fresh.points > 0 ? { label, points: prefs.fresh.points } : { label: null, points: 0 };
  };

  // Before the AI: set aside what your settings rule out, or what can't reach the cutoff anyway.
  // A company search asked for that company wherever it is: its distance from your ZIP code isn't counted.
  const homeFor = (posting: ScorablePosting) => (posting.companySearch ? null : home);

  const before = (posting: ScorablePosting, options?: ScoreOptions) => {
    if (!options?.gate) return null;
    const facts = factsOf(posting, homeFor(posting));
    const out = ruledOut(posting, facts, prefs);
    if (out) return { data: { score: 0, reasons: [`Set aside before scoring, by your settings: ${out.rule} (${out.note}).`], redFlags: [] }, scoredWith: `rules + ${tag}`, skip: out, free: true };
    const best = Math.min(100, bestPossible(facts, prefs, criteriaPoints) + freshBonus(posting).points);
    if (best >= options.gate.cutoff) return null;
    const { breakdown } = rubricScore([], 100, [], { fitPoints: prefs.fitPoints, lines: prefLines(facts, prefs) });
    // The fit wasn't judged: the best case was assumed, and the line says so.
    if (breakdown[0]?.verdict === "score") breakdown[0] = { ...breakdown[0], note: "Not judged: counted as a perfect fit, to see the best it could reach" };
    return {
      data: { score: best, reasons: [`Not sent to the AI: even a perfect fit would reach only ${best}, under your minimum score of ${options.gate.cutoff}.`], redFlags: [], breakdown },
      scoredWith: `rules + ${tag}`,
      skip: { rule: `minimum score ${options.gate.cutoff}`, note: `the best it could reach is ${best}` },
      free: true,
    };
  };

  // After: the AI's fit with your settings' points, what code couldn't tell taken from the AI.
  const after = (posting: ScorablePosting, rules: readonly string[], { data, scoredWith }: Answer) => {
    const { criteria: judged, workStyle, payPerYear, ...fit } = data;
    const known = factsOf(posting, homeFor(posting));
    const facts = { ...known, style: known.style ?? workStyle ?? null, pay: known.pay ?? payPerYear ?? null };
    const { score, breakdown } = rubricScore(rubric, fit.score, judged ?? [], { fitPoints: prefs.fitPoints, lines: prefLines(facts, prefs) });
    const word = ruleOutWord(posting, prefs.ruleOut);
    const redFlags = word ? [`Mentions “${word}”, one of your words that rule a job out`, ...fit.redFlags] : fit.redFlags;
    // Only the fit counts: the score is the fit, with nothing to break down.
    const parts = breakdown.length > 1 ? { score, breakdown } : { score: fit.score };
    // Freshly posted: extra points, said in the reasons, for applying early.
    const bonus = freshBonus(posting);
    const fresh = bonus.points > 0 ? { score: Math.min(100, parts.score + bonus.points), reasons: [...fit.reasons, `${bonus.label}: +${bonus.points} for applying early.`] } : {};
    return { data: { ...fit, redFlags, ...parts, ...fresh }, scoredWith: `${scoredWith} + ${tag}`, skip: skipHit(rules, judged ?? []) ?? undefined };
  };

  if (config.scorer === "JEV") {
    const jev = jevKey(config);
    if (jev.problem !== null) throw AiError.config(jev.problem);
    const { key } = jev;
    return async (posting, profile, signal, rules = [], options) => before(posting, options) ?? after(posting, rules, await scoreWithJev(posting, profile, { key, signal }, asked(rules)));
  }
  if (!(await isAiConfigured())) throw AiError.config(AI_PROVIDER_MISSING);
  const [provider, taskOptions] = await Promise.all([given ?? getAiProvider(), loadTaskOptions()]);
  return async (posting, profile, signal, rules = [], options) => {
    const set = before(posting, options);
    if (set) return set;
    const { title, company, place, remote, salary } = posting;
    const { data, promptVersion } = await scorePosting(provider, { posting: postingText(posting), title, company, place, remote, salary, profile, criteria: asked(rules) }, { ...taskOptions, signal });
    return after(posting, rules, { data, scoredWith: promptVersion });
  };
}

/**
 * The score your rubric makes of a scorer's answer (#42): its points added
 * up, with the breakdown, and the rubric's tag on `scoredWith`. No rubric:
 * the scorer's own score, as before.
 */
export function withRubric(
  rubric: readonly RubricItem[],
  { data, scoredWith }: { data: PostingFit & { criteria?: Judgment[] }; scoredWith: string },
): { data: PostingFit; scoredWith: string } {
  const { criteria, ...fit } = data;
  if (rubric.length === 0) return { data: fit, scoredWith };
  const { score, breakdown } = rubricScore(rubric, fit.score, criteria ?? []);
  return { data: { ...fit, score, breakdown }, scoredWith: `${scoredWith} + ${rubricTag(rubric)}` };
}
