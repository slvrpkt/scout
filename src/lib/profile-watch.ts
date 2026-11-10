import "server-only";

import { createHash } from "node:crypto";

import { queueBaseResumeSummaries } from "@/lib/base-resume";
import { queueDraftRedo } from "@/lib/jobs/redo-drafts";
import { logServerError } from "@/lib/log";
import { loadProfile } from "@/lib/profile-data";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// When the profile changes, however it changed, the base resume is fitted
// again and the last few days' unsent drafts are rewritten from it. Older ones
// say they're out of date, with a button. Sent copies stay as they went out. It waits until the profile has been still for a whole check,
// as it saves while you type.

const EVERY_MS = 5 * 60 * 1000;

const globalForWatch = globalThis as unknown as { profileTimer?: ReturnType<typeof setInterval>; lastProfile?: string };

/** One check; returns whether the change was acted on. */
export async function checkProfile(): Promise<boolean> {
  const now = createHash("sha256").update(JSON.stringify(await loadProfile())).digest("hex");
  const settings = await loadSettings();
  if (!settings.profileStamp) {
    await saveSettings({ profileStamp: now });
    return false;
  }
  const changed = now !== settings.profileStamp;
  const still = now === globalForWatch.lastProfile;
  globalForWatch.lastProfile = now;
  if (!changed || !still) return false;
  await saveSettings({ profileStamp: now, profileChangedAt: new Date().toISOString() });
  await queueBaseResumeSummaries();
  await queueDraftRedo();
  return true;
}

export function startProfileWatch(): void {
  if (globalForWatch.profileTimer) return;
  const check = () => void checkProfile().catch((error: unknown) => logServerError("following the profile", error));
  globalForWatch.profileTimer = setInterval(check, EVERY_MS);
  globalForWatch.profileTimer.unref?.();
}
