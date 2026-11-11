"use server";

import { AiError } from "@/lib/ai/errors";
import { queueSuggestions } from "@/lib/jobs/refresh-suggestions";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { ApplicationStatus, ChatRole, DocumentKind, NoteKind, VersionCause } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { isAiConfigured, isAiUsable } from "@/lib/ai/config";
import { editsSchema, extractedSchema, matchSchema, trimmedSchema, unitsSchema, withSkillAdded } from "@/lib/application-data";
import { WRITTEN_EMAIL_UNITS } from "@/lib/application-email";
import { updateDocuments } from "@/lib/document-units";
import { backupReady, queueDriveBackup } from "@/lib/drive-backup";
import { DOCUMENT_LABELS } from "@/lib/file-name";
import { syncInterviewToCalendar } from "@/lib/google/availability";
import { GoogleError } from "@/lib/google/errors";
import { isFrameUnit, withFrame, WRITTEN_FRAME_UNITS } from "@/lib/letter-frame";
import { saveVersion } from "@/lib/document-versions";
import { refineJob, refineJobKey } from "@/lib/jobs/refine";
import { regenerateUnitJob, unitJobKey } from "@/lib/jobs/regenerate-unit";
import { findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { emailJobKey, writeEmailJob } from "@/lib/jobs/write-email";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { maxPages, pagesInWords } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";
import { loadProfile } from "@/lib/profile-data";
import { findOrCreateSkill } from "@/lib/profile-entries";
import { sampleApplicationIds } from "@/lib/sample-data";
import { saveSentCopies } from "@/lib/sent-documents";
import { addHeadingUnit, isHeadingUnit, withHeadingUnits } from "@/lib/resume-heading";
import { saveApplicationJob } from "@/lib/application-saved";
import { replacePostingText, rewriteForPosting } from "@/lib/replace-posting";
import { rewriteLetter } from "@/lib/jobs/write-letter";
import { applyStatusChange } from "@/lib/status-changes";
import { cleanUnitText, isPublicationUnit, unitName } from "@/lib/unit-text";

const GONE = "That application no longer exists.";
const PART_GONE = "That part of the document no longer exists. Reload the page to see what's there now.";

const refresh = (id: string) => revalidatePath(`/applications/${id}`);
/** The application and the history of every application, which shows its entries too. */
const refreshHistory = (id: string) => {
  refresh(id);
  revalidatePath("/applications/history");
};

/** The Resume tab's layout switch (APP-4): the theme's own layout, or a single column. */
export const setFollowThemeLayout = action(
  z.object({ id: z.string().min(1), follow: z.boolean() }),
  async ({ id, follow }) => {
    const { count } = await prisma.application.updateMany({ where: { id }, data: { followThemeLayout: follow } });
    if (count === 0) throw new ActionError(GONE);
    refresh(id);
    return null;
  },
);

/** Replace the job description (Job Posting tab): the full text, read again and matched with the profile. */
export const replacePosting = action(
  z.object({ id: z.string().min(1), text: z.string().trim().min(100, "That's shorter than a job description. Paste the whole posting.").max(100_000) }),
  async ({ id, text }, { toast }) => {
    if ((await prisma.application.count({ where: { id } })) === 0) throw new ActionError(GONE);
    try {
      await replacePostingText(id, text);
    } catch (error) {
      if (error instanceof AiError) throw new ActionError(error.message);
      logServerError("replacing a job description", error);
      throw new ActionError("The description couldn't be read just now, so the old one stays. Try again in a moment.");
    }
    refresh(id);
    toast("The full job description is in. The match and ATS score follow it now.");
    return null;
  },
);

/** "Rewrite the resume and cover letter for the full posting", once the description was replaced. */
export const rewriteForFullPosting = action(z.object({ id: z.string().min(1) }), async ({ id }, { toast }) => {
  const application = await prisma.application.findUnique({ where: { id }, select: { sentAt: true } });
  if (!application) throw new ActionError(GONE);
  if (application.sentAt) throw new ActionError("This application was already sent, so its resume stays as it went out.");
  let letter: boolean;
  try {
    ({ letter } = await rewriteForPosting(id));
  } catch (error) {
    if (error instanceof AiError) throw new ActionError(error.message);
    logServerError("rewriting for the full job description", error);
    throw new ActionError("It couldn't be rewritten just now, so it stays as it is. Try again in a moment.");
  }
  refresh(id);
  toast(`Rewritten for the full job description: the resume${letter ? " and cover letter" : ""}. The earlier versions are in History.`);
  return null;
});

/** Regenerate cover letter: written again from the job's requirements and the resume as it is now. */
export const regenerateCoverLetter = action(z.object({ id: z.string().min(1) }), async ({ id }, { toast }) => {
  const application = await prisma.application.findUnique({ where: { id }, select: { sentAt: true, noCoverLetter: true } });
  if (!application) throw new ActionError(GONE);
  if (application.sentAt) throw new ActionError("This application was already sent, so its cover letter stays as it went out.");
  if (application.noCoverLetter) throw new ActionError("This application goes without a cover letter.");
  try {
    if (!(await rewriteLetter(id, "the cover letter for your latest resume", "As it was before it was regenerated"))) {
      throw new ActionError("There's no cover letter to regenerate yet.");
    }
  } catch (error) {
    if (error instanceof ActionError) throw error;
    if (error instanceof AiError) throw new ActionError(error.message);
    logServerError("regenerating a cover letter", error);
    throw new ActionError("The cover letter couldn't be regenerated just now, so it stays as it is. Try again in a moment.");
  }
  refresh(id);
  toast("Cover letter regenerated from your latest resume. The earlier one is in History.");
  return null;
});

/** Save for later in the application's header: the job it was made from goes on Saved for later, or comes off. */
export const saveApplicationForLater = action(z.object({ id: z.string().min(1), saved: z.boolean() }), async ({ id, saved }, { toast }) => {
  if (!(await saveApplicationJob(id, saved))) throw new ActionError(GONE);
  toast(saved ? "Saved for later." : "Taken off Saved for later.");
  revalidatePath("/saved");
  refresh(id);
  return null;
});

/**
 * "No cover letter" on the Cover letter tab, and its undo: the application
 * goes without one. Nothing is written or thrown away: a letter already
 * written stays, unused. Marked after a send, that send's letter is taken
 * off what was sent too, unless it's already in Google Drive.
 */
export const setNoCoverLetter = action(z.object({ id: z.string().min(1), on: z.boolean() }), async ({ id, on }) => {
  const { count } = await prisma.application.updateMany({ where: { id }, data: { noCoverLetter: on } });
  if (count === 0) throw new ActionError(GONE);
  if (on) await prisma.sentDocument.deleteMany({ where: { applicationId: id, kind: DocumentKind.COVER_LETTER, driveFileId: null } });
  refresh(id);
  return null;
});

/**
 * The Theme menu on the Resume and Cover letter tabs (#226, public issue 10):
 * gives the application's resume and cover letter another theme, together.
 * Only their look changes, so nothing is written again.
 */
export const setApplicationTheme = action(z.object({ id: z.string().min(1), themeId: z.string().min(1) }), async ({ id, themeId }) => {
  if (!(await prisma.theme.count({ where: { id: themeId } }))) {
    throw new ActionError("That theme doesn't exist anymore. Reload the page to see your themes.");
  }
  if (!(await prisma.application.count({ where: { id } }))) throw new ActionError(GONE);
  await prisma.document.updateMany({
    where: { applicationId: id, kind: { in: [DocumentKind.RESUME, DocumentKind.COVER_LETTER] } },
    data: { themeId },
  });
  refresh(id);
  return null;
});

/**
 * The next interview's date and time (E9-9), or null to remove it. It shows
 * on the dashboard's "Worth a look" while the application is in Interview,
 * and while Scout keeps interviews in Google Calendar, the event is added,
 * moved or deleted to match.
 */
export const setInterviewDate = action(
  z.object({ id: z.string().min(1), at: z.iso.datetime().nullable() }),
  async ({ id, at }, { toast }) => {
    const { count } = await prisma.application.updateMany({ where: { id }, data: { nextInterviewAt: at ? new Date(at) : null } });
    if (count === 0) throw new ActionError(GONE);
    refresh(id);
    try {
      const { inCalendar } = await syncInterviewToCalendar(id);
      if (inCalendar) toast(at ? "Interview date saved, in your calendar too." : "Interview date removed, from your calendar too.");
      else toast(at ? "Interview date saved. It'll show on your dashboard." : "Interview date removed.");
    } catch (error) {
      if (!(error instanceof GoogleError)) throw error;
      toast(`${at ? "Interview date saved" : "Interview date removed"}, but your calendar wasn't changed: ${error.message}`);
    }
    return null;
  },
);

/**
 * Saves a unit edited by hand (APP-6). `expected` is the text the editor
 * started from: if the unit changed since (an AI rewrite that finished
 * meanwhile), nothing is saved, so neither version is lost unseen. The
 * text is the user's own, so the fact guard's hints go.
 */
export const saveUnit = action(
  z.object({
    id: z.string().min(1),
    document: z.enum(DocumentKind),
    unitId: z.string().min(1),
    text: z.string().max(10_000),
    expected: z.string(),
  }),
  async ({ id, document, unitId, text, expected }) => {
    const clean = cleanUnitText(unitId, text);
    // The email's recipient may be left empty, for the mail app to fill in.
    if (!clean && !(document === DocumentKind.EMAIL && unitId === "to")) {
      throw new ActionError("Write something first, or cancel to keep it as it was.");
    }

    await updateDocuments(id, async (documents) => {
      const units = documents[document];
      const unit = units?.find((entry) => entry.id === unitId);
      // A letter written before E8-11 shows its frame without storing it: the first edit stores that part.
      if (!unit && units && document === DocumentKind.COVER_LETTER && isFrameUnit(unitId)) {
        documents[document] = withFrame(units, { [unitId]: clean });
        return;
      }
      // A job's heading or your location, changed for this resume alone: stored from now on. The profile stays as it is.
      if (!unit && units && document === DocumentKind.RESUME && isHeadingUnit(unitId)) {
        const drawn = withHeadingUnits(units, await loadProfile()).find((entry) => entry.id === unitId);
        if (!drawn) throw new ActionError(PART_GONE);
        documents[document] = addHeadingUnit(units, { ...drawn, text: clean });
        return;
      }
      if (!unit) throw new ActionError(PART_GONE);
      if (unit.text !== expected) {
        throw new ActionError("This part changed while you were editing it. Copy your text, cancel, and edit the new version.");
      }
      unit.text = clean;
      delete unit.unverified;
    });
    if (document === DocumentKind.RESUME) await queueSuggestions(id);
    refresh(id);
    return { text: clean };
  },
);

const unitInput = { id: z.string().min(1), document: z.enum(DocumentKind), unitId: z.string().min(1) };

/**
 * "Regenerate" (E8-4): rewrites one unit in the background and returns the
 * job's id. Asking again while it's being rewritten follows the same job.
 */
export const startRegenerating = action(
  z.object({
    ...unitInput,
    /** For a letter part an older letter only shows (E8-11): the text on screen, stored before it's rewritten. */
    shown: z.string().trim().min(1).max(2000).optional(),
  }),
  async ({ id, document, unitId, shown }) => {
    const frame = document === DocumentKind.COVER_LETTER && isFrameUnit(unitId);
    // The sender, date and signature come from the profile and the day, not the AI (E8-11).
    if ((frame && !WRITTEN_FRAME_UNITS.has(unitId)) || (document === DocumentKind.EMAIL && !WRITTEN_EMAIL_UNITS.has(unitId))) {
      throw new ActionError("This part isn't written by the AI. Edit it instead.");
    }
    // A publication is the user's own citation (#218).
    if (document === DocumentKind.RESUME && isPublicationUnit(unitId)) {
      throw new ActionError("A publication stays as you wrote it. Edit it instead.");
    }
    if (frame && shown) {
      await updateDocuments(id, async (documents) => {
        const units = documents[document];
        if (units && !units.some((entry) => entry.id === unitId)) documents[document] = withFrame(units, { [unitId]: shown });
      });
    }
    const row = await prisma.document.findUnique({ where: { applicationId_kind: { applicationId: id, kind: document } } });
    const unit = row && unitsSchema.parse(row.units).find((entry) => entry.id === unitId);
    if (!unit) throw new ActionError(PART_GONE);

    for (const job of await findUnfinishedJobs(unitJobKey(id))) {
      const input = regenerateUnitJob.input.safeParse(job.input);
      if (input.success && input.data.document === document && input.data.unitId === unitId) return job.id;
    }
    return startJob(regenerateUnitJob, { applicationId: id, document, unitId, from: unit.text }, { key: unitJobKey(id), applicationId: id });
  },
);

/**
 * Undo on the "Rewrote the summary." toast (E8-4): puts the previous
 * version back, unless the unit has changed again since.
 */
export const restoreUnit = action(
  z.object({
    ...unitInput,
    text: z.string().max(10_000),
    unverified: z.array(z.string()).optional(),
    /** The text it has now, which Undo replaces. */
    expected: z.string(),
  }),
  async ({ id, document, unitId, text, unverified, expected }) => {
    await updateDocuments(id, async (documents) => {
      const unit = documents[document]?.find((entry) => entry.id === unitId);
      if (!unit) throw new ActionError(PART_GONE);
      if (unit.text !== expected) throw new ActionError("It's been changed again since, so this can't be undone.");
      unit.text = text;
      if (unverified?.length) unit.unverified = unverified;
      else delete unit.unverified;
    }, { version: { cause: VersionCause.UNDONE } });
    refresh(id);
    return null;
  },
);

/** The answer on the Job posting tab, where there's nothing to change. */
const POSTING_REPLY = "I can change the resume, the cover letter or the email. Switch to one of them, or hover a section and pick “Ask AI”.";

/**
 * Sends a message from the Refine with AI panel (E8-5): saves it and starts
 * the reply in the background, returning the job's id. On the Job posting
 * tab without a picked unit, the reply comes at once and needs no AI.
 */
export const sendMessage = action(
  z.object({
    id: z.string().min(1),
    text: z.string().trim().min(1, "Write what should change first.").max(2000),
    /** The document on screen; null on the Job posting and Notes tabs, and on the Email tab before there's an email. */
    viewing: z.enum(DocumentKind).nullable(),
    /** The unit picked with "Ask AI". */
    target: z.object({ document: z.enum(DocumentKind), unitId: z.string().min(1) }).nullable(),
  }),
  async ({ id, text, viewing, target }) => {
    if (!(await prisma.application.count({ where: { id } }))) throw new ActionError(GONE);

    if (!viewing && !target) {
      const now = Date.now();
      await prisma.chatMessage.createMany({
        data: [
          { applicationId: id, role: ChatRole.USER, text, createdAt: new Date(now) },
          { applicationId: id, role: ChatRole.AI, text: POSTING_REPLY, createdAt: new Date(now + 1) },
        ],
      });
      refresh(id);
      return { jobId: null };
    }

    if (!(await isAiConfigured())) throw new ActionError("That needs an AI provider. Choose one in Settings → AI provider.");
    if ((await findUnfinishedJobs(refineJobKey(id))).length > 0) {
      throw new ActionError("I'm still working on your last message. Send this one when I'm done.");
    }
    let targetLabel: string | null = null;
    if (target) {
      const row = await prisma.document.findUnique({ where: { applicationId_kind: { applicationId: id, kind: target.document } } });
      const unit = row && unitsSchema.parse(row.units).find((entry) => entry.id === target.unitId);
      if (!unit) throw new ActionError(PART_GONE);
      targetLabel = unit.label;
    }

    const message = await prisma.chatMessage.create({
      data: { applicationId: id, role: ChatRole.USER, text, targetUnit: targetLabel },
      select: { id: true },
    });
    const jobId = await startJob(refineJob, { applicationId: id, messageId: message.id, request: text, target, viewing }, { key: refineJobKey(id), applicationId: id });
    refresh(id);
    return { jobId };
  },
);

/** "A, B and C" */
const listOf = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * "Undo" under a reply in the chat (E8-6, APP-8): puts back what the reply
 * changed, units and tone, all or nothing. A unit edited again since is
 * never overwritten; the answer says which.
 */
export const undoMessage = action(z.object({ id: z.string().min(1), messageId: z.string().min(1) }), async ({ id, messageId }) => {
  const message = await prisma.chatMessage.findFirst({ where: { id: messageId, applicationId: id, role: ChatRole.AI } });
  const edits = message && editsSchema.safeParse(message.edits);
  if (!message || !edits?.success || edits.data.length === 0) throw new ActionError("There's nothing to undo in that message.");
  if (message.undone) throw new ActionError("That's already undone.");

  await updateDocuments(id, async (documents, tx) => {
    const changed = edits.data.flatMap((edit) => {
      const unit = documents[edit.document]?.find((entry) => entry.id === edit.unitId);
      return unit?.text === edit.text ? [] : [`the ${unitName(unit ?? { id: edit.unitId, label: "" })}`];
    });
    if (changed.length > 0) {
      throw new ActionError(
        `You've changed ${listOf(changed)} since, so undoing this would overwrite that. Edit ${changed.length === 1 ? "it" : "them"} by hand instead.`,
      );
    }
    for (const edit of edits.data) {
      const unit = documents[edit.document]!.find((entry) => entry.id === edit.unitId)!;
      unit.text = edit.previousText;
      if (edit.previousUnverified?.length) unit.unverified = edit.previousUnverified;
      else delete unit.unverified;
    }
    if (message.previousTone) await tx.application.update({ where: { id }, data: { tone: message.previousTone } });
    // Only once, even when two clicks race.
    const { count } = await tx.chatMessage.updateMany({ where: { id: messageId, undone: false }, data: { undone: true } });
    if (count === 0) throw new ActionError("That's already undone.");
  }, { version: { cause: VersionCause.UNDONE } });
  refresh(id);
  return { edited: edits.data.map(({ document, unitId }) => ({ document, unitId })) };
});

/**
 * "+ Add to profile" on the Job posting tab (E8-7, NEW-5): adds a missing
 * skill to the profile, and the requirement becomes partly covered.
 */
export const addMatchSkill = action(z.object({ id: z.string().min(1), index: z.number().int().min(0) }), async ({ id, index }) => {
  const application = await prisma.application.findUnique({ where: { id }, select: { match: true, extracted: true } });
  if (!application) throw new ActionError(GONE);
  const match = matchSchema.safeParse(application.match);
  const extracted = extractedSchema.safeParse(application.extracted);
  const item = match.success ? match.data.items[index] : undefined;
  const requirement = extracted.success ? extracted.data.requirements[index] : undefined;
  if (!match.success || !item || item.result !== "gap" || requirement?.kind !== "skill" || !requirement.skill) {
    throw new ActionError("That requirement can't be added to your profile. Reload the page to see what's there now.");
  }

  const { skill } = await findOrCreateSkill(requirement.skill.trim());
  const items = match.data.items.map((entry, position) => (position === index ? withSkillAdded(entry, skill.name) : entry));
  await prisma.application.update({ where: { id }, data: { match: { items } } });
  refresh(id);
  return { name: skill.name };
});

// Private notes (E8-9, APP-14) and the rest of the history: calls,
// interviews, emails, meetings and updates, each dated when it happened.
// They stay on this server and never go into a prompt: no AI task reads the
// Note table.

const noteBody = z.string().trim().min(1, "Write something first.").max(5000);
const noteKind = z.enum(NoteKind).default(NoteKind.NOTE);
/** When it happened; not more than a day ahead, which is a typo rather than a plan. */
const noteAt = z.iso
  .datetime({ offset: true })
  .refine((value) => new Date(value).getTime() <= Date.now() + 86_400_000, "That's in the future. Pick when it happened.")
  .optional();

export const addNote = action(z.object({ id: z.string().min(1), body: noteBody, kind: noteKind, at: noteAt }), async ({ id, body, kind, at }) => {
  if (!(await prisma.application.count({ where: { id } }))) throw new ActionError(GONE);
  await prisma.note.create({ data: { applicationId: id, body, kind, ...(at ? { at: new Date(at) } : {}) } });
  refreshHistory(id);
  return null;
});

const NOTE_GONE = "That note no longer exists.";

export const updateNote = action(
  z.object({ id: z.string().min(1), noteId: z.string().min(1), body: noteBody, kind: z.enum(NoteKind).optional(), at: noteAt }),
  async ({ id, noteId, body, kind, at }) => {
    const { count } = await prisma.note.updateMany({ where: { id: noteId, applicationId: id }, data: { body, kind, ...(at ? { at: new Date(at) } : {}) } });
    if (count === 0) throw new ActionError(NOTE_GONE);
    refreshHistory(id);
    return null;
  },
);

/** Try Again on the Activity tab: saves what was sent to Google Drive again, picking up what's missing there. */
export const retryDriveBackup = action(z.object({ id: z.string().min(1) }), async ({ id }) => {
  const application = await prisma.application.findUnique({ where: { id }, select: { _count: { select: { sentDocuments: true } } } });
  if (!application) throw new ActionError(GONE);
  if (!(await backupReady())) throw new ActionError("Turn on Save What I Send To Google Drive in Settings → Google first, and allow Google Drive there.");
  if ((await sampleApplicationIds(prisma)).has(id)) throw new ActionError("Sample applications aren't saved to Google Drive.");
  await prisma.application.update({ where: { id }, data: { driveProblem: null } });
  await queueDriveBackup(id);
  revalidatePath(`/applications/${id}`);
  return null;
});

/** Deletes a note at once; it comes back with its date through `restoreNote` (Undo on the toast). */
export const deleteNote = action(z.object({ id: z.string().min(1), noteId: z.string().min(1) }), async ({ id, noteId }) => {
  const note = await prisma.note.findFirst({ where: { id: noteId, applicationId: id } });
  if (!note) throw new ActionError(NOTE_GONE);
  await prisma.note.delete({ where: { id: note.id } });
  refreshHistory(id);
  return { body: note.body, kind: note.kind, at: note.at.toISOString(), createdAt: note.createdAt.toISOString(), updatedAt: note.updatedAt.toISOString() };
});

export const restoreNote = action(
  z.object({ id: z.string().min(1), body: noteBody, kind: noteKind, at: z.iso.datetime().optional(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() }),
  async ({ id, body, kind, at, createdAt, updatedAt }) => {
    if (!(await prisma.application.count({ where: { id } }))) throw new ActionError(GONE);
    await prisma.note.create({
      data: { applicationId: id, body, kind, at: new Date(at ?? createdAt), createdAt: new Date(createdAt), updatedAt: new Date(updatedAt) },
    });
    refreshHistory(id);
    return null;
  },
);

/**
 * "Record a send": the application went out again, to a recruiter or a
 * second portal. A draft moves to Sent, which keeps what was sent itself;
 * otherwise the resume and cover letter as they are now are kept as sent
 * now, with where it went as an update in the history.
 */
export const recordSend = action(
  z.object({ id: z.string().min(1), where: z.string().trim().max(200).default("") }),
  async ({ id, where }, { toast }) => {
    const application = await prisma.application.findUnique({ where: { id }, select: { status: true } });
    if (!application) throw new ActionError(GONE);
    const now = new Date();
    let copies: number;
    if (application.status === ApplicationStatus.DRAFT) {
      const change = await applyStatusChange(prisma, id, ApplicationStatus.SENT, now);
      copies = change.outcome === "changed" ? await prisma.sentDocument.count({ where: { eventId: change.event.id } }) : 0;
    } else {
      copies = await prisma.$transaction((tx) => saveSentCopies(tx, id, now));
      if (copies > 0) await queueDriveBackup(id);
    }
    if (where) await prisma.note.create({ data: { applicationId: id, kind: NoteKind.UPDATE, body: `Sent to ${where}`, at: now } });
    revalidatePath("/", "layout");
    toast(copies > 0 ? "Recorded. The resume and cover letter as they are now are kept with it." : "Recorded. There were no documents to keep with it.");
    return { copies };
  },
);

/** Rewrite to Reach A: up to three tries, stopping at an A, using only what the profile backs. */
/** "Fit to one page" on a cover letter that's run over. */
export const fitLetterNow = action(z.object({ id: z.string().min(1) }), async ({ id }, { toast }) => {
  const { fitLetterToPage } = await import("@/lib/letter-fit");
  let fits;
  try {
    fits = await fitLetterToPage(id);
  } catch (error) {
    logServerError("fitting a cover letter", error);
    throw new ActionError("The cover letter couldn't be shortened just now, so it stays as it is. Try again in a moment.");
  }
  refresh(id);
  toast(fits ? "The cover letter fits on one page." : "It still runs long. Shorten it in the chat or by hand.");
  return null;
});

/** "Rewrite" on a draft written before the profile last changed. */
export const rewriteFromProfile = action(z.object({ id: z.string().min(1) }), async ({ id }, { toast }) => {
  const application = await prisma.application.findUnique({ where: { id }, select: { resumePageLimit: true } });
  if (!application) throw new ActionError(GONE);
  const limit = application.resumePageLimit ?? maxPages((await loadSettings()).pageLimit);
  const profile = await loadProfile();
  const { fitResumeToPages, rewriteResume } = await import("@/lib/page-limit");
  try {
    await rewriteResume(id, profile, { maxPages: limit, detail: "the resume for your latest profile", before: "As it was before your profile changed" });
    if (limit) await fitResumeToPages(id, profile, limit, undefined, undefined, "deny");
  } catch (error) {
    if (error instanceof AiError) throw new ActionError(error.message);
    logServerError("rewriting a resume from the profile", error);
    throw new ActionError("The resume couldn't be rewritten just now, so it stays as it is. Try again in a moment.");
  }
  refresh(id);
  toast("Rewritten from your latest profile. The earlier version is in History.");
  return null;
});

export const rewriteToA = action(z.object({ id: z.string().min(1) }), async ({ id }, { toast }) => {
  const application = await prisma.application.findUnique({ where: { id }, select: { id: true } });
  if (!application) throw new ActionError(GONE);
  const { rewriteToGrade } = await import("@/lib/ats-rewrite");
  let result;
  try {
    result = await rewriteToGrade(id);
  } catch (error) {
    logServerError("rewriting a resume for its ATS grade", error);
    throw new ActionError("The resume couldn't be rewritten just now, so it stays as it is. Try again in a moment.");
  }
  refresh(id);
  const { grade, singleColumn } = result;
  const layout = singleColumn ? " It now prints in a single column for that; you can turn the sidebar back on above the resume." : "";
  if (grade) toast((grade.letter === "A" ? `Reached an A: ${grade.score} of 100.` : `Stayed at ${grade.letter}: ${grade.score} of 100. See what's still missing.`) + layout);
  return null;
});

/**
 * Fit to limit: for a resume that grew past its page limit after it was
 * written. It runs only when asked, so your edits aren't changed behind your
 * back. What's trimmed joins what was left out before, ready to put back.
 */
export const fitResumeNow = action(z.object({ id: z.string().min(1) }), async ({ id }, { toast }) => {
  const application = await prisma.application.findUnique({ where: { id }, select: { resumePageLimit: true } });
  if (!application) throw new ActionError(GONE);
  const limit = application.resumePageLimit ?? maxPages((await loadSettings()).pageLimit);
  if (!limit) return null;
  const before = await prisma.document.findUnique({ where: { applicationId_kind: { applicationId: id, kind: DocumentKind.RESUME } }, select: { trimmed: true } });
  const { fitResumeToPages } = await import("@/lib/page-limit");
  const { trimmed, fits, ask } = await fitResumeToPages(id, await loadProfile(), limit, undefined, undefined, application.resumePageLimit ? "deny" : "ask");
  if (ask) {
    await prisma.application.update({ where: { id }, data: { resumePagesAsk: true } });
  } else if (trimmed.length > 0) {
    const earlier = trimmedSchema.safeParse(before?.trimmed);
    await prisma.document.updateMany({ where: { applicationId: id, kind: DocumentKind.RESUME }, data: { trimmed: trimmedSchema.parse([...(earlier.success ? earlier.data : []), ...trimmed]) } });
  }
  refresh(id);
  if (!ask) toast(fits ? `Fitted to ${pagesInWords(limit)}.` : "It still runs long. Shorten it by hand if it has to fit.");
  return null;
});

/**
 * "Leave out" (#217): takes a part off the tailored resume. It's listed with
 * what the page limit left out, so "Put back" brings it back to its place.
 * Returns where it is in that list, for Undo.
 */
export const leaveOutUnit = action(z.object({ id: z.string().min(1), unitId: z.string().min(1) }), async ({ id, unitId }) => {
  const cut = await updateDocuments(id, async (documents) => {
    const units = documents[DocumentKind.RESUME];
    const index = units ? units.findIndex((unit) => unit.id === unitId) : -1;
    if (!units || index < 0) throw new ActionError(PART_GONE);
    const [unit] = units.splice(index, 1);
    return { kind: "unit" as const, unit, index, byHand: true as const };
  });
  // Written after the document itself: updateDocuments checks it wasn't changed meanwhile.
  const row = await prisma.document.findUniqueOrThrow({
    where: { applicationId_kind: { applicationId: id, kind: DocumentKind.RESUME } },
    select: { id: true, trimmed: true },
  });
  const earlier = trimmedSchema.safeParse(row.trimmed);
  const trimmed = [...(earlier.success ? earlier.data : []), cut];
  await prisma.document.update({ where: { id: row.id }, data: { trimmed } });
  refresh(id);
  return { index: trimmed.length - 1 };
});

/**
 * "Put back" (E10-10, #217): restores a part or bullets left out, by hand or
 * to fit the page limit. Putting back twice changes nothing more.
 */
export const putBackTrimmed = action(z.object({ id: z.string().min(1), index: z.number().int().min(0) }), async ({ id, index }) => {
  const row = await prisma.document.findUnique({ where: { applicationId_kind: { applicationId: id, kind: DocumentKind.RESUME } } });
  const trimmed = row ? trimmedSchema.safeParse(row.trimmed) : null;
  const item = trimmed?.success ? trimmed.data[index] : undefined;
  if (!row || !trimmed?.success || !item) throw new ActionError("That's already back. Reload the page to see the resume as it is.");

  await updateDocuments(id, async (documents) => {
    const units = documents[DocumentKind.RESUME];
    if (!units) throw new ActionError(PART_GONE);
    if (item.kind === "unit") {
      if (!units.some((unit) => unit.id === item.unit.id)) units.splice(Math.min(item.index, units.length), 0, item.unit);
      return;
    }
    const unit = units.find((entry) => entry.id === item.unitId);
    if (!unit) throw new ActionError(PART_GONE);
    // A role summarized to fit gets its whole text back.
    if (item.kind === "summarized") {
      unit.text = item.original;
      return;
    }
    const lines = unit.text.split("\n");
    unit.text = [...lines, ...item.lines.filter((line) => !lines.includes(line))].filter(Boolean).join("\n");
  });
  const rest = trimmed.data.filter((_, position) => position !== index);
  await prisma.document.update({ where: { id: row.id }, data: { trimmed: rest.length > 0 ? rest : Prisma.DbNull } });
  refresh(id);
  return null;
});

// ─── Versions (E8-10, APP-13) ────────────────────────────────────────────────

const VERSION_GONE = "That version no longer exists. Open the history again to see what's there.";

/** A document's versions, newest first, without their units. */
export const listVersions = action(z.object({ id: z.string().min(1), document: z.enum(DocumentKind) }), async ({ id, document }) => {
  const versions = await prisma.documentVersion.findMany({
    where: { document: { applicationId: id, kind: document } },
    orderBy: { createdAt: "desc" },
    select: { id: true, cause: true, detail: true, createdAt: true },
  });
  return versions.map((version) => ({ ...version, createdAt: version.createdAt.toISOString() }));
});

/** One version's units, to look at before restoring it. */
export const loadVersion = action(z.object({ id: z.string().min(1), versionId: z.string().min(1) }), async ({ id, versionId }) => {
  const version = await prisma.documentVersion.findFirst({
    where: { id: versionId, document: { applicationId: id } },
    select: { units: true, document: { select: { kind: true } } },
  });
  if (!version) throw new ActionError(VERSION_GONE);
  return { document: version.document.kind, units: unitsSchema.parse(version.units) };
});

/**
 * Brings back an earlier version. The document as it is now is saved as a
 * version first (unless it's already the newest), so nothing is lost, and
 * the restored state becomes a version of its own.
 */
export const restoreVersion = action(z.object({ id: z.string().min(1), versionId: z.string().min(1) }), async ({ id, versionId }, { toast }) => {
  const version = await prisma.documentVersion.findFirst({
    where: { id: versionId, document: { applicationId: id } },
    select: { units: true, createdAt: true, document: { select: { id: true, kind: true } } },
  });
  if (!version) throw new ActionError(VERSION_GONE);
  const { kind } = version.document;
  const units = unitsSchema.parse(version.units);

  const stillLeftOut = await updateDocuments(
    id,
    async (documents, tx) => {
      const current = documents[kind];
      if (!current) throw new ActionError(PART_GONE);
      if (JSON.stringify(current) === JSON.stringify(units)) throw new ActionError("That's the version you have now.");
      const newest = await tx.documentVersion.findFirst({ where: { documentId: version.document.id }, orderBy: { createdAt: "desc" }, select: { units: true } });
      if (!newest || JSON.stringify(unitsSchema.parse(newest.units)) !== JSON.stringify(current)) {
        await saveVersion(tx, version.document.id, current, { cause: VersionCause.BEFORE_RESTORE });
      }
      documents[kind] = units;
      // Parts left out that the restored version has again are no longer left out.
      if (kind !== DocumentKind.RESUME) return null;
      const row = await tx.document.findUniqueOrThrow({ where: { id: version.document.id }, select: { trimmed: true } });
      const trimmed = trimmedSchema.safeParse(row.trimmed);
      if (!trimmed.success) return null;
      return trimmed.data.filter((cut) =>
        cut.kind === "unit"
          ? !units.some((unit) => unit.id === cut.unit.id)
          : cut.kind === "summarized"
            ? units.find((unit) => unit.id === cut.unitId)?.text !== cut.original
            : !cut.lines.every((line) => units.find((unit) => unit.id === cut.unitId)?.text.includes(line)),
      );
    },
    { version: { cause: VersionCause.RESTORED, detail: version.createdAt.toISOString() } },
  );
  // Written after the document itself: updateDocuments checks it wasn't changed meanwhile.
  if (stillLeftOut) {
    await prisma.document.update({
      where: { id: version.document.id },
      data: { trimmed: stillLeftOut.length > 0 ? stillLeftOut : Prisma.DbNull },
    });
  }
  toast(`Restored the ${DOCUMENT_LABELS[kind].toLowerCase()} as it was then. The version you had is in the history too.`);
  refresh(id);
  return null;
});

// ─── The email (Email tab) ───────────────────────────────────────────────────

/**
 * "Write the email" and "Rewrite": writes the application's email in the
 * background and returns the job's id. Asking again while it's being
 * written follows the same job.
 */
export const startWritingEmail = action(z.object({ id: z.string().min(1) }), async ({ id }) => {
  if (!(await prisma.application.count({ where: { id } }))) throw new ActionError(GONE);
  if (!(await isAiConfigured())) throw new ActionError("That needs an AI provider. Choose one in Settings → AI provider.");
  const [running] = await findUnfinishedJobs(emailJobKey(id));
  return running?.id ?? startJob(writeEmailJob, { applicationId: id }, { key: emailJobKey(id), applicationId: id });
});

/**
 * Undo on the "Rewrote the email." toast: puts back the email the rewrite
 * replaced, unless it has changed again since.
 */
export const undoEmailRewrite = action(z.object({ id: z.string().min(1), jobId: z.string().min(1) }), async ({ id, jobId }) => {
  const job = await prisma.job.findFirst({ where: { id: jobId, key: emailJobKey(id), status: "DONE" }, select: { result: true } });
  const result = writeEmailJob.result.safeParse(job?.result);
  const previous = result.success ? result.data.previous : null;
  if (!result.success || !previous) throw new ActionError("There's nothing to undo.");

  const same = (a: unknown, b: unknown) => JSON.stringify(unitsSchema.parse(a)) === JSON.stringify(unitsSchema.parse(b));
  await updateDocuments(id, async (documents) => {
    const current = documents[DocumentKind.EMAIL];
    if (!current) throw new ActionError(PART_GONE);
    if (!same(current, result.data.units)) {
      throw new ActionError("The email has changed since, so this can't be undone. Earlier versions are in its history.");
    }
    documents[DocumentKind.EMAIL] = previous;
  }, { version: { cause: VersionCause.UNDONE } });
  refresh(id);
  return null;
});

/**
 * The answer to "a third page?", asked when two pages would shorten the 3
 * most recent jobs or the AI thinks this job is worth one. Yes rewrites this
 * resume for three pages, this one only: Settings stay as they are, and
 * without an AI model it just fits three. No keeps it to two, summarizing
 * what it must. Either way nothing is cut that the AI can say in fewer words.
 */
export const answerResumePages = action(z.object({ id: z.string().min(1), allow: z.boolean() }), async ({ id, allow }, { toast }) => {
  const application = await prisma.application.findUnique({ where: { id }, select: { resumePagesAsk: true } });
  if (!application) throw new ActionError(GONE);
  if (!application.resumePagesAsk) return null;
  const { fitResumeToPages, rewriteForThreePages } = await import("@/lib/page-limit");
  const profile = await loadProfile();
  const rewrite = allow && (await isAiUsable());
  let fits: boolean;
  try {
    fits = rewrite ? await rewriteForThreePages(id, profile) : (await fitResumeToPages(id, profile, 2, undefined, undefined, allow ? "allow" : "deny")).fits;
  } catch (error) {
    logServerError("rewriting a resume for three pages", error);
    throw new ActionError("The resume couldn't be rewritten just now, so it stays as it is. Try again in a moment.");
  }
  await prisma.application.update({ where: { id }, data: { resumePagesAsk: false, resumePagesReason: null, resumePageLimit: allow ? 3 : null } });
  refresh(id);
  toast(fits ? (allow ? "Up to three pages, for this resume only." : "Kept to two pages.") : "It still runs long. Shorten it by hand if it has to fit.");
  return null;
});
