import "server-only";

import type { Prisma, PrismaClient, StatusEvent } from "@/generated/prisma/client";
import type { ApplicationStatus, FileFormat } from "@/generated/prisma/enums";

import { saveSentCopies } from "./sent-documents";
import { advance, undoChange } from "./status";

// Database side of the status model: every status change is written here, in
// a transaction, together with its StatusEvent.

export type StatusChangeResult =
  | { outcome: "changed"; event: StatusEvent }
  | { outcome: "unchanged" }
  | { outcome: "not-found" };

/**
 * Moves an application to `to` and records the change. A first send keeps
 * what was sent, in `sentFormat` when the sender knows it, and saves it to
 * Google Drive when that's on.
 */
export async function applyStatusChange(
  db: PrismaClient,
  applicationId: string,
  to: ApplicationStatus,
  now = new Date(),
  { sentFormat }: { sentFormat?: FileFormat } = {},
): Promise<StatusChangeResult> {
  let copies = 0;
  const result = await db.$transaction(async (tx): Promise<StatusChangeResult> => {
    // Lock the row so two changes to the same application can't interleave.
    await tx.$queryRaw`SELECT 1 FROM "Application" WHERE id = ${applicationId} FOR UPDATE`;
    const application = await tx.application.findUnique({
      where: { id: applicationId },
      select: { status: true, furthestStage: true, sentAt: true },
    });
    if (!application) return { outcome: "not-found" };

    const change = advance(application, to, now);
    if (!change) return { outcome: "unchanged" };

    await tx.application.update({ where: { id: applicationId }, data: change.update });
    const event = await tx.statusEvent.create({ data: { applicationId, ...change.event } });
    // The first time it counts as sent, what was sent is kept (application history).
    if (!application.sentAt && change.update.sentAt) copies = await saveSentCopies(tx, applicationId, change.update.sentAt, event.id, sentFormat);
    // Applied: it's in the Job application log now, so it comes off Saved for later.
    if (change.update.sentAt) await unsaveApplied(tx, applicationId);
    return { outcome: "changed", event };
  });
  // Loaded on use: the backup brings in the job runner and Google.
  if (copies > 0) await (await import("./drive-backup")).queueDriveBackup(applicationId);
  return result;
}

export type UndoResult =
  | { outcome: "undone"; status: ApplicationStatus }
  | { outcome: "superseded" }
  | { outcome: "not-found" };

/**
 * Undoes a status change: restores the status, furthest stage and sent date
 * from before it and deletes its event, with the copies it saved as sent. Only the application's latest change
 * can be undone; after a newer one, the result is "superseded".
 */
export async function undoStatusChange(db: PrismaClient, eventId: string): Promise<UndoResult> {
  return db.$transaction(async (tx) => {
    const event = await tx.statusEvent.findUnique({ where: { id: eventId } });
    if (!event) return { outcome: "not-found" };

    await tx.$queryRaw`SELECT 1 FROM "Application" WHERE id = ${event.applicationId} FOR UPDATE`;
    const latest = await tx.statusEvent.findFirst({
      where: { applicationId: event.applicationId },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (latest?.id !== event.id) return { outcome: "superseded" };

    const restored = undoChange(event);
    await tx.application.update({ where: { id: event.applicationId }, data: restored });
    await tx.statusEvent.delete({ where: { id: event.id } });
    return { outcome: "undone", status: restored.status };
  });
}

/** Takes the job an application was made from off Saved for later: the posting it started from, or the agent's job it drafted. */
async function unsaveApplied(tx: Prisma.TransactionClient, applicationId: string): Promise<void> {
  await tx.posting.updateMany({ where: { applicationId, savedAt: { not: null } }, data: { savedAt: null } });
  const candidate = await tx.agentCandidate.findUnique({ where: { applicationId }, select: { source: true, externalId: true } });
  if (candidate) await tx.posting.updateMany({ where: { source: candidate.source, externalId: candidate.externalId, savedAt: { not: null } }, data: { savedAt: null } });
}
