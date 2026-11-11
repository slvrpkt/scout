import { gradeOf } from "@/lib/ats-rewrite";
import { maxPages } from "@/lib/settings";
import type { Metadata } from "next";

import { letterPending, queueLetter } from "@/lib/jobs/write-letter";
import { cache } from "react";

import { activityTimeline } from "@/lib/activity";
import { isAiConfigured } from "@/lib/ai/config";
import { editsSchema, matchSchema, matchScore } from "@/lib/application-data";
import { loadApplication, loadDocuments, readJson } from "@/lib/application-documents";
import { logNeighbours } from "@/lib/applications-data";
import { formatShortDate } from "@/lib/dates";
import { driveBackupKey } from "@/lib/drive-backup";
import { resolveFileName } from "@/lib/file-name";
import { refineJobKey } from "@/lib/jobs/refine";
import { regenerateUnitJob, unitJobKey } from "@/lib/jobs/regenerate-unit";
import { findUnfinishedJobs } from "@/lib/jobs/runner";
import { emailJobKey } from "@/lib/jobs/write-email";
import { googleConnection } from "@/lib/google/account";
import { pullInterviewEvents } from "@/lib/google/availability";
import { folderUrl } from "@/lib/google/drive";
import { loadConversation } from "@/lib/google/inbox-data";
import { prisma } from "@/lib/prisma";
import { refineSuggestions } from "@/lib/refine-suggestions";
import { loadThemes } from "@/lib/theme-data";
import { userTimeZone } from "@/lib/time-zone";

import { ApplicationView } from "./application-view";
import { metaLine } from "./meta";
import { tabFrom } from "./tabs";

/**
 * Takes an interview moved or deleted in Google Calendar into the
 * application, once per request and before anything reads it:
 * loadApplication is cached for the request, and the title reads it first.
 */
const pullCalendar = cache((id: string) => pullInterviewEvents({ applicationId: id, signal: AbortSignal.timeout(3_000) }).catch(() => 0));

export async function generateMetadata({ params }: PageProps<"/applications/[id]">): Promise<Metadata> {
  const { id } = await params;
  await pullCalendar(id);
  const application = await loadApplication(id);
  return { title: application.title.trim() || "Untitled application" };
}

