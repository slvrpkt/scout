import "server-only";

import { loadApplicationRows, type ApplicationRow } from "@/lib/applications-data";
import { DEFAULT_SORT } from "@/lib/applications-list";
import { sheetXlsx, XLSX_TYPE } from "@/lib/applications-sheet-columns";
import { rootFolder } from "@/lib/drive-backup";
import { loadGoogleAccount } from "@/lib/google/account";
import { replaceFile, SHEET_TYPE, sheetUrl, stillThere, uploadFile } from "@/lib/google/drive";
import { GoogleError } from "@/lib/google/errors";
import { hasScopes } from "@/lib/google/oauth";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { sampleApplicationIds } from "@/lib/sample-data";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// The Job application log as a Google Sheet, in the Drive folder what's sent
// is saved in: Sync To Google Sheets on the log, and on its own a few
// seconds after an application is marked Applied or moves on (queueSheetSync).
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
    const data = sheetXlsx(await sheetRows(now));
    const folderId = await rootFolder(settings.driveFolderName);
    let id = settings.driveSheet?.folderId === folderId ? settings.driveSheet.id : null;
    if (id && !(await stillThere(id))) id = null;
    if (id) {
      await replaceFile(id, { contentType: XLSX_TYPE, data });
    } else {
      id = await uploadFile({ name: SHEET_NAME, contentType: XLSX_TYPE, data, parent: folderId, as: SHEET_TYPE });
    }
    await saveSettings({ driveSheet: { folderId, id }, driveSheetSyncedAt: now.toISOString(), driveSheetProblem: null });
    return sheetUrl(id);
  } catch (error) {
    const problem = error instanceof GoogleError ? error.message : "Syncing to Google Sheets didn't work. Try again.";
    await saveSettings({ driveSheetProblem: problem });
    throw error;
  }
}

/** How long a change waits for others that come with it (a status change, then its Drive copy), so they make one sync. */
const SETTLE_MS = 5_000;
const globalForSheet = globalThis as unknown as { sheetTimer?: ReturnType<typeof setTimeout> };

/**
 * Brings the sheet up to date in the background, a few seconds after an
 * application changes: marked Applied (once its Drive copy is in, so the
 * sheet links to it), moved to another status, or a change undone. Nothing
 * happens while Google Drive isn't allowed; a problem shows on the log.
 */
export function queueSheetSync(): void {
  if (globalForSheet.sheetTimer) clearTimeout(globalForSheet.sheetTimer);
  globalForSheet.sheetTimer = setTimeout(() => {
    globalForSheet.sheetTimer = undefined;
    void (async () => {
      if (await sheetReady()) await syncSheet();
    })().catch((error: unknown) => logServerError("google sheets sync", error));
  }, SETTLE_MS);
  globalForSheet.sheetTimer.unref?.();
}
