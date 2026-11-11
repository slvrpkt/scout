import { z } from "zod";

// Your say in a posting's score, Settings → Scoring: how much the AI's fit
// counts, and points for work style, pay and distance that plain code works
// out, the same every time and for free. Words that rule a job out, and jobs
// too far away, are set aside before anything is paid for.

export const WORK_STYLES = ["remote", "hybrid", "onsite"] as const;
export type WorkStyle = (typeof WORK_STYLES)[number];
export const WORK_STYLE_NAMES: Record<WorkStyle | "unknown", string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site", unknown: "Not stated" };

export const MILES_OPTIONS = [10, 20, 30, 40, 50, 75, 100, 150] as const;
/** Pay below your lowest scores less the further below it is, never less than this share. */
export const PAY_FLOOR = 25;
export const MAX_RULE_OUT_WORDS = 100;

const share = z.number().int().min(0).max(100);
const points = z
  .number()
  .int()
  .min(0)
  .max(100)
  .refine((value) => value % 5 === 0, "Points go in steps of 5.");
const pay = z.number().int().min(0).max(10_000_000).nullable();

export const scoringPrefsSchema = z.object({
  /** Points for how well the job fits your profile, which the AI judges. */
  fitPoints: points,
  work: z.object({ points, remote: share, hybrid: share, onsite: share, unknown: share }),
  /** Yearly pay. Between lowest and highest the points rise; below lowest they fall, to PAY_FLOOR at most. */
  pay: z.object({ points, low: pay, high: pay, unknown: share }),
  /** Distance from your ZIP code, for hybrid and on-site jobs; remote ones get all the points. */
  place: z.object({ points, zip: z.string().trim().max(10).regex(/^(\d{5})?$/, "A 5-digit ZIP code."), miles: z.number().int().min(1).max(500), ruleOutFar: z.boolean(), unknown: share }),
  /** Words that rule a job out when the posting has them. */
  ruleOut: z.array(z.string().trim().min(1).max(80)).max(MAX_RULE_OUT_WORDS),
  /** Extra points for a job posted within `hours`, listed first: applying early gets more responses. */
  fresh: z.object({ hours: z.number().int().min(0).max(72), points: z.number().int().min(0).max(20) }).default({ hours: 12, points: 5 }),
});
export type ScoringPrefs = z.infer<typeof scoringPrefsSchema>;

export const DEFAULT_SCORING_PREFS: ScoringPrefs = {
  fitPoints: 60,
  work: { points: 20, remote: 100, hybrid: 70, onsite: 30, unknown: 40 },
  // About the posted base pay of a Technical Project Manager in the US, November 2026.
  pay: { points: 15, low: 110_000, high: 150_000, unknown: 50 },
  place: { points: 5, zip: "", miles: 30, ruleOutFar: true, unknown: 50 },
  ruleOut: [],
  fresh: { hours: 12, points: 5 },
};

/** Only the AI's fit counts, as before your settings: for tests, and a fresh start without a say. */
export const NEUTRAL_SCORING_PREFS: ScoringPrefs = {
  fitPoints: 100,
  work: { ...DEFAULT_SCORING_PREFS.work, points: 0 },
  pay: { ...DEFAULT_SCORING_PREFS.pay, points: 0 },
  place: { ...DEFAULT_SCORING_PREFS.place, points: 0, ruleOutFar: false },
  ruleOut: [],
  fresh: { hours: 12, points: 0 },
};

export type Point = { lat: number; lng: number };
export type PrefPosting = { title: string; description: string; remote: boolean | null; salary: string; lat?: number | null; lng?: number | null };

// "Hybrid", but not "hybrid cloud" and the like.
const HYBRID = /\bhybrid\b(?!\s+(?:cloud|infrastructure|environments?|it\b|apps?|mobile|solutions?|architecture|integration|systems?|work ?loads?|vehicles?|data|networks?))|\b[1-4]\s*(?:-|–|to|or)?\s*[1-4]?\s*days?\s*(?:a|per|each|\/)?\s*week\b.{0,40}\b(?:office|on[- ]?site|in[- ]person)/i;
// "Fully remote", "100% U.S.-based remote", "a remote position" (but not "not a remote position"), "work from anywhere"…
const REMOTE = /\b(?:fully|100%|completely)\s+(?:(?:u\.?s\.?|us|usa|united states)[- ]based\s+)?remote\b|\bremote[- ](?:first|only)\b|\bwork from (?:home|anywhere)\b|\bremote,? (?:us|usa|united states)\b|(?<!\bnot (?:an? )?)\bremote (?:position|role|job|opportunity)\b/i;
const ONSITE = /\b(?:on[- ]?site|in[- ]office|in[- ]person)\b(?!\s*(?:or|\/)\s*remote)/i;

