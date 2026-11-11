import { COST_CENTERS, DEFAULT_COST_LIMITS } from "@/lib/cost-rates";
import { z } from "zod";

import { AiProvider, Creativity, DateFormat, PaperSize, Tone } from "@/generated/prisma/enums";
import { EMPTY_QUERY, JOB_SOURCES, JSEARCH_HOSTS, searchQuerySchema } from "@/lib/job-search/search";
import { resumeTemplateSchema } from "@/lib/resume-template";
import { rubricSchema } from "@/lib/scoring/rubric";
import { DEFAULT_SCORING_PREFS, scoringPrefsSchema } from "@/lib/scoring/preferences";
import { SCORERS } from "@/lib/scoring/scorers";
import { startupsRefreshSchema } from "@/lib/startups/types";

/** Date styles for documents (SET-6), labelled with an example as in the prototype. */
/** The date styles Settings → Documents offers. The older day-first ones still print, but are no longer offered. */
/** The base resume's lengths: every point, or two or three pages. */
export const BASE_LENGTHS = ["full", "2", "3"] as const;
export type BaseLength = (typeof BASE_LENGTHS)[number];

export const DATE_FORMATS: readonly { value: DateFormat; label: string }[] = [
  { value: DateFormat.US_NUMERIC, label: "09/27/2026 (MM/DD/YYYY)" },
  { value: DateFormat.US_SHORT, label: "09/27/26 (MM/DD/YY)" },
  { value: DateFormat.MONTH_DAY_YEAR, label: "September 27, 2026 (Month Day, Year)" },
];

/** Dates written only in numbers, the same in every language. */
export const NUMERIC_DATE_FORMATS: readonly DateFormat[] = [DateFormat.NUMERIC, DateFormat.US_NUMERIC, DateFormat.US_SHORT];

/**
 * Formats a calendar date in the chosen style, with month names in the
 * document's language. Uses the date's UTC day, so pass a date at UTC midnight.
 */
export function formatDocumentDate(date: Date, format: DateFormat, locale = "en-US"): string {
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const two = (value: number) => String(value).padStart(2, "0");
  if (format === DateFormat.NUMERIC) return `${two(day)}-${two(date.getUTCMonth() + 1)}-${year}`;
  if (format === DateFormat.US_NUMERIC) return `${two(date.getUTCMonth() + 1)}/${two(day)}/${year}`;
  if (format === DateFormat.US_SHORT) return `${two(date.getUTCMonth() + 1)}/${two(day)}/${two(year % 100)}`;
  const month = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(date);
  return format === DateFormat.DAY_MONTH_YEAR ? `${day} ${month} ${year}` : `${month} ${day}, ${year}`;
}

/**
 * How long a finished background job is kept (Settings → Your data). Its
 * input and result hold what an AI task was given and wrote: a posting,
 * a resume's text, drafts not yet in an application.
 */
export const JOB_RETENTION_OPTIONS: readonly { hours: number; label: string }[] = [
  { hours: 1, label: "1 hour" },
  { hours: 24, label: "24 hours" },
  { hours: 24 * 7, label: "7 days" },
  { hours: 24 * 30, label: "30 days" },
];
export const DEFAULT_JOB_RETENTION_HOURS = 24;
export const isJobRetention = (hours: number) => JOB_RETENTION_OPTIONS.some((option) => option.hours === hours);
/** "24 hours" */
export const jobRetentionLabel = (hours: number) =>
  JOB_RETENTION_OPTIONS.find((option) => option.hours === hours)?.label ?? `${hours} hours`;

const pageLimit = z.enum(["1", "2", "3", "none"]);
export type PageLimit = z.infer<typeof pageLimit>;

/**
 * "Resume length" (SET-9): how many pages a tailored resume may run to. One
 * that runs over is trimmed when its application is created (E10-10).
 */
export const PAGE_LIMITS: readonly { value: PageLimit; label: string; pages: number | null }[] = [
  { value: "1", label: "One page", pages: 1 },
  { value: "2", label: "Up to two pages", pages: 2 },
  { value: "3", label: "Up to three pages", pages: 3 },
  { value: "none", label: "No limit", pages: null },
];
/** The most pages a resume may have, or null for no limit. */
export const maxPages = (limit: PageLimit): number | null => PAGE_LIMITS.find((option) => option.value === limit)?.pages ?? null;
/** "one page", "two pages", "three pages" */
export const pagesInWords = (pages: number) => (pages === 1 ? "one page" : pages === 2 ? "two pages" : pages === 3 ? "three pages" : `${pages} pages`);

