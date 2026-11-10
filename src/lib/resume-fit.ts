import type { DateSpan } from "@/lib/profile";

// One page rule for every resume, base and tailored. Jobs that ended in the
// last 7 years (at least 3 jobs) get the most room, the most recent the most;
// older jobs get 1 or 2 points. A resume over its page limit is trimmed one
// point at a time: older jobs from the oldest down to 1, then down to their
// title line alone, then projects and publications, then the recent jobs one
// at a time from the oldest of them (the most recent last), never below 2.
// Each trimmed job is rewritten to its new length, keeping the facts
// (condense-bullets), or cut where it can't be.

/** The fewest jobs that count as recent, however long ago they ended. */
export const RECENT_JOBS = 3;
/** Jobs that ended within this many years count as recent. */
export const RECENT_YEARS = 7;
/** Bullets for the older jobs, from the most recent of them; the rest get 1. */
export const OLDER_CAPS = [2, 2, 1] as const;
/** Bullets for every older job when the resume may run to three pages. */
export const THREE_PAGE_OLDER_CAP = 3;
/** Recent jobs are never trimmed below this. */
export const RECENT_FLOOR = 2;
/** Only when nothing else gets a resume within its page limit: the recent jobs go down to this, the most recent last. */
export const LAST_RESORT_FLOOR = 1;

export type FitJob = { id: string; bullets: number } & DateSpan;

/** How many bullets a job gets when they're chosen from a longer pool: at least and at most. */
export type Budget = { min: number; max: number };

/**
 * How many of the jobs count as recent: current ones and those that ended in
 * the last 7 years (by year), and never fewer than 3.
 */
export function recentCount(jobs: readonly DateSpan[], now = new Date()): number {
  const since = now.getFullYear() - RECENT_YEARS;
  const recent = jobs.filter((job) => job.current || (job.endYear ?? job.startYear ?? -Infinity) >= since).length;
  return Math.min(jobs.length, Math.max(RECENT_JOBS, recent));
}

// Bullets per job by how recent it is: the most recent gets the most room,
// each recent job a little less, recent jobs past the 4th share `rest`, and
// older jobs get `older` (1 or 2 at two pages).
const BUDGETS: Record<1 | 2 | 3, { recent: Budget[]; rest: Budget; older: Budget }> = {
  1: { recent: [{ min: 4, max: 5 }, { min: 3, max: 4 }, { min: 2, max: 3 }, { min: 2, max: 3 }], rest: { min: 2, max: 2 }, older: { min: 1, max: 1 } },
  2: { recent: [{ min: 6, max: 8 }, { min: 5, max: 7 }, { min: 5, max: 6 }, { min: 3, max: 5 }], rest: { min: 3, max: 4 }, older: { min: 1, max: 2 } },
  3: { recent: [{ min: 8, max: 10 }, { min: 7, max: 8 }, { min: 6, max: 7 }, { min: 5, max: 6 }], rest: { min: 4, max: 5 }, older: { min: 2, max: 3 } },
};

/**
 * Each job's bullet budget at `maxPages` (1, 2 or 3), most recent first:
 * never more than it has, nor fewer than 1. Null when there's no limit.
 */
export function bulletBudgets(jobs: readonly FitJob[], maxPages: number | null | undefined, now = new Date()): Map<string, Budget> | null {
  if (maxPages === null || maxPages === undefined) return null;
  const rule = BUDGETS[Math.min(3, Math.max(1, maxPages)) as 1 | 2 | 3];
  const bullets = new Map(jobs.map((job) => [job.id, job.bullets]));
  const recent = recentCount(jobs, now);
  const ranked = byRecency(jobs);
  return new Map(
    ranked.map((id, rank) => {
      const budget = rank < recent ? (rule.recent[rank] ?? rule.rest) : rule.older;
      const has = Math.max(1, bullets.get(id) ?? 1);
      return [id, { min: Math.min(budget.min, has), max: Math.min(budget.max, has) }];
    }),
  );
}

/** The jobs' ids, most recent first: current ones, then by when they ended, then by when they started. */
export function byRecency(jobs: readonly ({ id: string } & DateSpan)[]): string[] {
  const end = (job: DateSpan) => (job.current ? Infinity : (job.endYear ?? job.startYear ?? -Infinity) * 12 + (job.endMonth ?? job.startMonth ?? 0));
  const start = (job: DateSpan) => (job.startYear ?? -Infinity) * 12 + (job.startMonth ?? 0);
  return jobs.toSorted((a, b) => end(b) - end(a) || start(b) - start(a)).map((job) => job.id);
}

/**
 * Each job's bullets before any trimming: all for the recent ones, then 2, 2
 * and 1 for older jobs, or up to 3 for every older job when `maxPages` is 3,
 * or all of them when it's null (no limit). Never more than it has.
 */
export function startingCounts(jobs: readonly FitJob[], maxPages?: number | null, now = new Date()): Map<string, number> {
  const bullets = new Map(jobs.map((job) => [job.id, job.bullets]));
  const recent = recentCount(jobs, now);
  return new Map(
    byRecency(jobs).map((id, rank) => {
      if (rank < recent || maxPages === null) return [id, bullets.get(id)!];
      const cap = maxPages === 3 ? THREE_PAGE_OLDER_CAP : (OLDER_CAPS[rank - recent] ?? 1);
      return [id, Math.min(bullets.get(id)!, cap)];
    }),
  );
}

/** One trim: a bullet off a job, or a project or publication left out. */
export type TrimStep = { kind: "bullet"; id: string } | { kind: "leave-out"; id: string };

