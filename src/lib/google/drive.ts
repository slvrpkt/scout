import "server-only";

import { randomBytes } from "node:crypto";

import { googleFetch } from "./account";
import { googleUrl } from "./endpoints";
import { isGone } from "./errors";

// The parts of the Drive API Scout uses (Google Drive backup): folders and
// uploads. With the drive.file permission it only ever sees what it made
// itself, so it can't read or change anything else in the Drive.

const FOLDER_TYPE = "application/vnd.google-apps.folder";

const files = (path = "") => googleUrl("www", `/drive/v3/files${path}`);

/** A folder's address in Drive, to open it. */
export const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;

/** Makes a folder, in `parent` if given; returns its id. */
export async function createFolder(name: string, parent?: string, signal?: AbortSignal): Promise<string> {
  const answer = await googleFetch<{ id: string }>("drive", `${files()}?fields=id`, {
    method: "POST",
    body: { name, mimeType: FOLDER_TYPE, ...(parent ? { parents: [parent] } : {}) },
    signal,
  });
  return answer.id;
}

/** Whether a folder or file Scout made is still there and not in the trash. */
export async function stillThere(id: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const answer = await googleFetch<{ trashed?: boolean }>("drive", `${files(`/${encodeURIComponent(id)}`)}?fields=id,trashed`, { signal });
    return !answer.trashed;
  } catch (error) {
    if (isGone(error)) return false;
    throw error;
  }
}

/** A Google Sheet, which a CSV upload is turned into. */
export const SHEET_TYPE = "application/vnd.google-apps.spreadsheet";

/** A file's address in Google Sheets, to open it. */
export const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;

/** Uploads a file into `parent`, as it is or, with `as`, turned into a Google file of that type; returns its id. */
export async function uploadFile(
  { name, contentType, data, parent, as }: { name: string; contentType: string; data: Uint8Array; parent: string; as?: string },
  signal?: AbortSignal,
): Promise<string> {
  // A multipart upload: the file's details as JSON, then the file itself.
  const boundary = `dossier-${randomBytes(12).toString("hex")}`;
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent], ...(as ? { mimeType: as } : {}) })}\r\n` +
      `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + data.length + tail.length);
  body.set(head, 0);
  body.set(data, head.length);
  body.set(tail, head.length + data.length);
  const answer = await googleFetch<{ id: string }>("drive", `${googleUrl("www", "/upload/drive/v3/files")}?uploadType=multipart&fields=id`, {
    method: "POST",
    upload: { contentType: `multipart/related; boundary=${boundary}`, data: body },
    signal,
  });
  return answer.id;
}

/** Replaces a file's contents, keeping the file and its link; a CSV replaces a Google Sheet's cells. */
export async function replaceFile(id: string, { contentType, data }: { contentType: string; data: Uint8Array }, signal?: AbortSignal): Promise<void> {
  await googleFetch("drive", `${googleUrl("www", `/upload/drive/v3/files/${encodeURIComponent(id)}`)}?uploadType=media&fields=id`, {
    method: "PATCH",
    upload: { contentType, data },
    signal,
  });
}

/** Moves a file Scout made to the Drive's trash, where it stays for 30 days; one already gone is fine. */
export async function trashFile(id: string, signal?: AbortSignal): Promise<void> {
  try {
    await googleFetch("drive", `${files(`/${encodeURIComponent(id)}`)}?fields=id`, { method: "PATCH", body: { trashed: true }, signal });
  } catch (error) {
    if (!isGone(error)) throw error;
  }
}