/** Remote, hybrid or on-site, from the source's flag and the posting's words; null when it can't tell. */
export function workStyleOf(posting: PrefPosting): WorkStyle | null {
  const text = `${posting.title}\n${posting.description}`;
  // Said plainly, remote wins over a passing mention of hybrid work or an office:
  // "Remote" in the title, or "fully remote", "remote-first", "work from anywhere"…
  if (/\bremote\b/i.test(posting.title) && !HYBRID.test(posting.title)) return "remote";
  if (REMOTE.test(text)) return "remote";
  if (HYBRID.test(text)) return "hybrid";
  if (posting.remote === true) return "remote";
  if (posting.remote === false || ONSITE.test(text)) return "onsite";
  return null;
}

export type PayRange = { low: number; high: number };

const PER: [RegExp, number][] = [
  [/\b(?:an?|per|\/)\s*(?:hour|hr)\b|\bhourly\b/i, 2080],
  [/\b(?:an?|per|\/)\s*day\b|\bdaily\b/i, 260],
  [/\b(?:an?|per|\/)\s*week\b|\bweekly\b/i, 52],
  [/\b(?:an?|per|\/)\s*(?:month|mo)\b|\bmonthly\b/i, 12],
];
const AMOUNT = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kK])?/g;

/** The yearly pay a piece of text gives, as a range; null when there's none. */
export function payIn(text: string): PayRange | null {
  const amounts = [...text.matchAll(AMOUNT)].map(([, number, k]) => Number(number.replace(/,/g, "")) * (k ? 1000 : 1)).filter((value) => value >= 7);
  if (amounts.length === 0) return null;
  const per = PER.find(([words]) => words.test(text))?.[1] ?? (Math.max(...amounts) < 300 ? 2080 : 1);
  const yearly = amounts.slice(0, 2).map((value) => Math.round(value * per));
  if (Math.max(...yearly) < 15_000 || Math.max(...yearly) > 5_000_000) return null;
  return { low: Math.min(...yearly), high: Math.max(...yearly) };
}

const PAY_IN_TEXT = /\$\s?\d[\d,.]*\s?[kK]?(?:\s*(?:-|–|—|to)\s*\$?\s?\d[\d,.]*\s?[kK]?)?(?:\s*(?:USD)?\s*(?:an?|per|\/)\s*(?:hour|hr|year|yr|annum|month|mo|week|day))?/g;

const PAY_WORDS = /\b(?:salary|pay|compensation|wages?|base|rate|range|earn)\b/i;

/** The posting's yearly pay: the source's salary, else the first pay range written in the posting. */
export function payOf(posting: PrefPosting): PayRange | null {
  if (posting.salary.trim()) {
    const given = payIn(posting.salary);
    if (given) return given;
  }
  // Only an amount said to be the pay: a 401(k) match or a bonus isn't.
  for (const match of posting.description.matchAll(PAY_IN_TEXT)) {
    const before = posting.description.slice(Math.max(0, match.index - 80), match.index);
    if (!PAY_WORDS.test(before)) continue;
    const found = payIn(match[0]);
    if (found && found.high >= 20_000) return found;
  }
  return null;
}

/** Miles between two points. */
export function milesBetween(a: Point, b: Point): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first of your words the posting has, as a whole word, or null. */
export function ruleOutWord(posting: Pick<PrefPosting, "title" | "description">, words: readonly string[]): string | null {
  const text = `${posting.title}\n${posting.description}`;
  for (const word of words) {
    const trimmed = word.trim();
    if (!trimmed) continue;
    const start = /^\w/.test(trimmed) ? "\\b" : "";
    const end = /\w$/.test(trimmed) ? "\\b" : "";
    if (new RegExp(`${start}${escape(trimmed).replace(/\s+/g, "\\s+")}${end}`, "i").test(text)) return trimmed;
  }
  return null;
}

/** What code knows of a posting, before the AI or with its help. */
export type PrefFacts = { style: WorkStyle | null; pay: PayRange | null; miles: number | null };

export function factsOf(posting: PrefPosting, home: Point | null): PrefFacts {
  const at = posting.lat != null && posting.lng != null ? { lat: posting.lat, lng: posting.lng } : null;
  return { style: workStyleOf(posting), pay: payOf(posting), miles: home && at ? Math.round(milesBetween(home, at)) : null };
}

