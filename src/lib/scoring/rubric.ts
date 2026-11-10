import { z } from "zod";

// Your own scoring rubric (#42), from Settings → Scoring: criteria you name
// ("Remote", "Hybrid", "Salary over $120k"), each worth points in steps of 5,
// and if you like Scout's own score as one of them ("How well it fits your
// profile"). The scorer judges each criterion; code adds up the points and
// turns them into the 0–100 score. No criteria: scoring is as it always was.

export const RUBRIC_FIT_ID = "fit";
export const RUBRIC_FIT_LABEL = "How well it fits your profile";
/** Your own criteria, on top of the settings for fit, work style, pay and distance. */
export const RUBRIC_MAX_ITEMS = 5;
export const RUBRIC_POINTS = Array.from({ length: 20 }, (_, index) => (index + 1) * 5);

export const rubricItemSchema = z.object({
  id: z.string().min(1).max(40),
  /** Your criterion in your words; for the fit item, RUBRIC_FIT_LABEL. */
  label: z.string().trim().min(1).max(120),
  points: z
    .number()
    .int()
    .min(5)
    .max(100)
    .refine((points) => points % 5 === 0, "Points go in steps of 5."),
});
/** A search's "What to skip": how many rules, how long each, and all of them with their line breaks. */
export const MAX_SKIP_RULES = 50;
export const MAX_SKIP_RULE_LENGTH = 200;
export const MAX_SKIP_RULES_LENGTH = MAX_SKIP_RULES * (MAX_SKIP_RULE_LENGTH + 1);
const SKIP_ID = "skip:";

/** A search's "What to skip" as rules: one a line, blank lines left out. */
export const skipRuleList = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** The rules as criteria, so whichever scorer is chosen judges them in the same request. */
export const skipCriteria = (rules: readonly string[]) =>
  rules.map((rule, index) => ({ id: `${SKIP_ID}${index}`, label: `Skip rule, "yes" only if the posting clearly matches it: ${rule}` }));

/** The first rule the scorer said "yes" to, or null. Unclear postings are kept. */
export function skipHit(rules: readonly string[], judged: readonly Judgment[]): { rule: string; note: string } | null {
  const hit = judged.find(({ id, verdict }) => id.startsWith(SKIP_ID) && verdict === "yes");
  const rule = hit && rules[Number(hit.id.slice(SKIP_ID.length))];
  return rule ? { rule, note: hit.note } : null;
}

export type RubricItem = z.infer<typeof rubricItemSchema>;

export const rubricSchema = z
  .array(rubricItemSchema)
  .max(RUBRIC_MAX_ITEMS)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Each criterion needs its own id.");

/** How a criterion was judged: met, partly met, not met, or the posting doesn't say. */
export const VERDICTS = ["yes", "partly", "no", "unknown"] as const;
export type Verdict = (typeof VERDICTS)[number];
export type Judgment = { id: string; verdict: Verdict; note: string };

/** A line of the breakdown the score pop-up shows. */
/** "score": the AI's fit; "yours": a part your settings give (work style, pay, distance). */
export type RubricLine = { label: string; points: number; earned: number; verdict: Verdict | "score" | "yours"; note: string };

const SHARE: Record<Verdict, number> = { yes: 1, partly: 0.5, no: 0, unknown: 0.5 };

/** The criteria the scorer judges: everything but the fit item, which is Scout's own score. */
export const criteriaOf = (rubric: readonly RubricItem[]) => rubric.filter((item) => item.id !== RUBRIC_FIT_ID);

/**
 * The 0–100 score: the AI's fit as a share of its points, your settings' lines
 * (work style, pay, distance), and each criterion's share of its points (all
 * when met, half when partly met or when the posting doesn't say), over all
 * the points there are. A criterion the scorer didn't judge counts as unknown.
 */
export function rubricScore(
  rubric: readonly RubricItem[],
  fitScore: number,
  judgments: readonly Judgment[],
  { fitPoints = rubric.find((item) => item.id === RUBRIC_FIT_ID)?.points ?? 0, lines = [] }: { fitPoints?: number; lines?: readonly RubricLine[] } = {},
): { score: number; breakdown: RubricLine[] } {
  const judged = new Map(judgments.map((judgment) => [judgment.id, judgment]));
  const fit = Math.min(100, Math.max(0, fitScore));
  const fitLine: RubricLine[] = fitPoints > 0 ? [{ label: RUBRIC_FIT_LABEL, points: fitPoints, earned: Math.round((fit / 100) * fitPoints * 10) / 10, verdict: "score", note: `Scored ${fitScore} of 100` }] : [];
  const criteria = criteriaOf(rubric).map((item): RubricLine => {
    const judgment = judged.get(item.id) ?? { verdict: "unknown" as const, note: "" };
    return { label: item.label, points: item.points, earned: item.points * SHARE[judgment.verdict], verdict: judgment.verdict, note: judgment.note.trim().slice(0, 300) };
  });
  const breakdown = [...fitLine, ...lines, ...criteria];
  const total = breakdown.reduce((sum, line) => sum + line.points, 0);
  const earned = breakdown.reduce((sum, line) => sum + line.earned, 0);
  return { score: total > 0 ? Math.round((earned / total) * 100) : fitScore, breakdown };
}

/** A short, stable tag for the rubric in `scoredWith`, so a score says which rubric made it. */
export function rubricTag(rubric: readonly RubricItem[]): string {
  let hash = 0;
  for (const char of JSON.stringify(rubric.map(({ label, points }) => [label, points]))) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return `rubric-${(hash >>> 0).toString(36)}`;
}

/** A stored breakdown, trusting nothing: lines that don't fit the shape are left out. */
export function breakdownOf(value: unknown): RubricLine[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const line = z.object({ label: z.string(), points: z.number(), earned: z.number(), verdict: z.enum([...VERDICTS, "score", "yours"]), note: z.string() });
  const lines = value.flatMap((item) => {
    const parsed = line.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  return lines.length > 0 ? lines : undefined;
}
