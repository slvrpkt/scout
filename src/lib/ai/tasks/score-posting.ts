import { z } from "zod";

import { experienceMonths, type ProfileData } from "@/lib/profile";
import { VERDICTS, type Judgment } from "@/lib/scoring/rubric";

import { postingForPrompt, profileForPrompt, system, UNTRUSTED_POSTING, type Task } from "./prompt-parts";

export const SCORE_POSTING_VERSION = "score-posting@4";

// The job agent's first look at a posting (E16-2): a cheap, explainable fit
// score before anything is spent on a draft. Adapted from avinashbatchala's
// fork of Scout.

/** What the model answers; code checks and trims it (scoreFrom). */
const answerSchema = z.object({
  mustHaves: z.number(),
  work: z.number(),
  level: z.number(),
  field: z.number(),
  reasons: z.array(z.string()),
  redFlags: z.array(z.string()),
  workStyle: z.enum(["remote", "hybrid", "onsite", "unclear"]),
  payPerYear: z.object({ low: z.number(), high: z.number() }).nullable(),
});

/** The four answers, each on its own scale, and how much each counts toward the fit. */
export const FIT_PARTS = { mustHaves: { top: 4, weight: 0.4 }, work: { top: 3, weight: 0.25 }, level: { top: 3, weight: 0.25 }, field: { top: 2, weight: 0.1 } } as const;
/** A level far apart (0 of 3) caps the fit here. */
export const FAR_LEVEL_CAP = 60;

/** The 0–100 fit from the four answers, each held to its scale. */
export function fitFrom(answer: Pick<z.infer<typeof answerSchema>, keyof typeof FIT_PARTS>): number {
  let fit = 0;
  for (const [part, { top, weight }] of Object.entries(FIT_PARTS) as [keyof typeof FIT_PARTS, { top: number; weight: number }][]) {
    const value = Number.isFinite(answer[part]) ? Math.min(top, Math.max(0, Math.round(answer[part]))) : 0;
    fit += (weight * value) / top;
  }
  const score = Math.round(fit * 100);
  return Math.round(answer.level) <= 0 ? Math.min(score, FAR_LEVEL_CAP) : score;
}

/** With your own rubric (#42): each criterion judged against the posting as well. */
const answerWithCriteriaSchema = answerSchema.extend({
  criteria: z.array(z.object({ id: z.string(), verdict: z.enum(VERDICTS), note: z.string() })),
});

/** How well a posting fits the profile: 0 to 100, one to four reasons, up to three red flags; `criteria`, the rubric's criteria judged, when it was given some. */
export type PostingScore = {
  score: number;
  reasons: string[];
  redFlags: string[];
  criteria?: Judgment[];
  /** What the AI read in the posting, for when code couldn't tell. */
  workStyle?: "remote" | "hybrid" | "onsite" | null;
  payPerYear?: { low: number; high: number } | null;
};

const CRITERIA_INSTRUCTIONS = `The candidate also has criteria of their own for a job. Judge each one against the posting, by its id, in criteria:
- verdict "yes" when the posting clearly meets it, "partly" when it meets some of it or meets it with a catch, "no" when the posting says otherwise, and "unknown" when the posting doesn't say;
- note: a few words from the posting that show it, or what's missing.
These don't change your four answers; Scout adds them up itself.`;

const INSTRUCTIONS = `You judge how well a job posting fits a candidate's skills and experience before anyone writes an application, as JSON.

Judge only the work: skills, experience, level and field. Leave out location, remote work and pay: the candidate weighs those themselves.

Answer four questions, each on its own scale:
- mustHaves, 0–4: how many of the posting's core requirements the profile shows. 0 almost none; 1 a few, most core ones missing; 2 about half; 3 most, with one or two gaps; 4 every core requirement.
- work, 0–3: how close the candidate's past work is to this job's day-to-day work. 0 unrelated; 1 loosely related, the main work would be new; 2 similar work in another setting or with other tools; 3 this kind of work before, in a comparable role.
- level, 0–3: how the job's seniority and scope match the candidate's experience, in both directions. 0 far apart, such as a role asking 2 to 5 years from someone with 10 or more, a team member's role for someone who leads teams, or a lead role for someone early on; 1 a clear stretch up or step down; 2 a modest step up or down; 3 a match.
- field, 0–2: the industry or field. 0 new to the candidate; 1 related; 2 the same.

- reasons: one to four short sentences, each pointing at a specific requirement of the posting and a specific part of the profile (a role, a project, a skill, a degree). Never invent experience the profile doesn't show.
- redFlags: up to three real concerns, or none: a missing must-have skill, a seniority mismatch either way, a work permit or a language the profile can't meet.
- workStyle: what the posting says about where the work is done: "remote", "hybrid" (some days in an office), "onsite", or "unclear".
- payPerYear: the yearly pay the posting states, low and high (the same number twice for one figure; an hourly rate times 2080), or null when it states none.

Never use age, gender, nationality, ethnicity, religion, disability, family status or any other protected characteristic. If the posting is too thin to judge, say so in a reason and answer conservatively.`;

/** Points per role and per project the scorer reads: enough to judge fit, and the same cost however long the profile grows. */
export const SCORING_POINTS = { role: 4, project: 2 } as const;

