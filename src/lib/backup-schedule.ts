import "server-only";

import { readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { backupsDir, listBackups, writeBackup } from "@/lib/backups";
import { env } from "@/lib/env";
import { loadGoogleAccount } from "@/lib/google/account";
import { createFolder, stillThere, trashFile, uploadFile } from "@/lib/google/drive";
import { GoogleError } from "@/lib/google/errors";
import { hasScopes } from "@/lib/google/oauth";
import { logServerError } from "@/lib/log";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// Nightly backups (E10-7, SET-10): while "Nightly backups" is on, an export
// is written at 03:00 server time, and backups older than
// DOSSIER_BACKUP_RETENTION_DAYS are removed. A plain timer in this process,
// so it's only safe with a single instance of the app (E12-5).

const HOUR = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A nightly backup this recent counts as tonight's, so a timer firing early can't write two. */
const SAME_NIGHT_MS = 20 * 60 * 60 * 1000;
/** Copies kept in Google Drive; older ones go to its trash. */
export const DRIVE_BACKUPS_KEPT = 14;
const DRIVE_FOLDER = "Scout backups";

/** The next 03:00 in the server's time zone after `now`. */
export function nextRun(now: Date): Date {
  const next = new Date(now);
  next.setHours(HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

/** Deletes backups older than the retention; returns how many went. */
export async function pruneBackups(now: Date, days = env.DOSSIER_BACKUP_RETENTION_DAYS): Promise<number> {
  const cutoff = now.getTime() - days * DAY_MS;
  const old = (await listBackups()).filter((backup) => backup.modified.getTime() < cutoff);
  await Promise.all(old.map((backup) => unlink(path.join(backupsDir(), backup.name)).catch(() => {})));
  return old.length;
}

/**
 * One night's run: a backup if they're on, then tidying up. A failure is
 * kept in Settings, so the row can show it, and cleared by the next success.
 */
export async function runNightlyBackup(now = new Date(), { force = false } = {}): Promise<"written" | "off" | "done"> {
  if (!force && !(await loadSettings()).nightlyBackup) return "off";
  // Tonight's is already written: the timer fired a moment early and is due again.
  const last = await lastNightlyBackup();
  if (!force && last && now.getTime() - last.getTime() < SAME_NIGHT_MS) return "done";
  try {
    const name = await writeBackup("nightly", now);
    await pruneBackups(now);
    await saveSettings({ backupProblem: null });
    await copyToDrive(name).catch((error: unknown) => logServerError("backup to Google Drive", error));
    return "written";
  } catch (error) {
    logServerError("nightly backup", error);
    await saveSettings({ backupProblem: error instanceof Error ? error.message : "The backup couldn't be written." }).catch(() => {});
    throw error;
  }
}

/** When the newest nightly backup was written, if any. */
export async function lastNightlyBackup(): Promise<Date | null> {
  const [latest] = (await listBackups()).filter((backup) => backup.name.startsWith("dossier-backup-nightly-"));
  if (!latest) return null;
  return (await stat(path.join(backupsDir(), latest.name)).catch(() => null))?.mtime ?? null;
}

const globalForSchedule = globalThis as unknown as { backupTimer?: ReturnType<typeof setTimeout> };

/** Starts the nightly timer, once per process (dev reloads keep the one they have). */
export function startBackupSchedule(): void {
  if (globalForSchedule.backupTimer) return;
  const schedule = () => {
    const now = new Date();
    globalForSchedule.backupTimer = setTimeout(() => {
      void runNightlyBackup()
        .catch(() => {})
        .finally(schedule);
    }, nextRun(new Date(now.getTime() + 60_000)).getTime() - now.getTime());
    // Don't keep the process alive just for this.
    globalForSchedule.backupTimer.unref?.();
  };
  schedule();
  // A night missed while the computer was off or asleep: catch up a little after starting.
  const catchUp = setTimeout(() => {
    void lastNightlyBackup()
      .then((last) => (!last || Date.now() - last.getTime() > DAY_MS ? runNightlyBackup() : null))
      .catch(() => {});
  }, 2 * 60 * 1000);
  catchUp.unref?.();
}

/**
 * Copies a backup to Google Drive's "Scout backups" folder, when that's on
 * and Drive is allowed, keeping the newest DRIVE_BACKUPS_KEPT; older copies
 * go to Drive's trash. A failure is kept in Settings for the Your data row.
 */
export async function copyToDrive(name: string): Promise<boolean> {
  const settings = await loadSettings();
  const account = await loadGoogleAccount();
  if (!settings.backupToDrive || !account || !hasScopes(account.scopes, "drive")) return false;
  try {
    let folder = settings.driveBackupFolder;
    if (!folder || !(await stillThere(folder))) folder = await createFolder(DRIVE_FOLDER);
    const data = new Uint8Array(await readFile(path.join(backupsDir(), name)));
    const id = await uploadFile({ name, contentType: "application/json", data, parent: folder });
    const files = [{ id, name }, ...settings.driveBackupFiles];
    for (const old of files.slice(DRIVE_BACKUPS_KEPT)) await trashFile(old.id);
    await saveSettings({ driveBackupFolder: folder, driveBackupFiles: files.slice(0, DRIVE_BACKUPS_KEPT), driveBackupProblem: null });
    return true;
  } catch (error) {
    await saveSettings({ driveBackupProblem: error instanceof GoogleError ? error.message : "The copy to Google Drive didn't work." }).catch(() => {});
    throw error;
  }
}
