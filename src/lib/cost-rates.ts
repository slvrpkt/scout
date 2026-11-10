// What Scout's outside services cost, as their price lists say. Hosting here
// costs nothing, so these are the only cost centers. Estimates: each service's
// own bill has the last word.

/** The day the prices below were last looked up. */
export const PRICES_AS_OF = "November 7, 2026";

export const COST_CENTERS = ["ANTHROPIC", "OPENAI", "MISTRAL", "LOCAL_AI", "TYPESAFE", "JSEARCH", "ADZUNA", "FREEHIRE", "ARBEITSAGENTUR"] as const;
export type CostCenter = (typeof COST_CENTERS)[number];

export const CENTER_LABELS: Record<CostCenter, string> = {
  ANTHROPIC: "Anthropic (AI)",
  OPENAI: "OpenAI-compatible (AI)",
  MISTRAL: "Mistral (AI)",
  LOCAL_AI: "Local model (AI)",
  TYPESAFE: "TypeSafe Jev (scoring)",
  JSEARCH: "JSearch (job search)",
  ADZUNA: "Adzuna (job search)",
  FREEHIRE: "FreeHire (job search)",
  ARBEITSAGENTUR: "Bundesagentur für Arbeit (job search)",
};

/** These cost nothing, so there's nothing to set a limit on. */
export const FREE_CENTERS: readonly CostCenter[] = ["LOCAL_AI", "ADZUNA", "FREEHIRE", "ARBEITSAGENTUR"];

/** The services that hold the AI's spending, for the breakdown by use. */
export const AI_CENTERS: readonly CostCenter[] = ["ANTHROPIC", "OPENAI", "MISTRAL"];

/** JSearch's price: $0.03 for 10 requests. */
export const JSEARCH_REQUEST_COST = 0.003;

/** TypeSafe's price for Jev, per million input tokens; output is free. */
export const JEV_INPUT_RATE = 0.042;

type Rates = { input: number; cacheWrite?: number; cacheRead?: number; output: number };

/** Dollars per million tokens, longest name first where one starts another. */
const MODEL_RATES: readonly [string, Rates][] = [
  ["claude-fable-5-1", { input: 10, cacheWrite: 12.5, cacheRead: 0.25, output: 50 }],
  ["claude-fable-5", { input: 10, cacheWrite: 12.5, cacheRead: 1, output: 50 }],
  ["claude-opus-5-5", { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 }],
  ["claude-opus-5", { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 }],
  ["claude-opus-4", { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 }],
  ["claude-sonnet-5-5", { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 }],
  ["claude-sonnet-5", { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 }],
  ["claude-sonnet-4", { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 }],
  ["claude-haiku-5-5", { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 }],
  ["claude-haiku-4-5", { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 }],
  // From third-party price lists, which don't all agree: check the service's own page.
  ["gpt-5-mini", { input: 0.25, output: 2 }],
  ["gpt-5", { input: 1.25, output: 10 }],
  ["gpt-4o-mini", { input: 0.15, output: 0.6 }],
  ["mistral-large", { input: 0.5, output: 1.5 }],
  ["mistral-medium", { input: 1.5, output: 7.5 }],
  ["mistral-small", { input: 0.15, output: 0.6 }],
];

/** For a model not listed, so an estimate doesn't run low. */
const UNKNOWN_MODEL: Rates = { input: 1, output: 5 };

/** The batch price is half the normal one. */
const BATCH_SHARE = 0.5;

export type TokenUse = { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };

/** What a request cost, in dollars. */
export function costOfTokens(model: string, usage: TokenUse, { batch = false } = {}): number {
  const rates = MODEL_RATES.find(([name]) => model.toLowerCase().includes(name))?.[1] ?? UNKNOWN_MODEL;
  const dollars = (usage.input_tokens * rates.input + (usage.cache_creation_input_tokens ?? 0) * (rates.cacheWrite ?? rates.input) + (usage.cache_read_input_tokens ?? 0) * (rates.cacheRead ?? rates.input) + usage.output_tokens * rates.output) / 1_000_000;
  return batch ? dollars * BATCH_SHARE : dollars;
}

export const LIMIT_PERIODS = ["day", "week", "month"] as const;
export type LimitPeriod = (typeof LIMIT_PERIODS)[number];

export type CostLimits = Partial<Record<CostCenter, Partial<Record<LimitPeriod, number | null>>>>;
export type CostTotals = Record<LimitPeriod, Record<CostCenter, number>>;
export type OverLimit = { center: CostCenter; period: LimitPeriod; limit: number; spent: number };

/** Which limits have been passed; an empty limit is no limit. */
export function limitsPassed(limits: CostLimits, totals: CostTotals): OverLimit[] {
  return COST_CENTERS.flatMap((center) =>
    LIMIT_PERIODS.flatMap((period) => {
      const limit = limits[center]?.[period];
      const spent = totals[period][center];
      return limit !== null && limit !== undefined && limit > 0 && spent >= limit ? [{ center, period, limit, spent }] : [];
    }),
  );
}

export const dollars = (amount: number) => (amount > 0 && amount < 0.01 ? "under $0.01" : `$${amount.toFixed(2)}`);

const PERIOD_WORDS: Record<LimitPeriod, string> = { day: "today", week: "this week", month: "this month" };

const SEARCH_CENTERS: readonly CostCenter[] = ["JSEARCH", "ADZUNA", "FREEHIRE", "ARBEITSAGENTUR"];

/** What a limit stops: its own service's work, and nothing else. */
const pauses = (center: CostCenter) => (SEARCH_CENTERS.includes(center) ? "Job searches are paused." : center === "TYPESAFE" ? "Scoring is paused." : "AI work is paused, including resume and letter writing.");

/** The service an AI provider bills through. */
export const aiCenter = (provider: string | null | undefined): CostCenter | null => (provider === "ANTHROPIC" || provider === "OPENAI" || provider === "MISTRAL" ? provider : null);

/** In words, for the Agent screen and the alert. */
export const overLimitText = ({ center, period, limit, spent }: OverLimit) => `${CENTER_LABELS[center]} has reached ${dollars(spent)} ${PERIOD_WORDS[period]}, past your limit of ${dollars(limit)}. ${pauses(center)}`;

/** The services in use: what's chosen in Settings, and anything that's cost something. */
export function centersInUse(chosen: readonly (CostCenter | null)[], spent: Record<CostCenter, number>): CostCenter[] {
  return COST_CENTERS.filter((center) => chosen.includes(center) || spent[center] > 0);
}