/** The share of the pay points, from the top of the posting's range, since pay can be negotiated up. */
export function payShare(range: PayRange, prefs: ScoringPrefs["pay"]): number | null {
  const low = prefs.low ?? prefs.high;
  const high = Math.max(prefs.high ?? prefs.low ?? 0, low ?? 0);
  if (low == null) return null;
  const top = range.high;
  if (top >= high) return 100;
  if (top >= low) return high === low ? 100 : Math.round(70 + (30 * (top - low)) / (high - low));
  // Below your lowest: less the further below, reaching the floor 30% under it.
  return Math.max(PAY_FLOOR, Math.round(70 - (45 * (low - top)) / (0.3 * low)));
}

/** The share of the distance points: all of them at home, 60% at your limit, little past it. */
export function placeShare(facts: PrefFacts, prefs: ScoringPrefs["place"]): number {
  if (facts.style === "remote") return 100;
  if (facts.miles == null) return prefs.unknown;
  if (facts.miles <= prefs.miles) return Math.round(100 - (40 * facts.miles) / prefs.miles);
  return facts.miles <= prefs.miles * 2 ? 20 : 0;
}

const money = (value: number) => `$${Math.round(value / 1000)}k`;

/** A line of the score's breakdown; "yours" for the parts your settings give. */
export type PrefLine = { label: string; points: number; earned: number; verdict: "yours"; note: string };

/** Your settings' lines of the breakdown, for what code knows. Parts with no points are left out. */
export function prefLines(facts: PrefFacts, prefs: ScoringPrefs): PrefLine[] {
  const lines: PrefLine[] = [];
  const line = (label: string, points: number, value: number, note: string) => lines.push({ label, points, earned: Math.round(points * value) / 100, verdict: "yours", note });
  if (prefs.work.points > 0) {
    const style = facts.style ?? "unknown";
    line(`Work style: ${WORK_STYLE_NAMES[style]}`, prefs.work.points, prefs.work[style], `${WORK_STYLE_NAMES[style]} gets ${prefs.work[style]}% of these points`);
  }
  const payValue = facts.pay ? payShare(facts.pay, prefs.pay) : null;
  if (prefs.pay.points > 0 && (prefs.pay.low != null || prefs.pay.high != null)) {
    const range = facts.pay ? (facts.pay.low === facts.pay.high ? money(facts.pay.high) : `${money(facts.pay.low)}–${money(facts.pay.high)}`) : null;
    const below = facts.pay && prefs.pay.low != null && facts.pay.high < prefs.pay.low;
    line(range ? `Pay: ${range} a year` : "Pay: not listed", prefs.pay.points, payValue ?? prefs.pay.unknown, range ? (below ? "Below your lowest: fewer points, not none, since pay can be negotiated" : "Compared with your range, by the top of theirs") : `Not listed gets ${prefs.pay.unknown}%`);
  }
  if (prefs.place.points > 0) {
    const label = facts.style === "remote" ? "Distance: remote" : facts.miles == null ? "Distance: unknown" : `Distance: about ${facts.miles} miles`;
    line(label, prefs.place.points, placeShare(facts, prefs.place), facts.style === "remote" ? "Remote, so distance doesn't matter" : facts.miles == null ? `Unknown gets ${prefs.place.unknown}%` : `Your limit is ${prefs.place.miles} miles`);
  }
  return lines;
}

/** Why a posting is set aside before the AI, or null: one of your words, or too far for a job you'd have to go in for. */
export function ruledOut(posting: PrefPosting, facts: PrefFacts, prefs: ScoringPrefs): { rule: string; note: string } | null {
  const word = ruleOutWord(posting, prefs.ruleOut);
  if (word) return { rule: word, note: "the posting mentions it" };
  if (prefs.place.ruleOutFar && facts.miles != null && facts.miles > prefs.place.miles && (facts.style === "hybrid" || facts.style === "onsite")) {
    return { rule: `within ${prefs.place.miles} miles`, note: `${WORK_STYLE_NAMES[facts.style]}, about ${facts.miles} miles from ${prefs.place.zip}` };
  }
  return null;
}

/** The best score a posting could get: a perfect fit, every criterion met, and the best case for what code can't tell. */
export function bestPossible(facts: PrefFacts, prefs: ScoringPrefs, criteriaPoints: number): number {
  const best = { ...facts, style: facts.style };
  const lines = prefLines(best, prefs).map((line) => {
    const unsure = (line.label.startsWith("Work style") && facts.style === null) || (line.label.startsWith("Pay") && facts.pay === null) || (line.label.startsWith("Distance") && (facts.miles === null || facts.style === null));
    return unsure ? { ...line, earned: line.points } : line;
  });
  const total = prefs.fitPoints + criteriaPoints + lines.reduce((sum, line) => sum + line.points, 0);
  const earned = prefs.fitPoints + criteriaPoints + lines.reduce((sum, line) => sum + line.earned, 0);
  return total > 0 ? Math.floor((earned / total) * 100) : 100;
}
