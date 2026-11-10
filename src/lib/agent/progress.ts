/** A batch of scores usually comes back in about this long. */
const SCORING_MS = 20 * 60 * 1000;
const SEARCH_WAIT_MS = 30 * 60 * 1000;

const clock = (date: Date, timeZone: string) => new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);

/** What the agent is up to, with when to check back, or null when it's idle. Times are estimates. */
export function progressMessage({ searching, scoreAt, batchAt, now, timeZone }: { searching: boolean; scoreAt: string | null; batchAt: string | null; now: Date; timeZone: string }): string | null {
  const start = scoreAt ? new Date(Math.max(Date.parse(scoreAt), now.getTime())) : new Date(now.getTime() + SEARCH_WAIT_MS);
  if (searching) return `Scout is looking for new jobs. Check back around ${clock(new Date(start.getTime() + SCORING_MS), timeZone)} for the new batch and its scores.`;
  if (batchAt) return `Scout is scoring a new batch of jobs. Check back around ${clock(new Date(Math.max(Date.parse(batchAt) + SCORING_MS, now.getTime() + 5 * 60 * 1000)), timeZone)}.`;
  if (scoreAt) return `A new batch of jobs is in. Scoring starts around ${clock(start, timeZone)}, so check back around ${clock(new Date(start.getTime() + SCORING_MS), timeZone)}.`;
  return null;
}
