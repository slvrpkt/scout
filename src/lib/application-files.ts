import "server-only";

import { DocumentKind, FileFormat } from "@/generated/prisma/enums";
import { loadDocuments, loadSentDocument } from "@/lib/application-documents";
import { combinedDocx } from "@/lib/docx/application-docx";
import { DOCX_TYPE } from "@/lib/docx/render";
import { applicationFolderName, combinePdfs, postingDocx } from "@/lib/drive-backup";
import { resolveFileName } from "@/lib/file-name";
import { renderPdf } from "@/lib/pdf/render";
import { prisma } from "@/lib/prisma";

// The Job application log's two downloads: the resume and cover letter as
// one file (the cover letter first), in the format the application went out
// in, and the job description as a Word file, the same files the Google
// Drive backup saves. Nothing is written again by the AI.

export type ApplicationFile = { file: Uint8Array; fileName: string; contentType: string };

const PDF_TYPE = "application/pdf";

/** The resume and cover letter: as sent with the latest send, else the tailored ones as they are now; null without a resume. */
export async function documentsFile(applicationId: string): Promise<ApplicationFile | null> {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: {
      company: true,
      role: true,
      lastDownloadFormat: true,
      sentDocuments: { orderBy: { sentAt: "desc" }, select: { id: true, kind: true, format: true, sentAt: true } },
    },
  });
  if (!application) return null;
  const latest = application.sentDocuments[0]?.sentAt.getTime();
  const sent = application.sentDocuments.filter((copy) => copy.sentAt.getTime() === latest);
  const sentResume = sent.find((copy) => copy.kind === DocumentKind.RESUME);
  const sentLetter = sent.find((copy) => copy.kind === DocumentKind.COVER_LETTER);

  if (sentResume) {
    const format = sentResume.format;
    let file: Uint8Array;
    if (format === FileFormat.PDF) {
      const resume = await renderPdf(`/print/sent/${sentResume.id}`);
      file = sentLetter ? await combinePdfs([await renderPdf(`/print/sent/${sentLetter.id}`), resume]) : resume;
    } else {
      const resume = await loadSentDocument(sentResume.id);
      const letter = sentLetter ? await loadSentDocument(sentLetter.id) : null;
      if (!resume) return null;
      file = await combinedDocx(resume, resume.document, letter && { context: letter, document: letter.document });
    }
    return { file, ...named(await fileNameFor(applicationId, sentResume.sentAt, format), Boolean(sentLetter), format) };
  }

  // Not sent yet: the tailored documents, in the format last downloaded.
  const documents = await loadDocuments(applicationId);
  if (!documents.resume) return null;
  const format = application.lastDownloadFormat ?? FileFormat.PDF;
  let file: Uint8Array;
  if (format === FileFormat.PDF) {
    const resume = await renderPdf(`/print/resume/${applicationId}`);
    file = documents.letter ? await combinePdfs([await renderPdf(`/print/letter/${applicationId}`), resume]) : resume;
  } else {
    file = await combinedDocx(documents, documents.resume, documents.letter && { context: documents, document: documents.letter });
  }
  return { file, ...named(await fileNameFor(applicationId, new Date(), format), Boolean(documents.letter), format) };
}

async function fileNameFor(applicationId: string, date: Date, format: FileFormat): Promise<string> {
  const documents = await loadDocuments(applicationId);
  return resolveFileName(
    documents.settings.fileNamePattern,
    { name: documents.profile.basics.name, company: documents.application.company, role: documents.application.role, doc: DocumentKind.RESUME, date },
    format === FileFormat.DOCX ? "docx" : "pdf",
  );
}

/** "… – Resume with cover letter.pdf" when the letter is in it, as the Drive backup names it. */
const named = (fileName: string, withLetter: boolean, format: FileFormat) => ({
  fileName: withLetter ? fileName.replace(/\.(pdf|docx)$/i, " with cover letter.$1") : fileName,
  contentType: format === FileFormat.DOCX ? DOCX_TYPE : PDF_TYPE,
});

/** The job description as a Word file; null when the application is gone or no posting text was saved. */
export async function postingFile(applicationId: string): Promise<ApplicationFile | null> {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { company: true, role: true, title: true, location: true, salary: true, postingUrl: true, postingText: true, sentAt: true, posting: { select: { description: true } } },
  });
  const text = application?.postingText || application?.posting?.description || "";
  if (!application || !text.trim()) return null;
  const file = await postingDocx({
    company: application.company,
    role: application.role || application.title,
    location: application.location,
    salary: application.salary,
    url: application.postingUrl,
    text,
    sentAt: application.sentAt,
  });
  return { file, fileName: `${applicationFolderName(application)} – Job description.docx`, contentType: DOCX_TYPE };
}
