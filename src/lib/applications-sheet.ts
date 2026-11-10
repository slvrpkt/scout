import "server-only";

import { loadApplicationRows, type ApplicationRow } from "@/lib/applications-data";
import { DEFAULT_SORT } from "@/lib/applications-list";
import { sheetCsv } from "@/lib/applications-sheet-columns";
import { addDays, dayOf } from "@/lib/calendar-view";
import { rootFolder } from "@/lib/drive-backup";
import { loadGoogleAccount } from "@/lib/google/account";
import { replaceFile, SHEET_TYPE, sheetUrl, stillThere, uploadFile } from "@/lib/google/drive";
import { GoogleError } from "@/lib/google/errors";
import { hasScopes } from "@/lib/google/oauth";
import { zonedTime } from "@/lib/google/slots";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { sampleApplicationIds } from "@/lib/sample-data";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { lastKnownTimeZone } from "@/lib/time-zone";

// The Job application log as a Google Sheet, in the Drive folder what's sent
// is saved in: Sync To Google Sheets on the log, and every weekday at 7 PM.
// Each sync replaces the whole sheet, keeping the file and its link, so it's
// a copy to read, not to edit. It holds the table's columns and nothing
// more, for every application that was sent, archived ones too; drafts never
// sent and sample data stay out.

export const SHEET_NAME = "Job application log";

/** What goes in the sheet: every application that was sent, in the table's order; archived ones and sample data left out. */
export async function sheetRows(now = new Date()): Promise<ApplicationRow[]> {
  const [rows, sample] = await Promise.all([loadApplicationRows({ archived: false, sort: DEFAULT_SORT, fullDates: true }, now), sampleApplicationIds(prisma)]);
  return rows.filter((row) => row.sent !== null && !sample.has(row.id));
}

/** Whether the log can be synced: Google connected with the Drive permission. */
export async function sheetReady(): Promise<boolean> {
  const account = await loadGoogleAccount();
  return account !== null && hasScopes(account.scopes, "drive");
}

// One sync at a time, so the button and the scheduled sync can't both make a sheet.
let running: Promise<unknown> = Promise.resolve();

/** Syncs now: makes the sheet the first time (or in a new main folder), else replaces its contents. Returns its link. */
export function syncSheet(now = new Date()): Promise<string> {
  const sync = running.then(() => syncOnce(now));
  running = sync.catch(() => {});
  return sync;
}

async function syncOnce(now: Date): Promise<string> {
  try {
    const settings = await loadSettings();
    const data = new TextEncoder().encode(sheetCsv(await sheetRows(now)));
    const folderId = await rootFolder(settings.driveFolderName);
    let id = settings.driveSheet?.folderId === folderId ? settings.driveSheet.id : null;
    if (id && !(await stillThere(id))) id = null;
    if (id) {
      await replaceFile(id, { contentType: "text/csv", data });
    } else {
      id = await uploadFile({ name: SHEET_NAME, contentType: "text/csv", data, parent: folderId, as: SHEET_TYPE });
    }
    await saveSettings({ driveSheet: { folderId, id }, driveSheetSyncedAt: now.toISOString(), driveSheetProblem: null });
    return sheetUrl(id);
  } catch (error) {
    const problem = error instanceof GoogleError ? error.message : "Syncing to Google Sheets didn't work. Try again.";
    await saveSettings({ driveSheetProblem: problem });
    throw error;
  }
}

/** Monday to weekday at 19:00, in the user's time zone. */
const SYNC_HOUR = 19;
const isWeekday = (weekday: number) => weekday >= 1 && weekday <= 5;

/** The latest weekday 7 PM at or before `now`, in `timeZone`. */
export function lastScheduledSync(now: Date, timeZone: string): Date {
  let day = dayOf(now, timeZone);
  for (let back = 0; back < 8; back++, day = addDays(day, -1)) {
    const [year, month, date] = day.split("-").map(Number);
    if (!isWeekday(new Date(Date.UTC(year, month - 1, date)).getUTCDay())) continue;
    const slot = zonedTime(year, month, date, SYNC_HOUR, 0, timeZone);
    if (slot <= now) return slot;
  }
  throw new Error("No weekday in the last 8 days.");
}

/** Whether the weekday sync is due: it has come, and nothing synced since. Missed days make one sync. */
export function scheduledSyncDue(now: Date, timeZone: string, syncedAt: string | null): boolean {
  return !syncedAt || Date.parse(syncedAt) < lastScheduledSync(now, timeZone).getTime();
}

/** Syncs when the weekday sync is due and Google Drive is allowed. */
export async function syncIfDue(now = new Date()): Promise<boolean> {
  if (!(await sheetReady())) return false;
  const settings = await loadSettings();
  if (!scheduledSyncDue(now, await lastKnownTimeZone(), settings.driveSheetSyncedAt)) return false;
  await syncSheet(now);
  return true;
}

const EVERY_MS = 15 * 60 * 1000;
const globalForSheet = globalThis as unknown as { sheetTimer?: ReturnType<typeof setInterval> };

/** Starts the weekly sync's timer, once per process, like the job agent's: only while Scout runs. */
export function startSheetSchedule(): void {
  if (globalForSheet.sheetTimer) return;
  const check = () => void syncIfDue().catch((error: unknown) => logServerError("google sheets sync", error));
  globalForSheet.sheetTimer = setInterval(check, EVERY_MS);
  globalForSheet.sheetTimer.unref?.();
  check();
}
