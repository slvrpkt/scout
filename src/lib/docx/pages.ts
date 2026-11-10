import "server-only";

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// A Word file's pages, as Microsoft Word itself lays them out: the file is
// opened, read-only and out of sight, in the Word installed on this computer,
// and Word's own page count is read. Fonts and spacing differ between the
// PDF and Word, so a Word download is checked on its own before it's handed
// over. Where Word isn't installed (or in tests), the count is null and the
// download says it couldn't be checked.

/** How long Word gets to open a file and count its pages. */
const WORD_TIMEOUT_MS = 90_000;

const SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$word = New-Object -ComObject Word.Application",
  "try {",
  "  $word.Visible = $false",
  "  $word.DisplayAlerts = 0",
  "  $doc = $word.Documents.Open($env:SCOUT_DOCX, $false, $true, $false)",
  "  $doc.Repaginate()",
  "  $pages = $doc.ComputeStatistics(2)",
  "  $doc.Close(0)",
  "  Write-Output \"pages=$pages\"",
  "} finally { $word.Quit() }",
].join("\n");

/** The pages Microsoft Word gives this .docx, or null when Word isn't here or couldn't count them. */
export async function countDocxPages(file: Uint8Array): Promise<number | null> {
  if (process.platform !== "win32" || process.env.VITEST || process.env.DOCX_PAGE_CHECK === "off") return null;
  const folder = await mkdtemp(path.join(tmpdir(), "scout-docx-"));
  const target = path.join(folder, "document.docx");
  try {
    await writeFile(target, file);
    const output = await new Promise<string>((resolve, reject) =>
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT],
        { env: { ...process.env, SCOUT_DOCX: target }, timeout: WORD_TIMEOUT_MS, windowsHide: true },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      ),
    );
    const pages = Number(/pages=(\d+)/.exec(output)?.[1]);
    return Number.isInteger(pages) && pages > 0 ? pages : null;
  } catch {
    return null;
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => {});
  }
}

/** What to tell you about a Word file's pages, or null when it's within `limit`. */
export function docxPagesNote(counted: number | null, limit: number, fits: boolean): string | null {
  const within = limit === 1 ? "one page" : `${limit} pages`;
  if (counted === null) return `Word's page count couldn't be checked on this computer, so open the file to make sure it's within ${within}.`;
  if (!fits) return `Even shortened as far as it goes, the Word file is ${counted} pages in Word, over ${within}. Shorten it by hand, or allow more pages.`;
  return null;
}
