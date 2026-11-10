import "server-only";

import { DocumentKind } from "@/generated/prisma/enums";
import { loadSentDocument, type DocumentData, type loadDocuments } from "@/lib/application-documents";
import { resolveFileName } from "@/lib/file-name";

import { letterAndResumeDocx, letterDocx, resumeDocx, type LetterDocxProps, type ResumeDocxProps } from "./render";

type Context = Pick<Awaited<ReturnType<typeof loadDocuments>>, "application" | "profile" | "settings" | "includeReferences" | "letterDate">;

type Loaded = Context & {
  document: DocumentData;
  isResume: boolean;
  /** The day in the file name. */
  date: Date;
};

/** What the resume renderer needs for an application's resume. */
export const resumeProps = ({ application, profile, settings, includeReferences }: Context, document: DocumentData): ResumeDocxProps => ({
  theme: document.theme,
  profile,
  paper: settings.paper,
  units: document.units,
  language: application.language,
  includeReferences,
  template: settings.resumeTemplate,
});

/** What the letter renderer needs for an application's cover letter. */
export const letterProps = ({ application, profile, settings, letterDate }: Context, document: DocumentData): LetterDocxProps => ({
  theme: document.theme,
  paper: settings.paper,
  basics: profile.basics,
  units: document.units,
  company: application.company,
  location: application.location,
  tone: application.tone,
  date: letterDate,
  dateFormat: settings.dateFormat,
  language: application.language,
});

/** An application's resume or cover letter as a Word file, named with Settings → Download file name. */
export async function documentDocx(loaded: Loaded) {
  const { application, profile, settings, document, isResume, date } = loaded;
  const file = isResume ? await resumeDocx(resumeProps(loaded, document)) : await letterDocx(letterProps(loaded, document));
  return {
    file,
    fileName: resolveFileName(
      settings.fileNamePattern,
      { name: profile.basics.name, company: application.company, role: application.role, doc: isResume ? DocumentKind.RESUME : DocumentKind.COVER_LETTER, date },
      "docx",
    ),
  };
}

/** A resume or cover letter as it was sent, as a Word file dated the day it went out; null when the copy is gone. */
export async function sentDocx(sentId: string) {
  const sent = await loadSentDocument(sentId);
  if (!sent) return null;
  return documentDocx({ ...sent, isResume: sent.sent.kind === DocumentKind.RESUME, date: sent.sent.sentAt });
}

/** The cover letter, then the resume, as one Word file; just the resume without a letter. */
export async function combinedDocx(context: Context, resume: DocumentData, letter: { context: Context; document: DocumentData } | null): Promise<Uint8Array> {
  if (!letter) return resumeDocx(resumeProps(context, resume));
  return letterAndResumeDocx(letterProps(letter.context, letter.document), resumeProps(context, resume));
}
