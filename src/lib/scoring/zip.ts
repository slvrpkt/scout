import "server-only";

import type { Point } from "./preferences";

// ZIP codes to map points, from the US Census Bureau's ZIP code areas
// (public domain), kept in the app: your ZIP code is never sent anywhere.

let table: Record<string, [number, number]> | null = null;

async function points(): Promise<Record<string, [number, number]>> {
  table ??= (await import("./us-zip-points.json")).default as unknown as Record<string, [number, number]>;
  return table;
}

/** Whether the ZIP code table is there at all. */
export async function hasZipTable(): Promise<boolean> {
  return Object.keys(await points()).length > 0;
}

/** Where a 5-digit ZIP code is, or null when it isn't one we know. */
export async function zipPoint(zip: string): Promise<Point | null> {
  const found = (await points())[zip.trim()];
  return found ? { lat: found[0], lng: found[1] } : null;
}

/** What Settings → Scoring says under your ZIP code: why distance can't be measured, or nothing. */
export async function zipNoteOf(zip: string): Promise<string | null> {
  if (!zip) return "Add your ZIP code to score distance; until then every job's distance counts as unknown.";
  if (!(await hasZipTable())) return "Distance can't be measured yet: the ZIP code table isn't installed, so every job's distance counts as unknown.";
  return (await zipPoint(zip)) ? null : `${zip} isn't a ZIP code Scout knows; every job's distance counts as unknown.`;
}