// ─── Stored settings ─────────────────────────────────────────────────────────
// Settings are stored in the Setting table, one text row per key: enums by
// name, flags as "true"/"false", lists as JSON. A missing key, or a value that
// doesn't fit, reads as the default below; null means "not set".

export const DEFAULT_BASE_THEME = "standard";

const flag = (fallback: boolean) => z.stringbool().catch(fallback);

/** A value stored as JSON. */
const json = <T extends z.ZodType>(schema: T) =>
  z
    .string()
    .transform((value): unknown => {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    })
    .pipe(schema);

/** A list stored as a JSON array of strings. */
const stringList = json(z.array(z.string()));

/**
 * One run of the job agent (E16), kept here rather than as its Job, which
 * the task-data sweep deletes: the daily limit counts these.
 */
export const agentRunSchema = z.object({
  at: z.iso.datetime(),
  manual: z.boolean(),
  /** What the run ended with, for the Agent screen; null while it runs. */
  message: z.string().nullable(),
  /** It got nothing, or a restart cut it short, so the schedule tries again. */
  failed: z.boolean().optional(),
  /** It had nothing to do, so it didn't search. */
  skipped: z.boolean().optional(),
  /** It only went over locations that failed. */
  retry: z.boolean().optional(),
});
export type AgentRun = z.infer<typeof agentRunSchema>;
/** What the job agent used of its daily budgets, on `day` ("YYYY-MM-DD") in the user's time zone. */
/** The Google Drive folder what's sent is saved in, until the user names another. */
export const DRIVE_FOLDER_NAME = "Job search 2026-27";

export const agentUsageSchema = z.object({ day: z.string(), scored: z.number().int().min(0), drafted: z.number().int().min(0) });
export type AgentUsage = z.infer<typeof agentUsageSchema>;
/** How many postings the agent may score, and drafts it may prepare, in a day. */
export const AGENT_DAILY_SCORES = { min: 1, max: 1000, default: 150 } as const;
export const AGENT_DAILY_DRAFTS = { min: 0, max: 100, default: 30 } as const;

/** How many runs are kept: more than a day's worth, for the limit and the screen. */
export const AGENT_RUNS_KEPT = 40;

/** A time of day the agent runs, "HH:MM" on the quarter hour (its schedule checks every 15 minutes). */
export const agentTimeSchema = z.string().regex(/^([01]\d|2[0-3]):(00|15|30|45)$/);
/** The most run times a day. */
export const MAX_AGENT_TIMES = 8;
/** When a new install's agent runs. */
/** Titles that are never right, by a word in them. Editable as agentTitleSkip. */
export const DEFAULT_TITLE_SKIP = [
  "intern", "internship", "apprentice", "co-op", "volunteer",
  "ceo", "cto", "cio", "cfo", "coo", "cmo", "chro", "ciso", "chief", "president", "vice president", "vp", "svp", "evp", "founder", "co-founder",
  "nurse", "nursing", "rn", "lpn", "physician", "dentist", "dental hygienist", "pharmacist", "therapist", "medical assistant", "caregiver", "veterinary",
  "sales representative", "account executive", "recruiter", "copywriter", "accountant", "bookkeeper", "paralegal", "attorney", "underwriter", "loan officer", "bank teller",
  "construction", "civil engineer", "mechanical engineer", "electrician", "plumber", "hvac", "welder", "carpenter", "foreman", "real estate", "property manager",
  "truck driver", "delivery driver", "warehouse", "forklift", "cashier", "store manager", "chef", "cook", "barista", "housekeeper", "janitor", "security guard",
  "teacher", "professor", "tutor", "childcare", "wedding", "interior design", "fashion",
];

export const DEFAULT_AGENT_TIMES = ["04:00", "08:00", "13:00"];
/** Run times in order, each once. */
export const sortedTimes = (times: readonly string[]) => [...new Set(times)].sort();