/** One application (PRD §6.5): its status, tailored documents, email, posting and notes. */
export default async function ApplicationPage({ params, searchParams }: PageProps<"/applications/[id]">) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  await pullCalendar(id);
  const [
    { application, profile, settings, extracted, resume, letter, frozen, email, includeReferences, letterDate },
    aiReady,
    unitJobs,
    refineJobs,
    emailJobs,
    timeZone,
    google,
    emails,
    themes,
    driveJobs,
  ] = await Promise.all([
      loadDocuments(id),
      isAiConfigured(),
      findUnfinishedJobs(unitJobKey(id)),
      findUnfinishedJobs(refineJobKey(id)),
      findUnfinishedJobs(emailJobKey(id)),
      userTimeZone(),
      googleConnection(),
      loadConversation(id),
      loadThemes(),
      findUnfinishedJobs(driveBackupKey(id)),
    ]);

  // A job agent draft's letter is written when it's first opened.
  const letterJobId = letter && letterPending(letter.units) && !frozen ? await queueLetter(id) : null;
  const match = readJson(matchSchema, application.match);
  const messages = application.messages
    .map((message, index) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      targetUnit: message.targetUnit,
      // Written in code when the application was created (E7-6).
      opening: index === 0 && message.role === "AI" && !message.writtenWith,
      canUndo: message.role === "AI" && (readJson(editsSchema, message.edits)?.length ?? 0) > 0,
      undone: message.undone,
    }))
    // Settings → "Show what changed" off hides the list of what was tailored (SET-5).
    .filter((message) => settings.showDiff || !message.opening);
  const { title, company, location, status, tone, language, followThemeLayout, nextInterviewAt } = application;
  // Units still being rewritten, so a reload keeps showing it.
  const rewriting = unitJobs.flatMap((job) => {
    const input = regenerateUnitJob.input.safeParse(job.input);
    return input.success ? [{ jobId: job.id, document: input.data.document, unitId: input.data.unitId }] : [];
  });
  // The PDFs to attach to the email, named as they'll download (SET-8).
  const fileName = (doc: "RESUME" | "COVER_LETTER") =>
    resolveFileName(settings.fileNamePattern, { name: profile.basics.name, company: application.company, role: application.role, doc, date: new Date() });

  // The resume's ATS grade as it is now: the score, and the chips beside the chat.
  const atsGrade = settings.atsOptimize ? gradeOf({ application, profile, resume, extracted, includeReferences, settings }) : null;
  // The suggestions beside the resume, while they're being worked out again after an edit.
  const [suggestionsJob] = await findUnfinishedJobs(`suggestions:${id}`);
  return (
    <ApplicationView
      application={{
        id,
        title,
        company,
        location,
        status,
        tone,
        language,
        followThemeLayout,
        archived: application.archivedAt !== null,
        awaitingReview: application.awaitingReview,
        resumePagesAsk: application.resumePagesAsk,
        resumePagesReason: application.resumePagesReason,
        resumeSuggestions: application.resumeSuggestions,
        reviewCandidateId: application.awaitingReview
          ? ((await prisma.agentCandidate.findFirst({ where: { applicationId: application.id }, select: { id: true } }))?.id ?? null)
          : null,
        nextInterviewAt,
      }}
      timeZone={timeZone}
      posting={{
        text: application.postingText,
        // New applications only keep web links, but an imported file could carry any URL (E11-5).
        url: /^https?:\/\//i.test(application.postingUrl) ? application.postingUrl : "",
        pasted: formatShortDate(application.createdAt),
      }}
      match={match}
      requirements={extracted?.requirements ?? []}
      facts={application.facts}
      drive={
        application.driveFolderId || application.driveProblem || driveJobs.length > 0
          ? { folderUrl: application.driveFolderId ? folderUrl(application.driveFolderId) : null, problem: application.driveProblem, saving: driveJobs.length > 0 }
          : null
      }
      activity={activityTimeline({ notes: application.notes, events: application.events, sentDocuments: application.sentDocuments, createdAt: application.createdAt, timeZone })}
      meta={metaLine(application)}
      resume={resume}
      letter={letter}
      letterJobId={letterJobId}
      frozen={frozen}
      outdated={application.status === "DRAFT" && settings.profileChangedAt !== null && Date.parse(settings.profileChangedAt) > (application.resumeWrittenAt ?? application.createdAt).getTime()}
      themes={themes}
      baseThemeId={settings.baseThemeId}
      email={email}
      writingEmail={emailJobs.at(-1)?.id ?? null}
      attachments={{ resume: resume ? fileName("RESUME") : null, letter: letter ? fileName("COVER_LETTER") : null }}
      gmail={
        google.status === "not-configured" && emails.length === 0
          ? undefined
          : {
              sender:
                google.status === "connected"
                  ? google.canSend
                    ? { from: google.email }
                    : { from: null, reason: "no-permission" }
                  : { from: null, reason: google.status === "not-configured" ? "not-configured" : "not-connected" },
              sentBefore: application.emailThreadId !== null,
              emails,
              reading: google.status === "connected" && google.canRead && settings.gmailRead,
            }
      }
      profile={profile}
      paper={settings.paper}
      dateFormat={settings.dateFormat}
      includeReferences={includeReferences}
      template={settings.resumeTemplate}
      atsGrade={atsGrade}
      suggestionsJobId={suggestionsJob?.id ?? null}
      pageLimit={application.status === "DRAFT" ? (application.resumePageLimit ?? maxPages(settings.pageLimit)) : null}
      letterDate={letterDate}
      score={match && match.items.length > 0 ? matchScore(match) : null}
      initialTab={tabFrom(tab)}
      aiReady={aiReady}
      rewriting={rewriting}
      messages={messages}
      refining={refineJobs.at(-1)?.id ?? null}
      neighbours={application.awaitingReview ? null : await logNeighbours(id, settings)}
      suggestions={refineSuggestions({
        live: atsGrade,
        match,
        requirements: extracted?.requirements ?? [],
        tone,
        hasSummary: Boolean(resume?.units.some((unit) => unit.id === "summary" && unit.text.trim())),
      })}
    />
  );
}
