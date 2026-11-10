import { resumeTemplateSchema } from "@/lib/resume-template";
import "server-only";

// Loading an application with its tailored documents, for its page (E8)
// and for printing them (E8-8).

import { notFound } from "next/navigation";
import { cache } from "react";
import { z } from "zod";

import { DateFormat, DocumentKind, PaperSize, Tone } from "@/generated/prisma/enums";
import { extractedSchema, trimmedSchema, unitsSchema, type Trimmed, type Unit } from "@/lib/application-data";
import { prisma } from "@/lib/prisma";
import type { ProfileData } from "@/lib/profile";
import { loadProfile } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";
import { loadTheme, THEME_FIELDS } from "@/lib/theme-data";
import { BUILT_IN_THEMES, LETTER_POINTS, RESUME_POINTS, type ThemeData } from "@/lib/themes";

/**
 * The application for its page, with its documents and their themes, or the
 * not-found page when there's no such application. Cached per request, so the
 * page and its metadata share it.
 */
export const loadApplication = cache(async (id: string) => {
  const application = await prisma.application.findUnique({
    where: { id },
    include: {
      documents: { include: { theme: { select: THEME_FIELDS } } },
      messages: { orderBy: { createdAt: "asc" } },
      notes: true,
      events: { select: { id: true, to: true, at: true } },
      sentDocuments: { select: { id: true, kind: true, eventId: true, sentAt: true } },
      facts: { select: { id: true, text: true }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!application) notFound();
  return application;
});

/**
 * A JSON column read with its schema. Data that doesn't fit, such as rows
 * written by an older version, reads as null rather than breaking the page.
 */
export function readJson<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Today's date (or `date`'s) in the server's time zone, at UTC midnight, as documents expect. */
export function calendarDay(date = new Date()): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

/** A tailored document's units and the theme it's shown in, with what was left out to fit its page limit. */
export type DocumentData = { units: Unit[]; theme: ThemeData; trimmed?: Trimmed };

/** All a sent copy depends on besides its words, as it was when it went out. */
export const sentSnapshotSchema = z.object({
  theme: z.custom<ThemeData>((value) => typeof value === "object" && value !== null),
  profile: z.custom<ProfileData>((value) => typeof value === "object" && value !== null),
  paper: z.enum(PaperSize),
  dateFormat: z.enum(DateFormat),
  includeReferences: z.boolean(),
  followThemeLayout: z.boolean(),
  company: z.string(),
  location: z.string(),
  language: z.string(),
  tone: z.enum(Tone),
});
export type SentSnapshot = z.infer<typeof sentSnapshotSchema>;

/** Everything around a sent copy put back as it was when it went out. */
function asSent<T extends Awaited<ReturnType<typeof loadLiveDocuments>>>(loaded: T, snapshot: SentSnapshot) {
  const { profile, paper, dateFormat, includeReferences, followThemeLayout, company, location, language, tone } = snapshot;
  return {
    ...loaded,
    profile,
    includeReferences,
    settings: { ...loaded.settings, paper, dateFormat },
    application: { ...loaded.application, followThemeLayout, company, location, language, tone },
  };
}

/**
 * An application's tailored documents with everything needed to draw them,
 * the same for the page and for printing (E8-8). Once it's been sent, they're
 * the frozen copies, whatever has changed since; `frozen` says so.
 */
export async function loadDocuments(id: string) {
  const live = await loadLiveDocuments(id);
  const copies = live.application.sentAt
    ? await prisma.sentDocument.findMany({ where: { applicationId: id, kind: { in: [DocumentKind.RESUME, DocumentKind.COVER_LETTER] } }, orderBy: { sentAt: "desc" } })
    : [];
  const copyOf = (kind: DocumentKind) => {
    const copy = copies.find((entry) => entry.kind === kind);
    const snapshot = copy && readJson(sentSnapshotSchema, copy.snapshot);
    const units = copy && readJson(unitsSchema, copy.units);
    return copy && snapshot && units ? { copy, snapshot, document: { units, theme: snapshot.theme } satisfies DocumentData } : null;
  };
  const resume = copyOf(DocumentKind.RESUME);
  const letter = copyOf(DocumentKind.COVER_LETTER);
  const first = resume ?? letter;
  if (!first) return { ...live, frozen: false };
  return {
    ...asSent(live, first.snapshot),
    resume: resume?.document ?? null,
    letter: letter?.document ?? null,
    letterDate: calendarDay(first.copy.sentAt),
    frozen: true,
  };
}

async function loadLiveDocuments(id: string) {
  const [application, profile, settings] = await Promise.all([loadApplication(id), loadProfile(), loadSettings()]);
  const baseTheme = (await loadTheme(settings.baseThemeId)) ?? BUILT_IN_THEMES[0];
  const documentData = (kind: DocumentKind): DocumentData | null => {
    const document = application.documents.find((entry) => entry.kind === kind);
    const units = document && readJson(unitsSchema, document.units);
    const trimmed = document && readJson(trimmedSchema, document.trimmed);
    const textPoints = kind === DocumentKind.RESUME ? RESUME_POINTS : LETTER_POINTS;
    const noRoleSkills = kind === DocumentKind.RESUME && application.resumeNoSkills;
    const hide = kind === DocumentKind.RESUME ? application.resumeHide : [];
    return document && units ? { units, theme: { ...(document.theme ?? baseTheme), textPoints, noRoleSkills, hide }, ...(trimmed?.length ? { trimmed } : {}) } : null;
  };
  const extracted = readJson(extractedSchema, application.extracted);
  return {
    application,
    profile,
    settings,
    extracted,
    resume: documentData(DocumentKind.RESUME),
    letter: documentData(DocumentKind.COVER_LETTER),
    /** The email's units, once it's been written (Email tab). */
    email: documentData(DocumentKind.EMAIL)?.units ?? null,
    /** Settings → "Include references", when the posting asks for them (SET-9). */
    includeReferences: settings.includeRefs && extracted?.asksForReferences === true,
    /** Dated the day it was sent; until then, today. */
    letterDate: calendarDay(application.sentAt ?? undefined),
  };
}

/**
 * A resume or cover letter as it was sent (application history), with what
 * loadDocuments gives for drawing it: the document is the frozen copy, and a
 * letter is dated the day it went out. Null when there's no such copy.
 */
export async function loadSentDocument(id: string) {
  const sent = await prisma.sentDocument.findUnique({ where: { id }, include: { theme: { select: THEME_FIELDS } } });
  const units = sent && readJson(unitsSchema, sent.units);
  if (!sent || !units) return null;
  const live = await loadLiveDocuments(sent.applicationId);
  const snapshot = readJson(sentSnapshotSchema, sent.snapshot);
  const loaded = snapshot ? asSent(live, snapshot) : live;
  const baseTheme = (await loadTheme(loaded.settings.baseThemeId)) ?? BUILT_IN_THEMES[0];
  // Its own template, or none: never today's.
  const template = resumeTemplateSchema.safeParse(sent.template);
  const settings = { ...loaded.settings, resumeTemplate: template.success ? template.data : null };
  return { ...loaded, settings, sent, document: { units, theme: snapshot?.theme ?? { ...(sent.theme ?? baseTheme), textPoints: sent.textSize } } satisfies DocumentData, letterDate: calendarDay(sent.sentAt) };
}