export const settingsSchema = z.object({
  // AI provider (SET-1). Null means "not set in the app": fall back to the
  // DOSSIER_AI_* environment variables, then to the built-in defaults.
  provider: z.enum(AiProvider).nullable().catch(null),
  baseUrl: z.string().nullable().catch(null),
  model: z.string().nullable().catch(null),
  /** Encrypted with a key derived from DOSSIER_SECRET (E6-2); never sent to the client. */
  apiKeyEnc: z.string().nullable().catch(null),
  creativity: z.enum(Creativity).catch(Creativity.BALANCED),
  /** "Never invent experience" (SET-4). */
  strict: flag(true),
  /** "Humanize writing" under the AI provider: write without the usual signs of AI text. */
  humanize: flag(true),
  /** An ATS grade on each tailored resume, with what to fix and Rewrite to Reach A. */
  atsOptimize: flag(true),
  /** "Show what changed" (SET-5). */
  showDiff: flag(true),
  paper: z.enum(PaperSize).catch(PaperSize.LETTER),
  /** One of DATE_FORMATS; a day-first style chosen before they were dropped reads as "September 27, 2026". */
  dateFormat: z
    .enum(DateFormat)
    .transform((format) => (DATE_FORMATS.some((offered) => offered.value === format) ? format : DateFormat.MONTH_DAY_YEAR))
    .catch(DateFormat.MONTH_DAY_YEAR),
  defaultTone: z.enum(Tone).catch(Tone.WARM),
  /** Language for generated documents; null means "the posting's language" (SET-7). */
  docLanguage: z.string().nullable().catch(null),
  /** The base resume's language, for its headings and dates; null means English, with the direction read from the profile. */
  resumeLanguage: z.string().nullable().catch(null),
  /** Languages added with "Other language…", kept in the list. */
  customLanguages: stringList.catch([]),
  fileNamePattern: z.string().catch("{name} – {company} – {doc}"),
  includeRefs: flag(false),
  // The base resume's two-page rule (resume-fit.ts): on, and how many trims
  // the last PDF needed to fit, which the preview and the Word file follow.
  baseCondense: flag(true),
  baseFitStep: z.coerce.number().int().min(0).catch(0),
  /** The base resume left out the skills line under each job to fit, set with baseFitStep. */
  baseNoSkills: flag(false),
  /** The base resume's short summary, and the profile summary it was written from. */
  baseSummary: json(z.object({ from: z.string(), text: z.string() })).nullable().catch(null),
  /** When the profile last changed, for telling older drafts they're out of date. */
  profileChangedAt: z.string().nullable().catch(null),
  /** The profile as last acted on, to notice a change. */
  profileStamp: z.string().nullable().catch(null),
  /** The base resume's length on its page and in downloads: Full (every point), or two or three pages of the strongest. */
  baseLength: z.enum(BASE_LENGTHS).catch("2"),
  /** The base resume's versions the AI wrote, by length: each job's bullets, and what they were made from (base-resume.ts). */
  baseVersions: json(z.partialRecord(z.enum(BASE_LENGTHS), z.object({ from: z.string(), bullets: z.record(z.string(), z.array(z.string())), summaries: z.record(z.string(), z.record(z.string(), z.array(z.string()))).optional(), promptVersion: z.string().optional() }))).catch({}),
  /** How each fitted length was last trimmed to its pages, and what that left out, in words. */
  baseFit: json(z.partialRecord(z.enum(BASE_LENGTHS), z.object({ taken: z.number().int().min(0), dropped: z.array(z.string()), noSkills: z.boolean().optional(), hide: z.array(z.string()).optional(), fits: z.boolean().optional() }))).catch({}),
  /** The base resume's certifications and tools with no bearing on the usual title, and what that was judged from; left out only as a fit's last resort. */
  baseIrrelevant: json(z.object({ from: z.string(), hide: z.array(z.string()) })).nullable().catch(null),
  /** The two-page base resume's skills, tools and certifications left out to keep them to a third of page two, and what that was chosen from. */
  baseCompact: json(z.object({ from: z.string(), hide: z.array(z.string()) })).nullable().catch(null),
  /** Whether the base resume may use a third page rather than shorten its 3 most recent jobs: asked at download; asked again after Experience changes. */
  baseThirdPage: z.enum(["ask", "allow", "deny"]).catch("ask"),
  /** The layout read from a resume you uploaded, which base and tailored resumes follow; null keeps the theme's own. */
  resumeTemplate: json(resumeTemplateSchema).nullable().catch(null),
  /** Your own scoring rubric (#42), Settings → Scoring; empty scores as Scout always has. */
  scoringRubric: json(rubricSchema).catch([]),
  /** Your say in the score, Settings → Scoring: fit, work style, pay and distance points, and words that rule a job out. */
  scoringPrefs: json(scoringPrefsSchema).catch(DEFAULT_SCORING_PREFS),
  /** Up to two pages unless chosen (decided 22 October 2026: resumes aren't forced to one page). */
  pageLimit: pageLimit.catch("2"),
  nightlyBackup: flag(true),
  /** Finished background jobs are deleted after this many hours (JOB_RETENTION_OPTIONS). */
  jobRetentionHours: z.coerce.number().refine(isJobRetention).catch(DEFAULT_JOB_RETENTION_HOURS),
  /** A theme's id. loadSettings() reads a deleted one as Editorial. */
  baseThemeId: z.string().catch(DEFAULT_BASE_THEME),
  /** The Applications screen as last left (LST-7): view, filter and sort, e.g. "-match". */
  applicationsView: z.enum(["board", "table"]).catch("board"),
  applicationsFilter: z.enum(["all", "active", "closed"]).catch("all"),
  applicationsSort: z.string().catch("updated"),
  /** The dashboard's period as last left (E9-8). */
  dashboardPeriod: z.enum(["week", "lastweek", "30d", "90d", "all"]).catch("all"),
  /** Days without news before "Worth a look" suggests a follow-up (E9-9). */
  quietDays: z.coerce.number().int().min(1).max(60).catch(7),
  /** Experience, projects and education: newest first by date, or the order set by hand (E4-9). */
  experienceOrder: z.enum(["date", "manual"]).catch("date"),
  projectOrder: z.enum(["date", "manual"]).catch("date"),
  educationOrder: z.enum(["date", "manual"]).catch("date"),
  /** Why the last nightly backup failed; null once one works again (E10-7). */
  backupProblem: z.string().nullable().catch(null),
  // Job search (E14-4). Null means "not set in the app": DOSSIER_JOBS_SOURCE
  // decides. "OFF" is a choice. Each source keeps its own key, encrypted
  // like the AI key, so switching back and forth loses nothing.
  jobSource: z.enum([...JOB_SOURCES, "OFF"]).nullable().catch(null),
  jsearchKeyEnc: z.string().nullable().catch(null),
  /** Where the JSearch key is from: OpenWeb Ninja, or the RapidAPI marketplace. */
  jsearchHost: z.enum(JSEARCH_HOSTS).catch("openwebninja"),
  adzunaAppId: z.string().nullable().catch(null),
  adzunaKeyEnc: z.string().nullable().catch(null),
  /** When "I understand" was ticked under the Bundesagentur für Arbeit's note (#223); its searches wait for it. */
  arbeitsagenturAcceptedAt: z.iso.datetime().nullable().catch(null),
  // Scoring (#274): what Score in Find jobs and the job agent score postings
  // with. Null means "not set in the app": DOSSIER_SCORER decides, else the
  // AI model. Jev's key is encrypted like the others, under its own key.
  scorer: z.enum(SCORERS).nullable().catch(null),
  typesafeKeyEnc: z.string().nullable().catch(null),
  // Job agent (E16): one search, run once a day. Off until it's turned on.
  // It asks the source in Settings → Job search, with its key.
  agentEnabled: flag(false),
  /** When it was last switched on: run times before this aren't caught up, so switching it on doesn't start a run at once. */
  agentOnSince: z.iso.datetime().nullable().catch(null),
  /** The search it runs, as Find jobs asks it; it needs keywords and a country to run. */
  agentQuery: json(searchQuerySchema).catch(EMPTY_QUERY),
  /** The hour of the day it ran before it had several times (agentTimes reads it when it has none). */
  agentHour: z.coerce.number().int().min(0).max(23).catch(7),
  /** The times of day it runs, in the user's time zone. */
  agentTimes: json(z.array(agentTimeSchema).min(1).max(MAX_AGENT_TIMES).transform(sortedTimes)).catch(DEFAULT_AGENT_TIMES),
  /** Postings scored below this stay out of the queue. */
  agentMinScore: z.coerce.number().int().min(0).max(100).catch(70),
  /** Before daily budgets: the most postings a run scored, and drafts it prepared. Unused now (agentDailyScores, agentDailyDrafts). */
  agentMaxScores: z.coerce.number().int().min(1).max(30).catch(15),
  agentMaxDrafts: z.coerce.number().int().min(0).max(10).catch(3),
  /** Whether a run prepares drafts for its best postings, or only scores them (on by default here: the budgets keep it in check). */
  agentAutoDraft: flag(true),
  /** The daily budgets, across all runs. */
  agentDailyScores: z.coerce.number().int().min(AGENT_DAILY_SCORES.min).max(AGENT_DAILY_SCORES.max).catch(AGENT_DAILY_SCORES.default),
  /** How many of the day's scores each run time gets, in time order; without a number per time, an even split. */
  agentShares: json(z.array(z.number().int().min(0))).catch([]),
  /** A posting needs this score for a draft; from agentMinScore up it only shows its score. */
  agentDraftScore: z.coerce.number().int().min(0).max(100).catch(80),
  /** How many of the day's drafts each run time gets, in time order; what's unused carries on. Without a number per time, an even split. */
  agentDraftShares: json(z.array(z.number().int().min(0))).catch([]),
  /** Stop for the day once this many postings reached agentMinScore. */
  agentDailyGoal: z.coerce.number().int().min(1).max(1000).catch(150),
  /** Words that rule a job out by its title alone, before anything is paid for. */
  agentTitleSkip: json(z.array(z.string())).catch(DEFAULT_TITLE_SKIP),
  /** Score by batch, at half the price, where the provider has it. */
  agentBatch: flag(true),
  /** A daily, weekly and monthly limit per service (cost-rates.ts); past one, the job agent stops. On from the start, at DEFAULT_COST_LIMITS. */
  costLimits: json(z.partialRecord(z.enum(COST_CENTERS), z.object({ day: z.number().nullish(), week: z.number().nullish(), month: z.number().nullish() }))).catch(DEFAULT_COST_LIMITS),
  /** The batch that's out, if any. */
  agentBatchId: z.string().nullable().catch(null),
  /** When the batch that's out was sent, to say when to check back. */
  agentBatchAt: z.string().nullable().catch(null),
  /** When to see whether the search is done and scoring can start. */
  agentScoreAt: z.string().nullable().catch(null),
  agentDailyDrafts: z.coerce.number().int().min(AGENT_DAILY_DRAFTS.min).max(AGENT_DAILY_DRAFTS.max).catch(AGENT_DAILY_DRAFTS.default),
  /** Today's use of them. It belongs to the install, so exports leave it out (INSTALL_SETTINGS). */
  agentUsage: json(agentUsageSchema).nullable().catch(null),
  /** The latest runs, newest first. They belong to the install: exports leave them out (INSTALL_SETTINGS). */
  agentRuns: json(z.array(agentRunSchema)).catch([]),
  // Startups (#222): when the screen was last opened, since the daily refresh
  // only runs while it's in use, and what the last refresh found. They belong
  // to the install, not its data, so exports leave them out (INSTALL_SETTINGS).
  startupsViewedAt: z.iso.datetime().nullable().catch(null),
  startupsLastRefresh: json(startupsRefreshSchema).nullable().catch(null),
  /** "Check for updates daily" in Settings → About (update-check.ts). */
  updateCheck: flag(false),
  // The newest release the update check has seen, the UTC day it last
  // asked, and the release "Not now" hid the sidebar notice for. They belong
  // to the install, not its data, so exports leave them out (INSTALL_SETTINGS).
  latestVersion: z.string().nullable().catch(null),
  latestVersionUrl: z.string().nullable().catch(null),
  updateCheckDay: z.string().nullable().catch(null),
  updateDismissed: z.string().nullable().catch(null),
  // Gmail and Calendar (E15). Off until the Google account is connected.
  // The OAuth client, entered in Settings → Google. Null means "not set in the
  // app": DOSSIER_GOOGLE_CLIENT_ID and DOSSIER_GOOGLE_CLIENT_SECRET decide.
  googleClientId: z.string().nullable().catch(null),
  /** Encrypted like the API keys (GOOGLE_CLIENT_SECRET); never sent to the client. */
  googleClientSecretEnc: z.string().nullable().catch(null),
  /** Read replies from Gmail. */
  gmailRead: flag(true),
  /** Which mail the inbox check reads: only threads Scout knows and company domains, or every new mail. */
  gmailScope: z.enum(["known", "all"]).catch("known"),
  /** Minutes between inbox checks. */
  gmailInterval: z.coerce.number().int().min(5).max(120).catch(10),
  /** Look in the calendar for free times when an employer asks to meet. */
  calendarAvailability: flag(true),
  /** Add agreed interviews to the calendar. */
  calendarEvents: flag(true),
  /** The calendar to read and write; "primary" is the account's own. */
  calendarId: z.string().catch("primary"),
  /** Working days, 1 = Monday … 7 = Sunday, as JSON. */
  workDays: json(z.array(z.number().int().min(1).max(7))).catch([1, 2, 3, 4, 5]),
  /** Working hours as "HH:MM". */
  workStart: z.string().regex(/^\d{2}:\d{2}$/).catch("09:00"),
  workEnd: z.string().regex(/^\d{2}:\d{2}$/).catch("17:00"),
  /** The time zone for free slots and interviews; null means the browser's. */
  workTimeZone: z.string().nullable().catch(null),
  /** Interview length and the gap kept around other meetings, in minutes. */
  slotMinutes: z.coerce.number().int().min(15).max(240).catch(45),
  bufferMinutes: z.coerce.number().int().min(0).max(120).catch(15),
  // Google Drive backup: what's sent is saved in Drive, one folder per
  // application inside a folder of this name. A new name starts a new folder.
  driveBackup: flag(true),
  driveFolderName: z.string().trim().min(1).max(100).catch(DRIVE_FOLDER_NAME),
  /** Save the cover letter and resume of a PDF send as one PDF, the letter first. */
  driveCombine: flag(false),
  // The Drive folder made for driveFolderName, and its name. It belongs to
  // the install, not its data, so exports leave it out (INSTALL_SETTINGS).
  driveRootFolder: json(z.object({ name: z.string(), id: z.string() })).nullable().catch(null),
  // The Job application log's Google Sheet: the file and the folder it's in,
  // when it was last synced and why the last sync didn't work. They belong
  // to the install, so exports leave them out (INSTALL_SETTINGS).
  driveSheet: json(z.object({ folderId: z.string(), id: z.string() })).nullable().catch(null),
  driveSheetSyncedAt: z.iso.datetime().nullable().catch(null),
  driveSheetProblem: z.string().nullable().catch(null),
  /** Copy each backup to Google Drive's "Scout backups" folder, once Drive is allowed. */
  backupToDrive: flag(true),
  // The "Scout backups" folder and the copies in it, newest first. They belong
  // to the install, so exports leave them out (INSTALL_SETTINGS).
  driveBackupFolder: z.string().nullable().catch(null),
  driveBackupFiles: json(z.array(z.object({ id: z.string(), name: z.string() }))).catch([]),
  driveBackupProblem: z.string().nullable().catch(null),
  // The Claude connector (#221): when it was turned on, or Claude was last
  // disconnected; null while it's off, and then its addresses answer 404.
  // Every connector token carries it, so a new value signs Claude out. It
  // belongs to the install, so exports leave it out (INSTALL_SETTINGS).
  connectorEnabledAt: z.iso.datetime().nullable().catch(null),
  /** Other MCP apps' callback addresses, allowed like Claude's (#281). The install's too: an import must never add one. */
  connectorRedirects: stringList.catch([]),
  // The browser's time zone as it last told the server, for work done
  // without a request, such as the inbox check (time-zone.ts). It belongs
  // to the install, not its data, so exports leave it out (INSTALL_SETTINGS).
  browserTimeZone: z.string().nullable().catch(null),
});
export type SettingsData = z.output<typeof settingsSchema>;

/** The settings from Setting rows; keys it doesn't know are ignored. */
export function settingsFromRows(rows: readonly { key: string; value: string }[]): SettingsData {
  const values: Record<string, string> = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  // Up to 1.7, the limit was "Keep resumes to one page" (onePage), and off meant no limit. Databases and export files may still have it.
  if (values.pageLimit === undefined && values.onePage === "false") values.pageLimit = "none";
  if (values.pageLimit === undefined && values.onePage === "true") values.pageLimit = "1";
  // Before it had several run times, the agent ran once a day after agentHour.
  if (values.agentTimes === undefined && /^\d{1,2}$/.test(values.agentHour ?? "") && Number(values.agentHour) < 24) {
    values.agentTimes = JSON.stringify([`${values.agentHour.padStart(2, "0")}:00`]);
  }
  return settingsSchema.parse(values);
}

/** The text stored for a setting's value, or null for "not set", whose row is removed. */
export function settingValue(value: SettingsData[keyof SettingsData]): string | null {
  if (value === null) return null;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
