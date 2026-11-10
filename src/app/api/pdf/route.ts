import { type NextRequest, NextResponse } from "next/server";

import { DocumentKind, FileFormat } from "@/generated/prisma/enums";
import { BASE_LENGTH_PAGES } from "@/lib/base-resume";
import { baseLengthOf, fittedBaseResume } from "@/lib/base-resume-fit";
import { resolveFileName } from "@/lib/file-name";
import { holdPdf, pdfDownload } from "@/lib/pdf/downloads";
import { countPdfPages } from "@/lib/pdf/pages";
import { renderPdf } from "@/lib/pdf/render";
import { prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";
import { rememberDownloadFormat } from "@/lib/sent-documents";
import { maxPages, pagesInWords } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";
import { route } from "@/lib/route";

/** The documents an application can download, by their `doc=` value. */
const TAILORED = { resume: DocumentKind.RESUME, letter: DocumentKind.COVER_LETTER } as const;

/** Application ids are cuids; anything else never reaches a print path. */
const APPLICATION_ID = /^[a-z0-9]{1,64}$/i;

const notFound = (error: string) => NextResponse.json({ error }, { status: 404 });

/**
 * Downloads a document as a PDF (RES-5, APP-12): `?doc=base` for the base
 * resume, `?doc=resume&application={id}` or `?doc=letter&application={id}`
 * for an application's tailored resume or cover letter, `?doc=sent&sent={id}`
 * for one as it was sent (application history). The file is named
 * with Settings → Download file name (SET-8).
 */
export const GET = route(async (request) => {
  const rendered = await renderRequested(request);
  return rendered instanceof Response ? rendered : pdfDownload(rendered.pdf, rendered.fileName);
});

/**
 * Renders the same documents and holds the PDF for a few minutes, answering
 * with the link to download it from: `{ url }`. The download button uses
 * this, so the browser saves the file from a link of its own.
 */
export const POST = route(async (request) => {
  const rendered = await renderRequested(request);
  if (rendered instanceof Response) return rendered;
  return NextResponse.json({ url: `/api/pdf/${holdPdf(rendered.pdf, rendered.fileName)}`, note: rendered.note ?? null });
});

/** The PDF and file name of the document the query asks for, or a 404 response; `note` when a resume runs over its page limit. */
async function renderRequested(request: NextRequest): Promise<{ pdf: Uint8Array; fileName: string; note?: string | null } | Response> {
  const params = request.nextUrl.searchParams;
  const doc = params.get("doc");
  const [name, settings] = await Promise.all([loadProfileName(), loadSettings()]);
  const date = new Date();

  if (doc === "base") {
    // Full, two pages or three: the one asked for, else the one chosen on the Base resume page.
    const length = await baseLengthOf(params.get("length"));
    const pdf = await fittedBaseResume(length);
    return {
      pdf,
      note: BASE_LENGTH_PAGES[length] === null ? null : overLimitNote(countPdfPages(pdf), BASE_LENGTH_PAGES[length]),
      fileName: resolveFileName(settings.fileNamePattern, { name, doc: DocumentKind.RESUME, date }),
    };
  }

  if (doc === "sent") {
    const sentId = params.get("sent") ?? "";
    const sent = APPLICATION_ID.test(sentId)
      ? await prisma.sentDocument.findUnique({ where: { id: sentId }, select: { kind: true, sentAt: true, application: { select: { company: true, role: true } } } })
      : null;
    if (!sent) return notFound("That copy of what was sent no longer exists.");
    return {
      pdf: await renderPdf(`/print/sent/${sentId}`),
      // Dated the day it was sent.
      fileName: resolveFileName(settings.fileNamePattern, { name, company: sent.application.company, role: sent.application.role, doc: sent.kind, date: sent.sentAt }),
    };
  }

  if (doc !== "resume" && doc !== "letter") return notFound("There's no such document to download.");
  const id = params.get("application") ?? "";
  const application = APPLICATION_ID.test(id)
    ? await prisma.application.findUnique({
        where: { id },
        select: { company: true, role: true, documents: { where: { kind: TAILORED[doc] }, select: { id: true } } },
      })
    : null;
  if (!application) return notFound("That application no longer exists.");
  if (application.documents.length === 0) {
    return notFound(doc === "resume" ? "This application has no tailored resume." : "This application has no cover letter.");
  }

  const pdf = await renderPdf(`/print/${doc}/${id}`);
  await rememberDownloadFormat(id, FileFormat.PDF);
  const limit = doc === "resume" ? ((await prisma.application.findUnique({ where: { id }, select: { resumePageLimit: true } }))?.resumePageLimit ?? maxPages(settings.pageLimit)) : null;
  return {
    pdf,
    note: limit === null ? null : overLimitNote(countPdfPages(pdf), limit),
    fileName: resolveFileName(settings.fileNamePattern, { name, company: application.company, role: application.role, doc: TAILORED[doc], date }),
  };
}

/** What to say when a resume's PDF, counted page by page, runs over its limit; null when it's within it. */
function overLimitNote(pages: number, limit: number | null): string | null {
  if (limit === null || pages <= limit) return null;
  if (pages === Number.MAX_SAFE_INTEGER) return "The PDF's pages couldn't be counted, so open it to check its length.";
  return `This PDF is ${pages} pages, over ${pagesInWords(limit)}: it couldn't be shortened enough to fit. Shorten it by hand, or allow more pages.`;
}
