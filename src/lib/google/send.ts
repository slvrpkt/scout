import "server-only";

import { ApplicationStatus, DocumentKind, EmailDirection, FileFormat } from "@/generated/prisma/enums";
import { unitsSchema } from "@/lib/application-data";
import { loadDocuments } from "@/lib/application-documents";
import { emailAddresses, emailParts } from "@/lib/application-email";
import { resolveFileName } from "@/lib/file-name";
import { approveCandidate } from "@/lib/agent/draft";
import { countPdfPages } from "@/lib/pdf/pages";
import { renderPdf } from "@/lib/pdf/render";
import { prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";
import { saveSentCopies } from "@/lib/sent-documents";
import { maxPages } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";
import { applyStatusChange } from "@/lib/status-changes";

import { loadGoogleAccount } from "./account";
import { GoogleError } from "./errors";
import { sendMail } from "./gmail";
import type { Attachment } from "./mime";

// Sending through Gmail (E15-2): the application's email with its PDFs, and
// answers to employers in their thread. Each send is asked for by the user;
// nothing goes out on its own.

const PRINTED = [
  { kind: DocumentKind.RESUME, path: "resume" },
  { kind: DocumentKind.COVER_LETTER, path: "letter" },
] as const;

/** "Jane Doe <jane@gmail.com>", from the profile's name and the account. */
async function sender(address: string): Promise<string> {
  const name = (await loadProfileName()).trim().replace(/[<>"]/g, "");
  return name ? `${name} <${address}>` : address;
}

/** A send takes no longer than this; one still marked after it stopped halfway. */
const SEND_TAKES_MS = 2 * 60 * 1000;

export type SendCheck = {
  /** What's worth a look before it goes, in words. */
  problems: string[];
  /** An earlier send stopped halfway, so this one may have gone out. */
  unclear: boolean;
};

/** What to look at before sending: read from what would be attached, so it's right however the documents changed. */
export async function checkBeforeSending(applicationId: string): Promise<SendCheck> {
  const [{ application, profile, resume, letter, settings }, account] = await Promise.all([loadDocuments(applicationId), loadGoogleAccount()]);
  const problems: string[] = [];
  if (!resume) problems.push("There's no resume to attach.");
  if (!letter && !application.noCoverLetter) problems.push("There's no cover letter to attach.");
  if (application.resumePagesAsk) problems.push("The question about a third page on the resume isn't answered yet.");
  const limit = application.resumePageLimit ?? maxPages(settings.pageLimit);
  if (resume && limit) {
    const pages = countPdfPages(await renderPdf(`/print/resume/${applicationId}`));
    if (pages > limit) problems.push(pages === Number.MAX_SAFE_INTEGER ? `The resume's pages couldn't be counted, so it can't be checked against your limit of ${limit}.` : `The resume runs to ${pages} pages, over your limit of ${limit}.`);
  }
  if (letter && !application.noCoverLetter && countPdfPages(await renderPdf(`/print/letter/${applicationId}`)) > 1) problems.push("The cover letter runs past one page.");
  const resumeEmail = profile.basics.email.trim();
  if (account && resumeEmail && resumeEmail.toLowerCase() !== account.email.toLowerCase()) {
    problems.push(`Your resume gives ${resumeEmail}, but this goes from ${account.email}. Scout only sees replies to ${account.email}.`);
  }
  const unverified = [...new Set([...(resume?.units ?? []), ...(letter?.units ?? [])].flatMap((unit) => unit.unverified ?? []))];
  if (unverified.length > 0) problems.push(`Not found in your profile or the posting, so check they're true: ${unverified.join(", ")}.`);
  if (application.sentAt) problems.push(`This application was already sent on ${application.sentAt.toLocaleDateString("en-US", { dateStyle: "medium" })}.`);
  return { problems, unclear: application.sendingAt !== null && Date.now() - application.sendingAt.getTime() > SEND_TAKES_MS };
}

export type SentApplication = { threadId: string; eventId: string | null; attachments: string[] };

/**
 * Sends the application's email from the connected account, with the
 * tailored resume and cover letter attached, keeps the thread to watch for
 * replies, and moves a draft to Sent.
 */
export async function sendApplicationEmail(applicationId: string, { checked = false }: { checked?: boolean } = {}): Promise<SentApplication> {
  const account = await loadGoogleAccount();
  if (!account) throw new GoogleError("not-connected", "Connect your Google account in Settings → Google first.");
  const application = await prisma.application.findUnique({ where: { id: applicationId }, include: { documents: { select: { kind: true, units: true } } } });
  if (!application) throw new GoogleError("unavailable", "That application no longer exists.");

  const units = unitsSchema.safeParse(application.documents.find((document) => document.kind === DocumentKind.EMAIL)?.units);
  if (!units.success) throw new GoogleError("unavailable", "Write the email first.");
  const { to, subject, body } = emailParts(units.data);
  if (emailAddresses(to).length === 0) throw new GoogleError("unavailable", "Add who it's to first: the posting doesn't give an address.");
  if (!subject.trim() || !body.trim()) throw new GoogleError("unavailable", "The email needs a subject and a message.");

  // One send at a time. One that stopped halfway stays marked until you've checked Gmail.
  if (checked) await prisma.application.updateMany({ where: { id: applicationId, sendingAt: { lt: new Date(Date.now() - SEND_TAKES_MS) } }, data: { sendingAt: null } });
  const { count } = await prisma.application.updateMany({ where: { id: applicationId, sendingAt: null }, data: { sendingAt: new Date() } });
  if (count === 0) throw new GoogleError("unavailable", "This is already being sent, or an earlier send may have gone out. Check your Gmail Sent folder first.");
  const notSending = () => prisma.application.updateMany({ where: { id: applicationId }, data: { sendingAt: null } });

  const [name, settings] = await Promise.all([loadProfileName(), loadSettings()]);
  const attachments: Attachment[] = [];
  for (const { kind, path } of PRINTED) {
    if (!application.documents.some((document) => document.kind === kind)) continue;
    if (kind === DocumentKind.COVER_LETTER && application.noCoverLetter) continue;
    attachments.push({
      fileName: resolveFileName(settings.fileNamePattern, { name, company: application.company, role: application.role, doc: kind, date: new Date() }),
      contentType: "application/pdf",
      data: await renderPdf(`/print/${path}/${applicationId}`).catch(async () => {
        await notSending();
        throw new GoogleError("unavailable", "Scout couldn't print the attachments, so nothing was sent. Try again in a moment.");
      }),
    });
  }

  const from = await sender(account.email);
  const sent = await sendMail({ from, to, subject, body, attachments }).catch(async (error: unknown) => {
    await notSending();
    throw error;
  });
  // It's gone out. If saving that fails, sendingAt stays, and the next try says to check Gmail first.
  await prisma.$transaction([
    prisma.application.update({ where: { id: applicationId }, data: { emailThreadId: sent.threadId } }),
    prisma.emailMessage.upsert({
      where: { gmailId: sent.id },
      create: {
        gmailId: sent.id,
        threadId: sent.threadId,
        applicationId,
        direction: EmailDirection.OUTGOING,
        fromName: name.trim(),
        fromAddress: account.email.toLowerCase(),
        toAddress: to,
        subject,
        body,
        sentAt: new Date(),
        handledAt: new Date(),
      },
      update: {},
    }),
  ]);

  let eventId: string | null = null;
  if (application.status === ApplicationStatus.DRAFT) {
    // An agent draft still waiting for review is released by sending it, as by moving it on anywhere else.
    const pending = await prisma.agentCandidate.findFirst({ where: { applicationId, application: { awaitingReview: true } }, select: { id: true } });
    if (pending) await approveCandidate(pending.id);
    // Gmail attached PDFs, so those are what Drive keeps.
    const change = await applyStatusChange(prisma, applicationId, ApplicationStatus.SENT, new Date(), { sentFormat: FileFormat.PDF });
    if (change.outcome === "changed") eventId = change.event.id;
  } else {
    // Sent again: this send gets its own frozen copy.
    await prisma.$transaction((tx) => saveSentCopies(tx, applicationId, new Date(), null, FileFormat.PDF));
  }
  await notSending();
  return { threadId: sent.threadId, eventId, attachments: attachments.map((file) => file.fileName) };
}

/** "Re: …", unless it already is. */
export const replySubject = (subject: string) => (/^\s*(re|aw|sv|antw)\s*:/i.test(subject) ? subject.trim() : `Re: ${subject.trim()}`);

/** Sends the answer to an employer's mail in its thread, and marks the mail as answered. */
export async function sendReply(emailId: string, body: string): Promise<{ applicationId: string | null }> {
  const account = await loadGoogleAccount();
  if (!account) throw new GoogleError("not-connected", "Connect your Google account in Settings → Google first.");
  const email = await prisma.emailMessage.findUnique({ where: { id: emailId } });
  if (!email) throw new GoogleError("unavailable", "That email is no longer in Scout.");
  if (!body.trim()) throw new GoogleError("unavailable", "Write the answer first.");
  if (/\[…\]|\[\.\.\.\]/.test(body)) throw new GoogleError("unavailable", "Fill in the parts marked […] first.");

  const to = email.replyTo || (email.fromName ? `${email.fromName.replace(/[<>"]/g, "")} <${email.fromAddress}>` : email.fromAddress);
  const subject = replySubject(email.subject);
  const sent = await sendMail(
    { from: await sender(account.email), to, subject, body, inReplyTo: email.messageId || undefined },
    { threadId: email.threadId },
  );
  await prisma.$transaction([
    prisma.emailMessage.update({ where: { id: emailId }, data: { handledAt: new Date(), replyDraft: "", replyGaps: [] } }),
    prisma.emailMessage.upsert({
      where: { gmailId: sent.id },
      create: {
        gmailId: sent.id,
        threadId: sent.threadId,
        applicationId: email.applicationId,
        direction: EmailDirection.OUTGOING,
        fromName: (await loadProfileName()).trim(),
        fromAddress: account.email.toLowerCase(),
        toAddress: to,
        subject,
        body,
        sentAt: new Date(),
        handledAt: new Date(),
      },
      update: {},
    }),
  ]);
  return { applicationId: email.applicationId };
}
