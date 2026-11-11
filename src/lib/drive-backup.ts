import "server-only";

import { Document, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";

import { DocumentKind, FileFormat, NoteKind } from "@/generated/prisma/enums";
import { sentDocx } from "@/lib/docx/application-docx";
import { DOCX_TYPE } from "@/lib/docx/render";
import { resolveFileName } from "@/lib/file-name";
import { loadGoogleAccount } from "@/lib/google/account";
import { createFolder, folderUrl, stillThere, uploadFile } from "@/lib/google/drive";
import { GoogleError } from "@/lib/google/errors";
import { hasScopes } from "@/lib/google/oauth";
import { defineJob, startJob } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { renderPdf } from "@/lib/pdf/render";
import { prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";
import { sampleApplicationIds } from "@/lib/sample-data";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// Google Drive backup: every application that's sent gets a folder in the
// Drive folder named in Settings → Google ("Job search 2026-27"), named
// "Company – Role", holding the posting as a Word file and the resume and
// cover letter exactly as they went out: the frozen copies, as PDF or Word.
// Nothing is written again by the AI; the files are built from the copies the
// way Download builds them. Drive files are never deleted from here.

const PDF_TYPE = "application/pdf";

/** A name Drive and a downloaded copy both take: no slashes or other characters file systems refuse. */
export function safeName(text: string): string {
  return text
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 150);
}

/** An application's folder: "Company – Role", so two roles at one company get a folder each. */
export function applicationFolderName({ company, role, title }: { company: string; role: string; title: string }): string {
  const parts = [safeName(company), safeName(role || title)].filter(Boolean);
  return parts.join(" – ") || "Application";
}

/** The posting as a Word file: what it is and where it was, then its text exactly as saved. */
export async function postingDocx(posting: {
  company: string;
  role: string;
  location: string;
  salary: string;
  url: string;
  text: string;
  sentAt: Date | null;
}): Promise<Uint8Array> {
  const line = (label: string, value: string) =>
    value.trim() ? [new Paragraph({ children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(value.trim())] })] : [];
  const paragraphs = posting.text.replace(/\r\n?/g, "\n").split("\n");
  const document = new Document({
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [
      {
        children: [
          new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: [posting.company, posting.role].filter(Boolean).join(" – ") || "Job posting", bold: true, size: 32 })] }),
          ...line("Link", posting.url),
          ...line("Location", posting.location),
          ...line("Salary", posting.salary),
          ...line("Applied", posting.sentAt ? posting.sentAt.toISOString().slice(0, 10) : ""),
          new Paragraph({ spacing: { before: 240, after: 120 }, children: [new TextRun({ text: "Job description", bold: true, size: 26 })] }),
          ...(posting.text.trim() ? paragraphs.map((text) => new Paragraph({ children: [new TextRun(text)] })) : [new Paragraph({ children: [new TextRun({ text: "No posting text was saved.", italics: true })] })]),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

/** One PDF of `files` in order: the cover letter, then the resume. */
export async function combinePdfs(files: Uint8Array[]): Promise<Uint8Array> {
  const combined = await PDFDocument.create();
  for (const file of files) {
    const source = await PDFDocument.load(file);
    for (const page of await combined.copyPages(source, source.getPageIndices())) combined.addPage(page);
  }
  return combined.save();
}

/** The key of an application's Drive backup job, so its page can tell one is running. */
export const driveBackupKey = (applicationId: string) => `drive-backup:${applicationId}`;

/** Whether what's sent is saved to Drive: switched on, and Google's Drive permission given. */
export async function backupReady(): Promise<boolean> {
  const settings = await loadSettings();
  if (!settings.driveBackup) return false;
  const account = await loadGoogleAccount();
  return account !== null && hasScopes(account.scopes, "drive");
}

/**
 * Starts saving an application's sent copies to Drive, when the backup is on.
 * Never throws: a send must not fail because Drive did.
 */
export async function queueDriveBackup(applicationId: string): Promise<void> {
  try {
    if (!(await backupReady())) return;
    // Sample data stays out of the Drive.
    if ((await sampleApplicationIds(prisma)).has(applicationId)) return;
    // Only what you applied for goes there: nothing archived, and no agent draft still waiting for review.
    const application = await prisma.application.findUnique({ where: { id: applicationId }, select: { archivedAt: true, awaitingReview: true } });
    if (!application || application.archivedAt || application.awaitingReview) return;
    await startJob(driveBackupJob, { applicationId }, { key: driveBackupKey(applicationId), applicationId });
  } catch (error) {
    logServerError("drive backup not started", error);
  }
}

// One lookup of the main folder at a time, so two backups at once can't each make one.
let rootLookup: Promise<unknown> = Promise.resolve();

/** The main folder, made again when it's renamed in Settings or gone from the Drive. */
export function rootFolder(name: string, signal?: AbortSignal): Promise<string> {
  const lookup = rootLookup.then(() => findOrMakeRoot(name, signal));
  rootLookup = lookup.catch(() => {});
  return lookup;
}

async function findOrMakeRoot(name: string, signal?: AbortSignal): Promise<string> {
  const { driveRootFolder } = await loadSettings();
  if (driveRootFolder && driveRootFolder.name === name && (await stillThere(driveRootFolder.id, signal))) return driveRootFolder.id;
  const id = await createFolder(name, undefined, signal);
  await saveSettings({ driveRootFolder: { name, id } });
  return id;
}

/** A Drive failure in words the user can act on. */
function problemText(error: unknown): string {
  if (error instanceof GoogleError) {
    // Drive answers 403 when it's full, as well as when access was taken away.
    if (error.status === undefined && error.problem === "scope") return "Google Drive refused the files. Your Drive may be full, or Scout's Drive access was removed in Settings → Google.";
    return error.message;
  }
  return "Saving to Google Drive didn't work. It will be tried again with the next send, or use Try Again.";
}

export const driveBackupJob = defineJob({
  type: "drive-backup",
  input: z.object({ applicationId: z.string().min(1) }),
  result: z.object({ folderUrl: z.string(), files: z.number().int() }),
  async run({ applicationId }, { step, signal }) {
    try {
      return await backUp(applicationId, step, signal);
    } catch (error) {
      await prisma.application.updateMany({ where: { id: applicationId }, data: { driveProblem: problemText(error) } });
      throw error;
    }
  },
});

async function backUp(applicationId: string, step: (name: string) => Promise<void>, signal: AbortSignal) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: {
      company: true,
      role: true,
      title: true,
      location: true,
      salary: true,
      postingUrl: true,
      postingText: true,
      sentAt: true,
      driveFolderId: true,
      drivePostingFileId: true,
      posting: { select: { description: true } },
      sentDocuments: { orderBy: { sentAt: "asc" }, select: { id: true, kind: true, format: true, sentAt: true, driveFileId: true } },
    },
  });
  if (!application) throw new GoogleError("unavailable", "That application no longer exists.");
  const settings = await loadSettings();

  await step("Finding the folder in Google Drive");
  const root = await rootFolder(settings.driveFolderName, signal);
  let folder = application.driveFolderId;
  let postingFile = application.drivePostingFileId;
  let pending = application.sentDocuments.filter((sent) => !sent.driveFileId);
  if (!folder || !(await stillThere(folder, signal))) {
    // A new folder, or the old one was deleted: everything goes in afresh.
    folder = await createFolder(applicationFolderName(application), root, signal);
    postingFile = null;
    pending = application.sentDocuments;
    await prisma.application.update({ where: { id: applicationId }, data: { driveFolderId: folder, drivePostingFileId: null } });
  }

  let uploaded = 0;
  if (!postingFile) {
    await step("Saving the posting");
    const data = await postingDocx({
      company: application.company,
      role: application.role || application.title,
      location: application.location,
      salary: application.salary,
      url: application.postingUrl,
      text: application.postingText || application.posting?.description || "",
      sentAt: application.sentAt,
    });
    const name = `${applicationFolderName(application)} – Job description.docx`;
    postingFile = await uploadFile({ name, contentType: DOCX_TYPE, data, parent: folder }, signal);
    await prisma.application.update({ where: { id: applicationId }, data: { drivePostingFileId: postingFile } });
    uploaded++;
  }

  // Each send's copies together, so a letter and resume sent as PDFs can go in as one file.
  const sends = new Map<number, typeof pending>();
  for (const sent of pending) sends.set(sent.sentAt.getTime(), [...(sends.get(sent.sentAt.getTime()) ?? []), sent]);
  const name = await loadProfileName();
  const fileName = (kind: DocumentKind, format: FileFormat, sentAt: Date) =>
    resolveFileName(settings.fileNamePattern, { name, company: application.company, role: application.role, doc: kind, date: sentAt }, format === FileFormat.DOCX ? "docx" : "pdf");

  for (const copies of sends.values()) {
    await step("Saving the resume and cover letter as they were sent");
    const letter = copies.find((sent) => sent.kind === DocumentKind.COVER_LETTER);
    const resume = copies.find((sent) => sent.kind === DocumentKind.RESUME);
    if (settings.driveCombine && letter && resume && letter.format === FileFormat.PDF && resume.format === FileFormat.PDF) {
      const data = await combinePdfs([await renderPdf(`/print/sent/${letter.id}`), await renderPdf(`/print/sent/${resume.id}`)]);
      const combinedName = fileName(DocumentKind.RESUME, FileFormat.PDF, resume.sentAt).replace(/\.pdf$/i, " with cover letter.pdf");
      const id = await uploadFile({ name: combinedName, contentType: PDF_TYPE, data, parent: folder }, signal);
      await prisma.sentDocument.updateMany({ where: { id: { in: [letter.id, resume.id] } }, data: { driveFileId: id } });
      uploaded++;
      continue;
    }
    for (const sent of copies) {
      let data: Uint8Array;
      if (sent.format === FileFormat.DOCX) {
        const built = await sentDocx(sent.id);
        if (!built) continue;
        data = built.file;
      } else {
        data = await renderPdf(`/print/sent/${sent.id}`);
      }
      const id = await uploadFile(
        { name: fileName(sent.kind, sent.format, sent.sentAt), contentType: sent.format === FileFormat.DOCX ? DOCX_TYPE : PDF_TYPE, data, parent: folder },
        signal,
      );
      await prisma.sentDocument.update({ where: { id: sent.id }, data: { driveFileId: id } });
      uploaded++;
    }
  }

  await prisma.application.update({ where: { id: applicationId }, data: { driveProblem: null } });
  if (uploaded > 0) {
    await prisma.note.create({
      data: { applicationId, kind: NoteKind.UPDATE, body: `Saved to Google Drive: ${settings.driveFolderName} / ${applicationFolderName(application)}`, at: new Date() },
    });
  }
  // The sheet links to what was just saved.
  (await import("./applications-sheet")).queueSheetSync();
  return { folderUrl: folderUrl(folder), files: uploaded };
}
