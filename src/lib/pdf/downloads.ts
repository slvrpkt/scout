import "server-only";

import { randomUUID } from "node:crypto";

import { contentDisposition } from "@/lib/file-name";

// Rendered PDFs (and Word files) waiting to be downloaded. The download button has the server
// render first, so it can say it's busy and show errors, then lets the
// browser fetch the file from its own link: a file made inside the page
// saved empty in Chrome and Edge on Windows when they asked where to save.
// Held a few minutes rather than once, in case a browser asks twice.

/** How long a rendered file waits for its download. */
export const HOLD_MS = 5 * 60_000;
/** The most files held at once; the oldest goes first. */
const MAX_HELD = 20;

/** What's held: the file, its name and its media type. */
type Held = { file: Uint8Array; fileName: string; type: string; expires: number };

export const PDF_TYPE = "application/pdf";

// Kept on globalThis so the dev server's hot reloads don't drop them.
const globalForHeld = globalThis as unknown as { heldFiles?: Map<string, Held> };
const held: Map<string, Held> = (globalForHeld.heldFiles ??= new Map());

function dropExpired(now: number): void {
  for (const [id, file] of held) if (file.expires <= now) held.delete(id);
}

/** Keeps a rendered file (a PDF, a Word file) for its download; returns the id to fetch it by. */
export function holdFile(file: Uint8Array, fileName: string, type: string, now = Date.now()): string {
  dropExpired(now);
  while (held.size >= MAX_HELD) held.delete(held.keys().next().value!);
  const id = randomUUID();
  held.set(id, { file, fileName, type, expires: now + HOLD_MS });
  return id;
}

/** Keeps a rendered PDF for its download; returns the id to fetch it by. */
export function holdPdf(pdf: Uint8Array, fileName: string, now = Date.now()): string {
  return holdFile(pdf, fileName, PDF_TYPE, now);
}

/** A held file of `type`, or null once it has expired. */
export function heldFile(id: string, type: string, now = Date.now()): { file: Uint8Array; fileName: string } | null {
  dropExpired(now);
  const file = held.get(id);
  return file && file.type === type ? { file: file.file, fileName: file.fileName } : null;
}

/** A held PDF, or null once it has expired. */
export function heldPdf(id: string, now = Date.now()): { pdf: Uint8Array; fileName: string } | null {
  const file = heldFile(id, PDF_TYPE, now);
  return file && { pdf: file.file, fileName: file.fileName };
}

/** A file as a download named `fileName`. */
export function fileDownload(file: Uint8Array, fileName: string, type: string): Response {
  return new Response(Buffer.from(file), {
    headers: {
      "content-type": type,
      "content-disposition": contentDisposition(fileName),
    },
  });
}

/** A PDF as a download named `fileName`. */
export function pdfDownload(pdf: Uint8Array, fileName: string): Response {
  return fileDownload(pdf, fileName, PDF_TYPE);
}
