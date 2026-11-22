import "server-only";

import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";

// What an application's page shows, as one short fingerprint: the page
// checks it now and then and redraws when it's changed elsewhere (by the job
// agent, a background job, another tab, or a fix made in the database).

/** A fingerprint of everything the application's page draws from; null when it's gone. */
export async function applicationStamp(id: string): Promise<string | null> {
  const [application, documents, latestEvent, notes, settings] = await Promise.all([
    prisma.application.findUnique({ where: { id } }),
    prisma.document.findMany({ where: { applicationId: id }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } }),
    prisma.statusEvent.findFirst({ where: { applicationId: id }, orderBy: [{ at: "desc" }, { id: "desc" }], select: { id: true } }),
    prisma.note.count({ where: { applicationId: id } }),
    loadSettings(),
  ]);
  if (!application) return null;
  return createHash("sha1")
    .update(JSON.stringify({ application, documents, latestEvent, notes, profileChangedAt: settings.profileChangedAt }))
    .digest("hex")
    .slice(0, 16);
}
