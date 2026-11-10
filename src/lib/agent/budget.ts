import "server-only";

import { dayOf } from "@/lib/calendar-view";
import { zonedTime } from "@/lib/google/slots";
import type { AgentUsage } from "@/lib/settings";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// The job agent's daily budgets: how many postings it may score and how many
// drafts it may prepare in a day, across all its runs, so a busy morning run
// can't spend the day's share and a quiet one leaves it for the next. Kept in
// Settings like the runs, so the task-data sweep can't reset them.

/** Today's use, in the user's time zone; a new day starts from nothing. */
export const usageOn = (usage: AgentUsage | null, day: string): AgentUsage => (usage?.day === day ? usage : { day, scored: 0, drafted: 0 });

/** What the agent has used today. */
export async function loadUsage(now: Date, timeZone: string): Promise<AgentUsage> {
  return usageOn((await loadSettings()).agentUsage, dayOf(now, timeZone));
}

/** Counts postings scored or drafts queued against today's budget. */
export async function spend(now: Date, timeZone: string, { scored = 0, drafted = 0 }: { scored?: number; drafted?: number }): Promise<AgentUsage> {
  const today = await loadUsage(now, timeZone);
  const next = { ...today, scored: today.scored + scored, drafted: today.drafted + drafted };
  await saveSettings({ agentUsage: next });
  return next;
}

/** Midnight at the start of `now`'s day in `timeZone`. */
export function startOfDay(now: Date, timeZone: string): Date {
  const [year, month, date] = dayOf(now, timeZone).split("-").map(Number);
  return zonedTime(year, month, date, 0, 0, timeZone);
}