const firstLines = (text: string, count: number) =>
  text
    .split("\n")
    .filter((line) => line.trim())
    .slice(0, count)
    .join("\n");

/** The profile as the scorer reads it: everything but each role's and project's later points. */
export function scoringProfile(profile: ProfileData): ProfileData {
  return {
    ...profile,
    experience: profile.experience.map((role) => ({ ...role, bullets: firstLines(role.bullets, SCORING_POINTS.role) })),
    projects: profile.projects.map((project) => ({ ...project, bullets: firstLines(project.bullets, SCORING_POINTS.project) })),
  };
}

export type ScorePostingInput = {
  /** The posting's text, as the source gave it. */
  posting: string;
  title: string;
  company: string;
  place: string;
  remote: boolean | null;
  salary: string;
  profile: ProfileData;
  /** For the candidate's years of experience; today by default. */
  today?: Date;
  /** The rubric's criteria to judge (#42), by id; none leaves the request as it was. */
  criteria?: readonly { id: string; label: string }[];
};

const MAX_REASONS = 4;
const MAX_RED_FLAGS = 3;
const MAX_LENGTH = 300;

/** A score written whole, as Claude gives through the connector: a whole score within 0–100, and short lists. */
export function writtenScore(answer: { score: number; reasons: string[]; redFlags: string[] }): PostingScore {
  const clean = (lines: string[], max: number) =>
    lines
      .map((line) => line.trim().slice(0, MAX_LENGTH))
      .filter(Boolean)
      .slice(0, max);
  const reasons = clean(answer.reasons, MAX_REASONS);
  return {
    score: Math.min(100, Math.max(0, Math.round(Number.isFinite(answer.score) ? answer.score : 0))),
    reasons: reasons.length > 0 ? reasons : ["The model gave no reasons for this score."],
    redFlags: clean(answer.redFlags, MAX_RED_FLAGS),
  };
}

/** The answer, trusting nothing: a whole score within 0–100, and short, non-empty reasons and flags within their limits. */
export function scoreFrom(answer: z.infer<typeof answerSchema>): PostingScore {
  const clean = (lines: string[], max: number) =>
    lines
      .map((line) => line.trim().slice(0, MAX_LENGTH))
      .filter(Boolean)
      .slice(0, max);
  const reasons = clean(answer.reasons, MAX_REASONS);
  const pay = answer.payPerYear;
  const sane = pay && Number.isFinite(pay.low) && Number.isFinite(pay.high) && Math.max(pay.low, pay.high) >= 15_000 && Math.max(pay.low, pay.high) <= 5_000_000;
  return {
    score: fitFrom(answer),
    reasons: reasons.length > 0 ? reasons : ["The model gave no reasons for this score."],
    redFlags: clean(answer.redFlags, MAX_RED_FLAGS),
    workStyle: answer.workStyle === "unclear" ? null : answer.workStyle,
    payPerYear: sane ? { low: Math.round(Math.min(pay.low, pay.high)), high: Math.round(Math.max(pay.low, pay.high)) } : null,
  };
}

/** E16-2: how well a posting fits the profile. Contact details and references are never sent. */
export const scorePosting: Task<ScorePostingInput, PostingScore> = async (provider, input, { signal }) => {
  const { posting, profile, title, company, place, remote, salary, today = new Date(), criteria = [] } = input;
  const judging = criteria.length > 0;
  // Models add up date ranges badly, and seniority is judged on it (#279).
  const years = Math.floor(experienceMonths(profile, today) / 12);
  const answer = await provider.complete({
    system: system(
      judging ? `${INSTRUCTIONS}\n\n${CRITERIA_INSTRUCTIONS}` : INSTRUCTIONS,
      "Use only facts that are in the candidate's profile. Never invent or assume an employer, skill, date or credential.",
      UNTRUSTED_POSTING,
    ),
    messages: [
      {
        role: "user",
        cached: `The candidate's profile, shortened to its first points per role:\n${profileForPrompt(scoringProfile(profile))}`,
        content: [
          `The candidate's work experience: ${years === 1 ? "about 1 year" : `about ${years} years`} in all, counting overlapping roles once.`,
          `The posting's facts:\n${JSON.stringify({ title, company, place, remote, salary }, null, 2)}`,
          `The posting:\n${postingForPrompt(posting)}`,
          ...(judging ? [`The candidate's criteria:\n${JSON.stringify(criteria.map(({ id, label }) => ({ id, criterion: label })), null, 2)}`] : []),
        ].join("\n\n"),
      },
    ],
    schema: judging ? answerWithCriteriaSchema : answerSchema,
    schemaName: "posting_score",
    // Judging, not writing: faithful, and no long think before answering.
    creativity: "FAITHFUL",
    effort: "low",
    signal,
  });
  if (!judging) return { data: scoreFrom(answer), promptVersion: SCORE_POSTING_VERSION };
  const asked = new Set(criteria.map(({ id }) => id));
  const judged = ((answer as z.infer<typeof answerWithCriteriaSchema>).criteria ?? []).filter(({ id }) => asked.has(id));
  return { data: { ...scoreFrom(answer), criteria: judged }, promptVersion: SCORE_POSTING_VERSION };
};
