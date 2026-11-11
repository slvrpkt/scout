import "server-only";

import { z } from "zod";

import { DocumentKind, VersionCause } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { isAiUsable } from "@/lib/ai/config";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { writeCoverLetter } from "@/lib/ai/tasks";
import { matchSchema } from "@/lib/application-data";
import { loadDocuments, readJson } from "@/lib/application-documents";
import { updateDocuments } from "@/lib/document-units";
import { saveVersion } from "@/lib/document-versions";
import { fitLetterToPage } from "@/lib/letter-fit";
import { isFrameUnit, isParagraph, withFrame } from "@/lib/letter-frame";
import { logServerError } from "@/lib/log";

import { defineJob, findUnfinishedJobs, startJob } from "./runner";

// The job agent's drafts are made without a cover letter, which costs as
// much as the rest of a draft and many applications never need. It's
// written when you first open the draft, in the background, then fitted to
// its page, as any letter is.

export const letterKey = (applicationId: string) => `write-letter:${applicationId}`;

/** A letter with only its frame (sender, date, greeting…) and no paragraphs: not written yet. */
export const letterPending = (units: readonly { id: string }[]) => !units.some(isParagraph);

export const writeLetterJob = defineJob({
  type: "write-letter",
  input: z.object({ applicationId: z.string().min(1) }),
  result: z.object({ written: z.boolean() }),
  async run({ applicationId }, { step, signal }) {
    await step("Drafting your cover letter");
    const { application, profile, extracted, letter } = await loadDocuments(applicationId);
    if (!letter || !extracted || !letterPending(letter.units)) return { written: false };
    const [provider, options] = await Promise.all([getAiProvider(), loadTaskOptions()]);
    const { data, promptVersion } = await writeCoverLetter(
      provider,
      {
        profile,
        extracted,
        match: readJson(matchSchema, application.match),
        tone: application.tone,
        facts: application.facts.map((fact) => fact.text),
        posting: application.postingText,
      },
      { ...options, signal },
    );
    await updateDocuments(
      applicationId,
      async (documents) => {
        // The frame the draft was made with stays; the AI's greeting and recipient, where it wrote them, take their place.
        const frame = Object.fromEntries((documents[DocumentKind.COVER_LETTER] ?? []).filter((unit) => isFrameUnit(unit.id)).map((unit) => [unit.id, unit.text]));
        documents[DocumentKind.COVER_LETTER] = withFrame(data, frame);
      },
      { version: { cause: VersionCause.WRITTEN, detail: `the cover letter (${promptVersion})` } },
    );
    await fitLetterToPage(applicationId, signal).catch((error: unknown) => logServerError("fitting the cover letter", error));
    return { written: true };
  },
});

/**
 * Writes the cover letter again for the application as it is now: the job's
 * requirements and the tailored resume, edits and all. The one before stays
 * in History. False without a letter.
 */
export async function rewriteLetter(applicationId: string, detail: string, before: string, signal?: AbortSignal): Promise<boolean> {
  const { application, profile, extracted, letter, resume } = await loadDocuments(applicationId);
  if (!letter || !extracted) return false;
  const [provider, options] = await Promise.all([getAiProvider(), loadTaskOptions()]);
  const { data } = await writeCoverLetter(
    provider,
    {
      profile,
      extracted,
      match: readJson(matchSchema, application.match),
      tone: application.tone,
      facts: application.facts.map((fact) => fact.text),
      posting: application.postingText,
      resume: resume?.units,
    },
    { ...options, signal },
  );
  await updateDocuments(
    applicationId,
    async (documents, tx) => {
      const stored = await tx.document.findUnique({ where: { applicationId_kind: { applicationId, kind: DocumentKind.COVER_LETTER } } });
      if (stored) await saveVersion(tx, stored.id, documents[DocumentKind.COVER_LETTER] ?? [], { cause: VersionCause.BEFORE_RESTORE, detail: before });
      const frame = Object.fromEntries((documents[DocumentKind.COVER_LETTER] ?? []).filter((unit) => isFrameUnit(unit.id)).map((unit) => [unit.id, unit.text]));
      documents[DocumentKind.COVER_LETTER] = withFrame(data, frame);
    },
    { version: { cause: VersionCause.REGENERATED, detail } },
  );
  await fitLetterToPage(applicationId, signal).catch((error: unknown) => logServerError("fitting the cover letter", error));
  return true;
}

/** Opening a draft whose letter isn't written yet: write it in the background, unless that's under way. The job's id, or null. */
export async function queueLetter(applicationId: string): Promise<string | null> {
  try {
    const running = await findUnfinishedJobs(letterKey(applicationId));
    if (running.length > 0) return running[0].id;
    if (!(await isAiUsable())) return null;
    return await startJob(writeLetterJob, { applicationId }, { key: letterKey(applicationId) });
  } catch (error) {
    logServerError("queueing the cover letter", error);
    return null;
  }
}
