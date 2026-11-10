// Freshly posted jobs: applying in the first hours gets more responses, so a
// job posted within your window (Settings → Scoring, 12 hours by default)
// gets extra points, a label saying how new it is, and a place at the top
// of the list. A source that gives only the date (midnight, no time) counts
// as fresh on the day it was posted, as "Posted today".

const HOUR_MS = 60 * 60 * 1000;

/** Whether a posting time holds a time of day, or only the date (midnight UTC exactly). */
export const hasTimeOfDay = (posted: Date) => posted.getUTCHours() + posted.getUTCMinutes() + posted.getUTCSeconds() + posted.getUTCMilliseconds() > 0;

/**
 * "Posted 3 hours ago", "Posted under an hour ago" or, with only a date,
 * "Posted today", while the job is within `hours` of being posted; null once
 * it isn't, or when when it was posted isn't known.
 */
export function freshLabel(postedAt: string | Date | null | undefined, now: Date, hours: number): string | null {
  if (!postedAt || hours <= 0) return null;
  const posted = typeof postedAt === "string" ? new Date(postedAt) : postedAt;
  if (Number.isNaN(posted.getTime())) return null;
  const age = now.getTime() - posted.getTime();
  if (hasTimeOfDay(posted)) {
    if (age < -HOUR_MS || age >= hours * HOUR_MS) return null;
    const whole = Math.floor(Math.max(0, age) / HOUR_MS);
    return whole < 1 ? "Posted under an hour ago" : `Posted ${whole} ${whole === 1 ? "hour" : "hours"} ago`;
  }
  // Only the date: fresh on that day.
  return posted.toISOString().slice(0, 10) === now.toISOString().slice(0, 10) ? "Posted today" : null;
}

/** The reason the fresh bonus leaves on a score (scoring/index.ts): "Posted 3 hours ago: +5 for applying early." */
const BONUS_REASON = /: \+(\d+) for applying early\.$/;

/**
 * A score as it stands now: the fresh bonus it was given comes off once the
 * posting is past your fresh window, with its reason. No AI is asked; the
 * points come from the bonus's own reason, so exactly what was added goes.
 */
export function withoutStaleBonus<T extends { score: number; reasons: readonly string[] }>(scored: T, postedAt: string | Date | null | undefined, now: Date, hours: number): T {
  const at = scored.reasons.findIndex((reason) => BONUS_REASON.test(reason));
  if (at < 0 || freshLabel(postedAt, now, hours)) return scored;
  const points = Number(BONUS_REASON.exec(scored.reasons[at])![1]);
  return { ...scored, score: Math.max(0, scored.score - points), reasons: scored.reasons.filter((_, index) => index !== at) };
}

/** Fresh postings first, then by score, best first. */
export function freshFirst<T extends { fresh?: string | null; score: number }>(items: readonly T[]): T[] {
  return items.toSorted((a, b) => Number(Boolean(b.fresh)) - Number(Boolean(a.fresh)) || b.score - a.score);
}
