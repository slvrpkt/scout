import "server-only";

import { mkdir, readdir, rm, stat, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

import { buildExport } from "@/lib/data-export";
export { KEEP_BACKUPS } from "@/lib/settings";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

// Backups (E10-6, E10-7): exports written to DOSSIER_DATA_DIR/backups. They
// never hold the API key in plain text.

export type BackupReason = "before-import" | "nightly";

export const backupsDir = () => path.join(env.DOSSIER_DATA_DIR, "backups");

const pad = (value: number) => String(value).padStart(2, "0");

/** "dossier-backup-nightly-2026-09-28-030000.json", in the server's time zone. */
export function backupFileName(reason: BackupReason, now: Date): string {
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `dossier-backup-${reason}-${day}-${time}.json`;
}

/** Writes an export of everything to the backups folder; returns the file's name. */
export async function writeBackup(reason: BackupReason, now = new Date()): Promise<string> {
  const data = await buildExport(prisma, { now });
  await mkdir(backupsDir(), { recursive: true });
  const name = backupFileName(reason, now);
  await writeFile(path.join(backupsDir(), name), JSON.stringify(data, null, 2));
  return name;
}

/** The backup files, newest first. */
export async function listBackups(): Promise<{ name: string; modified: Date }[]> {
  const names = (await readdir(backupsDir()).catch(() => [])).filter((name) => /^dossier-backup-.*\.json$/.test(name));
  const files = await Promise.all(names.map(async (name) => ({ name, modified: (await stat(path.join(backupsDir(), name))).mtime })));
  return files.sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

/** How many backups there are, how much room they take, and the oldest one's date. */
export async function backupUsage(): Promise<{ count: number; bytes: number; oldest: Date | null }> {
  const files = await listBackups();
  const sizes = await Promise.all(files.map(async (file) => (await stat(path.join(backupsDir(), file.name)).catch(() => null))?.size ?? 0));
  return { count: files.length, bytes: sizes.reduce((sum, size) => sum + size, 0), oldest: files.at(-1)?.modified ?? null };
}

/** Deletes the backups older than `days` (all of them with 0); returns how many went. */
export async function clearBackups(days: number, now = new Date()): Promise<number> {
  const cutoff = days === 0 ? Infinity : now.getTime() - days * 24 * 60 * 60 * 1000;
  const old = (await listBackups()).filter((backup) => backup.modified.getTime() < cutoff);
  await Promise.all(old.map((backup) => unlink(path.join(backupsDir(), backup.name)).catch(() => {})));
  return old.length;
}

/** Deletes every backup file (Delete everything, E10-8). */
export async function deleteAllBackups(): Promise<void> {
  await rm(backupsDir(), { recursive: true, force: true });
}
