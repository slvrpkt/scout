import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { dayOf } from "@/lib/calendar-view";
import { settingsFromRows, type ClearedCounts, type ClearedTally } from "@/lib/settings";
import { saveSettings } from "@/lib/settings-data";

// What the job agent found and later deleted: archived jobs the Archive
// clearing removed, and postings that never got a score (they waited too
// long, or their search was deleted). Each is added to a tally by kind, and
// by the day it was found, so the agent's counts (Today, This week, This
// month, All time) count what was found and never go down.

export type Gone = { createdAt: Date; kind: keyof ClearedCounts };

/** Adds deleted jobs to the tally, inside the transaction that deletes them. One writer at a time, so no count is lost. */
export async function addToClearedTally(tx: Prisma.TransactionClient, gone: readonly Gone[], timeZone: string): Promise<void> {
  if (gone.length === 0) return;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('agentClearedTally'))::text`;
  const row = await tx.setting.findUnique({ where: { key: "agentClearedTally" } });
  const tally: ClearedTally = { ...settingsFromRows(row ? [row] : []).agentClearedTally };
  tally.byDay = { ...tally.byDay };
  for (const { createdAt, kind } of gone) {
    tally[kind] += 1;
    const day = dayOf(createdAt, timeZone);
    tally.byDay[day] = { ...(tally.byDay[day] ?? { setAside: 0, skipped: 0, archived: 0, drafted: 0, unscored: 0 }) };
    tally.byDay[day][kind] += 1;
    const found = createdAt.toISOString();
    if (!tally.since || found < tally.since) tally.since = found;
  }
  await saveSettings({ agentClearedTally: tally }, tx);
}
