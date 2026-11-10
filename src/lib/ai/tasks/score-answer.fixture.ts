import { fitFrom, FIT_PARTS } from "./score-posting";

// For tests: the AI's four answers that come to a given fit, as a model would send them.

const PARTS: Record<number, { mustHaves: number; work: number; level: number; field: number }> = {};
for (let mustHaves = 0; mustHaves <= FIT_PARTS.mustHaves.top; mustHaves++)
  for (let work = 0; work <= FIT_PARTS.work.top; work++)
    for (let level = FIT_PARTS.level.top; level >= 0; level--)
      for (let field = 0; field <= FIT_PARTS.field.top; field++) {
        const parts = { mustHaves, work, level, field };
        PARTS[fitFrom(parts)] ??= parts;
      }

/** An answer whose fit is `score`, which must be one the four answers can make (90, 82, 78, 75, 40…). */
export function aiAnswer(score: number, rest: { reasons: string[]; redFlags: string[]; criteria?: unknown[] }) {
  const parts = PARTS[score];
  if (!parts) throw new Error(`No four answers come to a fit of ${score}.`);
  return { ...parts, workStyle: "unclear" as const, payPerYear: null, ...rest };
}
