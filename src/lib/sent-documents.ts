import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { DocumentKind, FileFormat } from "@/generated/prisma/enums";
import { loadDocuments, type SentSnapshot } from "@/lib/application-documents";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import { LETTER_POINTS, RESUME_POINTS } from "@/lib/themes";

// What was sent (application history): when an application is sent, its
// tailored resume and cover letter are frozen as SentDocuments, so the
// history can show and download exactly what the employer got, however the
// documents change later. A send through any path (the status menu, the
// board, Gmail, the connector) goes through applyStatusChange, which saves
// them with its status change; undoing that change removes them again. A
// later send (to a recruiter, a second portal) is recorded by hand.

/** The documents an employer gets; the email is in the Gmail history instead. */
export const SENT_KINDS: readonly DocumentKind[] = [DocumentKind.RESUME, DocumentKind.COVER_LETTER];

/**
 * Freezes the application's resume and cover letter as sent at `sentAt`;
 * returns how many there were. Each is kept in the format it went out in:
 * `format` when the sender knows it (Gmail attaches PDFs), else the one last
 * downloaded, since that's what was uploaded to the employer's site; a PDF
 * when nothing was downloaded.
 */
export async function saveSentCopies(
  tx: Prisma.TransactionClient,
  applicationId: string,
  sentAt: Date,
  eventId: string | null = null,
  format?: FileFormat,
): Promise<number> {
  const documents = await tx.document.findMany({
    where: { applicationId, kind: { in: [...SENT_KINDS] } },
    select: { kind: true, units: true, themeId: true },
  });
  if (documents.length === 0) return 0;
  const application = await tx.application.findUnique({ where: { id: applicationId }, select: { lastDownloadFormat: true } });
  const sentAs = format ?? application?.lastDownloadFormat ?? FileFormat.PDF;
  // The layout it went out in, so the copy stays what the employer got when the template changes.
  const { resumeTemplate } = await loadSettings();
  // And all else it depends on, so nothing that changes later can reach it.
  const loaded = await loadDocuments(applicationId);
  const snapshotOf = (kind: DocumentKind): SentSnapshot | null => {
    const theme = (kind === DocumentKind.RESUME ? loaded.resume : loaded.letter)?.theme;
    if (!theme) return null;
    const { profile, includeReferences, settings, application: sentApplication } = loaded;
    const { followThemeLayout, company, location, language, tone } = sentApplication;
    return { theme, profile, paper: settings.paper, dateFormat: settings.dateFormat, includeReferences, followThemeLayout, company, location, language, tone };
  };
  await tx.sentDocument.createMany({
    data: documents.map((document) => ({
      applicationId,
      eventId,
      kind: document.kind,
      units: document.units as Prisma.InputJsonValue,
      themeId: document.themeId,
      sentAt,
      format: sentAs,
      textSize: document.kind === DocumentKind.RESUME ? RESUME_POINTS : LETTER_POINTS,
      ...(resumeTemplate && document.kind === DocumentKind.RESUME ? { template: resumeTemplate } : {}),
      ...(snapshotOf(document.kind) ? { snapshot: snapshotOf(document.kind) as unknown as Prisma.InputJsonValue } : {}),
    })),
  });
  return documents.length;
}

/** Notes the format an application's resume or cover letter was downloaded in: a send on an employer's site most likely used it. */
export async function rememberDownloadFormat(applicationId: string, format: FileFormat): Promise<void> {
  await prisma.application.updateMany({ where: { id: applicationId }, data: { lastDownloadFormat: format } });
}