/**
 * Every trim there is, in order. `ranked` is the jobs most recent first,
 * `counts` their starting bullets, `recent` how many of them count as recent
 * (recentCount); `leaveOut` the projects (oldest first) then the
 * publications (from the bottom), left out between the older and the recent
 * jobs.
 */
export function trimSteps(ranked: readonly string[], counts: ReadonlyMap<string, number>, leaveOut: readonly string[] = [], recent = RECENT_JOBS): TrimStep[] {
  const left = new Map(counts);
  const steps: TrimStep[] = [];
  const rounds = (ids: readonly string[], floor: number) => {
    for (let trimmed = true; trimmed; ) {
      trimmed = false;
      for (const id of ids) {
        if ((left.get(id) ?? 0) <= floor) continue;
        left.set(id, left.get(id)! - 1);
        steps.push({ kind: "bullet", id });
        trimmed = true;
      }
    }
  };
  const older = ranked.slice(recent).toReversed();
  // Older jobs from the oldest, one bullet each per round, down to 1; then to their title line alone, keeping the history.
  rounds(older, 1);
  rounds(older, 0);
  for (const id of leaveOut) steps.push({ kind: "leave-out", id });
  // Then the recent jobs one at a time, the oldest of them first and the most recent last, each down to RECENT_FLOOR.
  for (const id of ranked.slice(0, recent).toReversed()) rounds([id], RECENT_FLOOR);
  // The very last: the page limit holds, so the recent jobs go down to one point each, in the same order.
  for (const id of ranked.slice(0, recent).toReversed()) rounds([id], LAST_RESORT_FLOOR);
  return steps;
}

/** The bullets per job and what's left out after the first `taken` trims. */
export function afterSteps(counts: ReadonlyMap<string, number>, steps: readonly TrimStep[], taken: number): { counts: Map<string, number>; leftOut: Set<string> } {
  const left = new Map(counts);
  const leftOut = new Set<string>();
  for (const step of steps.slice(0, taken)) {
    if (step.kind === "bullet") left.set(step.id, left.get(step.id)! - 1);
    else leftOut.add(step.id);
  }
  return { counts: left, leftOut };
}

/**
 * The fewest trims that fit, found by halving: fewer trims never fit where
 * more don't. `fits(k)` renders the resume with the first k trims. Returns
 * all of them, not fitting, when even that runs over.
 */
export async function fewestTrims(total: number, fits: (taken: number) => Promise<boolean>): Promise<{ taken: number; fits: boolean }> {
  if (await fits(0)) return { taken: 0, fits: true };
  if (total === 0 || !(await fits(total))) return { taken: total, fits: false };
  let low = 0; // doesn't fit
  let high = total; // fits
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (await fits(middle)) high = middle;
    else low = middle;
  }
  return { taken: high, fits: true };
}

/**
 * A job's bullets at `count`: as written when it has that many or fewer;
 * none at 0 (its title and dates only); else its rewrite at that count, or
 * where that couldn't be written, the shortest rewrite longer than it, or as
 * written. Points are never simply cut off. Says which it was.
 */
export function bulletsAt(
  bullets: readonly string[],
  count: number,
  rewrites: Readonly<Record<string | number, readonly string[]>> | undefined,
): { bullets: string[]; how: "as-written" | "summarized" | "title-only" } {
  if (bullets.length <= count) return { bullets: [...bullets], how: "as-written" };
  if (count <= 0) return { bullets: [], how: "title-only" };
  const nearest = Object.entries(rewrites ?? {})
    .map(([length, lines]) => ({ length: Number(length), lines }))
    .filter(({ length, lines }) => length >= count && length < bullets.length && lines.length === length)
    .toSorted((a, b) => a.length - b.length)[0];
  return nearest ? { bullets: [...nearest.lines], how: "summarized" } : { bullets: [...bullets], how: "as-written" };
}

/**
 * How many trims keep the recent jobs whole: older jobs and the projects and
 * publications. Past it, two pages costs the resume's best part, so the user
 * is asked whether a third page may be used instead.
 */
export function wholeRecentTrims(steps: readonly TrimStep[], ranked: readonly string[], count = RECENT_JOBS): number {
  const recent = new Set(ranked.slice(0, count));
  const first = steps.findIndex((step) => step.kind === "bullet" && recent.has(step.id));
  return first < 0 ? steps.length : first;
}

/** What /api/pdf answers when the base resume needs a say on a third page; the download button asks and tries again. */
export const THIRD_PAGE_QUESTION = "third-page";

/** Whether a resume may use a third page when two would mean shortening its recent jobs: ask first, allowed, or not. */
export type ThirdPage = "ask" | "allow" | "deny";

/**
 * The trims to make under the two-page rule, given `fits(k, pages)`. Two
 * pages first, trimming only what keeps the recent jobs whole. If that's not
 * enough: "ask" stops with `ask: true`; "allow" fits three pages (shortening
 * recent jobs only if even three need it); "deny" keeps to two pages,
 * shortening the recent jobs. A limit other than 2 just fits that limit.
 */
export async function chooseTrims(
  total: number,
  wholeRecent: number,
  limit: number,
  thirdPage: ThirdPage,
  fits: (taken: number, pages: number) => Promise<boolean>,
): Promise<{ taken: number; fits: boolean; pages: number; ask: boolean }> {
  const within = async (upTo: number, pages: number) => ({ ...(await fewestTrims(upTo, (taken) => fits(taken, pages))), pages, ask: false });
  if (limit !== 2) return within(total, limit);
  const two = await within(wholeRecent, 2);
  if (two.fits) return two;
  if (thirdPage === "ask") return { taken: 0, fits: false, pages: 2, ask: true };
  if (thirdPage === "deny") return within(total, 2);
  const three = await within(wholeRecent, 3);
  return three.fits ? three : within(total, 3);
}
