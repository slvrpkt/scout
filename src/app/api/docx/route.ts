import { type NextRequest, NextResponse } from "next/server";

import { DocumentKind, FileFormat } from "@/generated/prisma/enums";
import { loadDocuments, loadSentDocument } from "@/lib/application-documents";
import { BASE_LENGTH_PAGES } from "@/lib/base-resume";
import { baseLengthOf, baseResumeDocx, fittedBaseResume } from "@/lib/base-resume-fit";
import { documentDocx } from "@/lib/docx/application-docx";
import { countDocxPages, docxPagesNote } from "@/lib/docx/pages";
import { DOCX_TYPE } from "@/lib/docx/render";
import { resolveFileName } from "@/lib/file-name";
import { fileDownload, holdFile } from "@/lib/pdf/downloads";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { rememberDownloadFormat } from "@/lib/sent-documents";
import { maxPages } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";
import { route } from "@/lib/route";

/** Application and copy ids are cuids. */
const APPLICATION_ID = /^[a-z0-9]{1,64}$/i;

const notFound = (error: string) => NextResponse.json({ error }, { status: 404 });

/**
 * Downloads a document as a Word file (.docx), with the same queries as
 * /api/pdf: `?doc=base`, `?doc=resume&application={id}` or
 * `?doc=letter&application={id}`, or `?doc=sent&sent={id}` for one as it was
 * sent, named with Settings → Download file name.
 */
export const GET = route(async (request) => {
  const built = await buildRequested(request);
  return built instanceof Response ? built : fileDownload(built.file, built.fileName, DOCX_TYPE);
});

/** Builds the same file and holds it for a few minutes, answering `{ url }` (see POST /api/pdf). */
export const POST = route(async (request) => {
  const built = await buildRequested(request);
  if (built instanceof Response) return built;
  return NextResponse.json({ url: `/api/docx/${holdFile(built.file, built.fileName, DOCX_TYPE)}`, note: built.note ?? null });
});

/**
 * The Word file and file name of the document the query asks for, or a 404
 * response. A resume with a page limit is counted in Word before it's handed
 * over, and shortened further while Word puts it over; `note` says when it
 * couldn't be checked or brought within the limit.
 */
async function buildRequested(request: NextRequest): Promise<{ file: Uint8Array; fileName: string; note?: string | null } | Response> {
  const params = request.nextUrl.searchParams;
  const doc = params.get("doc");
  const date = new Date();

  if (doc === "base") {
    // One fit for both: measured in the PDF and in Word, so the Word file holds exactly the PDF's words, within the limit.
    const length = await baseLengthOf(params.get("length"));
    await fittedBaseResume(length);
    const [profile, settings] = await Promise.all([loadProfile(), loadSettings()]);
    const fit = settings.baseFit[length];
    const file = await baseResumeDocx(length, fit?.taken ?? 0, Boolean(fit?.noSkills), fit?.hide ?? []);
    const limit = BASE_LENGTH_PAGES[length];
    const note = limit === null ? null : docxPagesNote(await countDocxPages(file), limit, fit?.fits !== false);
    return { file, note, fileName: resolveFileName(settings.fileNamePattern, { name: profile.basics.name, doc: DocumentKind.RESUME, date }, "docx") };
  }

  if (doc !== "resume" && doc !== "letter" && doc !== "sent") return notFound("There's no such document to download.");
  const sentId = params.get("sent") ?? "";
  const id = params.get("application") ?? "";
  let loaded;
  if (doc === "sent") {
    const sent = APPLICATION_ID.test(sentId) && (await prisma.sentDocument.count({ where: { id: sentId } })) > 0 ? await loadSentDocument(sentId) : null;
    if (!sent) return notFound("That copy of what was sent no longer exists.");
    loaded = { ...sent, isResume: sent.sent.kind === DocumentKind.RESUME, date: sent.sent.sentAt };
  } else {
    // Checked first, so a missing application is a 404 rather than the not-found page.
    const exists = APPLICATION_ID.test(id) && (await prisma.application.count({ where: { id } })) > 0;
    if (!exists) return notFound("That application no longer exists.");
    const documents = await loadDocuments(id);
    const document = doc === "resume" ? documents.resume : documents.letter;
    if (!document) return notFound(doc === "resume" ? "This application has no tailored resume." : "This application has no cover letter.");
    loaded = { ...documents, document, isResume: doc === "resume", date };
    await rememberDownloadFormat(id, FileFormat.DOCX);
    if (doc === "resume") return checkedResumeDocx(id, loaded);
  }
  return documentDocx(loaded);
}

/**
 * A tailored resume as a Word file, counted in Word against its page limit.
 * Over it, the resume is fitted again with Word's count in place of the
 * PDF's (the same trims, in the same order), and the shorter resume is saved
 * as a version like any other fit.
 */
async function checkedResumeDocx(id: string, loaded: Parameters<typeof documentDocx>[0]) {
  const application = await prisma.application.findUnique({ where: { id }, select: { resumePageLimit: true } });
  const limit = application?.resumePageLimit ?? maxPages(loaded.settings.pageLimit);
  const built = await documentDocx(loaded);
  if (!limit) return built;
  const counted = await countDocxPages(built.file);
  if (counted === null || counted <= limit) return { ...built, note: docxPagesNote(counted, limit, true) };
  const wordPages = async () => {
    const now = await loadDocuments(id);
    return now.resume ? ((await countDocxPages((await documentDocx({ ...loaded, ...now, document: now.resume })).file)) ?? Infinity) : Infinity;
  };
  const { fitResumeToPages } = await import("@/lib/page-limit");
  const { fits } = await fitResumeToPages(id, loaded.profile, limit, wordPages, undefined, "deny");
  const now = await loadDocuments(id);
  const rebuilt = now.resume ? await documentDocx({ ...loaded, ...now, document: now.resume }) : built;
  return { ...rebuilt, note: fits ? null : docxPagesNote(await countDocxPages(rebuilt.file), limit, false) };
}
