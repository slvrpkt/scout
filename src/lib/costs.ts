import "server-only";

import { startOfDay } from "@/lib/agent/budget";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import { lastKnownTimeZone } from "@/lib/time-zone";
import { AI_CENTERS, COST_CENTERS, limitsPassed, type CostCenter, type CostLimits, type CostTotals, type OverLimit } from "@/lib/cost-rates";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Notes what a call cost. It never gets in the way of the call. */
export async function recordCost(center: CostCenter, kind: string, amount: number): Promise<void> {
  try {
    await prisma.costEvent.create({ data: { center, kind, amount } });
  } catch (error) {
    logServerError("noting a cost", error);
  }
}

const firstOfMonth = (now: Date, timeZone: string, monthsBack = 0) => {
  const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(now).split("-").map(Number);
  return startOfDay(new Date(Date.UTC(year, month - 1 - monthsBack, 1, 12)), timeZone);
};

const sumSince = async (since?: Date) => {
  const rows = await prisma.costEvent.groupBy({ by: ["center"], _sum: { amount: true }, ...(since ? { where: { at: { gte: since } } } : {}) });
  return Object.fromEntries(COST_CENTERS.map((center) => [center, rows.find((row) => row.center === center)?._sum.amount ?? 0])) as Record<CostCenter, number>;
};

/** Monday of this calendar week. */
const firstOfWeek = (now: Date, timeZone: string) => {
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now));
  return startOfDay(new Date(now.getTime() - weekday * DAY_MS), timeZone);
};

export const COST_PERIODS = [
  { id: "today", label: "Today" },
  { id: "week", label: "Last 7 days" },
  { id: "month", label: "This month" },
  { id: "months3", label: "Last 3 months" },
  { id: "months6", label: "Last 6 months" },
  { id: "all", label: "All time" },
] as const;
export type CostPeriod = (typeof COST_PERIODS)[number]["id"];

export type CostView = {
  periods: Record<CostPeriod, Record<CostCenter, number>>;
  /** This month's AI spending by what it went on, biggest first. */
  uses: { kind: string; amount: number }[];
  /** Tracking began with the first cost noted. */
  since: Date | null;
};

export async function loadCosts(now: Date, timeZone: string): Promise<CostView> {
  const weekStart = startOfDay(new Date(now.getTime() - 6 * DAY_MS), timeZone);
  const [today, week, month, months3, months6, all, uses, first] = await Promise.all([
    sumSince(startOfDay(now, timeZone)),
    sumSince(weekStart),
    sumSince(firstOfMonth(now, timeZone)),
    sumSince(firstOfMonth(now, timeZone, 2)),
    sumSince(firstOfMonth(now, timeZone, 5)),
    sumSince(),
    prisma.costEvent.groupBy({ by: ["kind"], where: { center: { in: [...AI_CENTERS] }, at: { gte: firstOfMonth(now, timeZone) } }, _sum: { amount: true } }),
    prisma.costEvent.findFirst({ orderBy: { at: "asc" }, select: { at: true } }),
  ]);
  return {
    periods: { today, week, month, months3, months6, all },
    uses: uses.map((row) => ({ kind: row.kind, amount: row._sum.amount ?? 0 })).toSorted((a, b) => b.amount - a.amount),
    since: first?.at ?? null,
  };
}

/** A service's limit that's been passed, if any: what stops that service's work, and only that. */
export async function limitReached(center: CostCenter | null, now = new Date()): Promise<OverLimit | null> {
  if (!center) return null;
  const [{ costLimits }, timeZone] = await Promise.all([loadSettings(), lastKnownTimeZone()]);
  return (await costLimitsPassed(costLimits, now, timeZone)).find((over) => over.center === center) ?? null;
}

/** The limits passed right now. */
export async function costLimitsPassed(limits: CostLimits, now: Date, timeZone: string): Promise<OverLimit[]> {
  if (!COST_CENTERS.some((center) => limits[center]?.day || limits[center]?.week || limits[center]?.month)) return [];
  // Calendar periods: today, this Monday-to-Sunday week, this month from the 1st.
  const [day, week, month] = await Promise.all([sumSince(startOfDay(now, timeZone)), sumSince(firstOfWeek(now, timeZone)), sumSince(firstOfMonth(now, timeZone))]);
  const totals: CostTotals = { day, week, month };
  return limitsPassed(limits, totals);
}
