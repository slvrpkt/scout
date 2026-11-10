"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action } from "@/lib/action";
import { COST_CENTERS } from "@/lib/cost-rates";
import { countWaiting } from "@/lib/agent/score-queue";
import { loadSettings, saveSettings } from "@/lib/settings-data";

const limit = z.number().positive().max(100_000).nullable();
const center = z.object({ day: limit.optional(), week: limit.optional(), month: limit.optional() });

/** A daily, weekly and monthly limit per service. */
export const saveCostLimits = action(z.object({ limits: z.partialRecord(z.enum(COST_CENTERS), center) }), async ({ limits }, { toast }) => {
  await saveSettings({ costLimits: limits });
  // A limit raised unlocks at once: searches and AI work check it each time, and what's waiting gets scored.
  const { agentBatchId, agentScoreAt } = await loadSettings();
  if (!agentBatchId && !agentScoreAt && (await countWaiting()) > 0) await saveSettings({ agentScoreAt: new Date().toISOString() });
  revalidatePath("/", "layout");
  toast("Cost limits saved.");
  return null;
});
