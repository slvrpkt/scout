import { describe, expect, it } from "vitest";

import { DateFormat } from "@/generated/prisma/enums";
import { DEFAULT_SCORING_PREFS } from "@/lib/scoring/preferences";

import { DATE_FORMATS, formatDocumentDate, maxPages, pagesInWords, settingsFromRows, settingValue, type SettingsData } from "./settings";

const date = new Date(Date.UTC(2026, 8, 7));

describe("document dates", () => {
  it("formats each style as its label shows", () => {
    const example = new Date(Date.UTC(2026, 8, 27));
    for (const { value, label } of DATE_FORMATS) {
      expect(label.startsWith(`${formatDocumentDate(example, value)} (`)).toBe(true);
    }
  });

  it("doesn't pad the day in written styles, but does in the numeric one", () => {
    expect(formatDocumentDate(date, DateFormat.DAY_MONTH_YEAR)).toBe("7 September 2026");
    expect(formatDocumentDate(date, DateFormat.MONTH_DAY_YEAR)).toBe("September 7, 2026");
    expect(formatDocumentDate(date, DateFormat.NUMERIC)).toBe("07-09-2026");
    expect(formatDocumentDate(date, DateFormat.US_NUMERIC)).toBe("09/07/2026");
    expect(formatDocumentDate(date, DateFormat.US_SHORT)).toBe("09/07/26");
  });

  it("writes month names in the document's language", () => {
    expect(formatDocumentDate(date, DateFormat.DAY_MONTH_YEAR, "nl")).toBe("7 september 2026");
  });
});

describe("stored settings", () => {
  it("reads an empty table as the prototype's defaults", () => {
    expect(settingsFromRows([])).toEqual({
      provider: null,
      baseUrl: null,
      model: null,
      apiKeyEnc: null,
      creativity: "BALANCED",
      strict: true,
      humanize: true,
      showDiff: true,
      paper: "LETTER",
      dateFormat: "MONTH_DAY_YEAR",
      defaultTone: "WARM",
      docLanguage: null,
      resumeLanguage: null,
      customLanguages: [],
      fileNamePattern: "{name} – {company} – {doc}",
      includeRefs: false,
      baseCondense: true,
      scoringRubric: [],
      scoringPrefs: DEFAULT_SCORING_PREFS,
      baseLength: "2",
      baseVersions: {},
      baseFit: {},
      baseIrrelevant: null,
      baseCompact: null,
      atsOptimize: true,
      resumeTemplate: null,
      baseFitStep: 0,
      baseThirdPage: "ask",
      pageLimit: "2",
      nightlyBackup: true,
      jobRetentionHours: 24,
      archiveClearDays: 90,
      agentClearedTally: { setAside: 0, skipped: 0, archived: 0, since: null },
      baseThemeId: "standard",
      baseNoSkills: false,
      baseSummary: null,
      profileStamp: null,
      profileChangedAt: null,
      agentDraftScore: 80,
      agentDraftShares: [],
      agentDailyGoal: 150,
      costLimits: { ANTHROPIC: { day: 1, week: 5, month: 15 }, OPENAI: { day: 1, week: 5, month: 15 }, MISTRAL: { day: 1, week: 5, month: 15 }, JSEARCH: { day: 0.3, week: 1.5, month: 6 } },
      agentTitleSkip: expect.any(Array),
      agentBatch: true,
      agentBatchId: null,
      agentBatchAt: null,
      agentScoreAt: null,
      agentShares: [],
      applicationsView: "board",
      applicationsFilter: "all",
      applicationsSort: "updated",
      dashboardPeriod: "all",
      quietDays: 7,
      experienceOrder: "date",
      projectOrder: "date",
      educationOrder: "date",
      backupProblem: null,
      jobSource: null,
      jsearchKeyEnc: null,
      jsearchHost: "openwebninja",
      adzunaAppId: null,
      adzunaKeyEnc: null,
      arbeitsagenturAcceptedAt: null,
      scorer: null,
      typesafeKeyEnc: null,
      agentEnabled: false,
      agentOnSince: null,
      agentQuery: { keywords: "", place: "", country: "", radiusKm: 25, remoteOnly: false, postedWithin: "any" },
      agentHour: 7,
      agentTimes: ["04:00", "08:00", "13:00"],
      agentMinScore: 70,
      agentMaxScores: 15,
      agentMaxDrafts: 3,
      agentAutoDraft: true,
      agentDailyScores: 150,
      agentDailyDrafts: 30,
      agentUsage: null,
      agentRuns: [],
      startupsViewedAt: null,
      startupsLastRefresh: null,
      updateCheck: false,
      latestVersion: null,
      latestVersionUrl: null,
      updateCheckDay: null,
      updateDismissed: null,
      googleClientId: null,
      googleClientSecretEnc: null,
      gmailRead: true,
      gmailScope: "known",
      gmailInterval: 10,
      calendarAvailability: true,
      calendarEvents: true,
      calendarId: "primary",
      workDays: [1, 2, 3, 4, 5],
      workStart: "09:00",
      workEnd: "17:00",
      workTimeZone: null,
      slotMinutes: 45,
      bufferMinutes: 15,
      driveBackup: true,
      driveFolderName: "Job search 2026-27",
      driveCombine: false,
      driveRootFolder: null,
      driveSheet: null,
      driveSheetSyncedAt: null,
      driveSheetProblem: null,
      backupToDrive: true,
      driveBackupFolder: null,
      driveBackupFiles: [],
      driveBackupProblem: null,
      connectorEnabledAt: null,
      connectorRedirects: [],
      browserTimeZone: null,
    });
  });

  it("reads back what it stores", () => {
    const saved = {
      provider: "OPENAI",
      strict: false,
      paper: "LETTER",
      customLanguages: ["Farsi", "Hebrew"],
      docLanguage: "Dutch",
      quietDays: 14,
      jobRetentionHours: 168,
    } satisfies Partial<SettingsData>;
    const rows = Object.entries(saved).map(([key, value]) => ({ key, value: settingValue(value)! }));
    expect(rows).toContainEqual({ key: "strict", value: "false" });
    expect(rows).toContainEqual({ key: "customLanguages", value: '["Farsi","Hebrew"]' });
    expect(rows).toContainEqual({ key: "quietDays", value: "14" });
    expect(settingsFromRows(rows)).toMatchObject(saved);
    expect(settingValue(null)).toBeNull();
  });

  it("reads values that don't fit as the default, and ignores unknown keys", () => {
    const settings = settingsFromRows([
      { key: "provider", value: "GEMINI" },
      { key: "paper", value: "A5" },
      { key: "strict", value: "maybe" },
      { key: "customLanguages", value: "Farsi, Hebrew" },
      { key: "quietDays", value: "0" },
      { key: "jobRetentionHours", value: "5" },
      { key: "theme", value: "dark" },
    ]);
    expect(settings).toMatchObject({ provider: null, paper: "LETTER", strict: true, customLanguages: [], quietDays: 7, jobRetentionHours: 24 });
    expect(settings).not.toHaveProperty("theme");
  });

  it("reads the old one-page switch as a page limit (SET-9)", () => {
    expect(settingsFromRows([{ key: "onePage", value: "false" }]).pageLimit).toBe("none");
    expect(settingsFromRows([{ key: "onePage", value: "true" }]).pageLimit).toBe("1");
    // A limit chosen since wins over the old switch.
    expect(settingsFromRows([{ key: "onePage", value: "false" }, { key: "pageLimit", value: "2" }]).pageLimit).toBe("2");
    // Unknown, or not chosen: up to two pages.
    expect(settingsFromRows([{ key: "pageLimit", value: "4" }]).pageLimit).toBe("2");
    expect(settingsFromRows([]).pageLimit).toBe("2");
  });
});

describe("the job agent's settings (E16)", () => {
  it("reads its search and runs as JSON, and values out of range as the defaults", () => {
    const query = { keywords: "Data scientist", place: "Berlin", country: "de", radiusKm: 50, remoteOnly: true, postedWithin: "week" } as const;
    const runs = [{ at: "2026-10-20T07:00:00.000Z", manual: false, message: "2 new postings scored." }];
    const rows = Object.entries({ agentQuery: query, agentRuns: runs, agentEnabled: true, agentHour: 9 }).map(([key, value]) => ({ key, value: settingValue(value)! }));
    expect(rows).toContainEqual({ key: "agentQuery", value: JSON.stringify(query) });
    // An install from before run times keeps its hour as its one run time.
    expect(settingsFromRows(rows)).toMatchObject({ agentQuery: query, agentRuns: runs, agentEnabled: true, agentHour: 9, agentTimes: ["09:00"] });
    expect(settingsFromRows([{ key: "agentTimes", value: '["13:00","04:00","04:00"]' }]).agentTimes).toEqual(["04:00", "13:00"]);
    expect(settingsFromRows([{ key: "agentTimes", value: '["04:10"]' }]).agentTimes).toEqual(["04:00", "08:00", "13:00"]);

    const odd = settingsFromRows([
      { key: "agentQuery", value: "{not json" },
      { key: "agentRuns", value: '[{"at":"yesterday"}]' },
      { key: "agentHour", value: "24" },
      { key: "agentMinScore", value: "101" },
      { key: "agentMaxScores", value: "0" },
      { key: "agentMaxDrafts", value: "11" },
    ]);
    expect(odd).toMatchObject({ agentQuery: { keywords: "", country: "" }, agentRuns: [], agentHour: 7, agentMinScore: 70, agentMaxScores: 15, agentMaxDrafts: 3 });
  });
});

describe("page limits (SET-9)", () => {
  it("counts the pages a resume may have", () => {
    expect([maxPages("1"), maxPages("2"), maxPages("none")]).toEqual([1, 2, null]);
    expect([pagesInWords(1), pagesInWords(2)]).toEqual(["one page", "two pages"]);
  });
});

describe("date styles", () => {
  it("offers MM/DD/YYYY, MM/DD/YY and Month Day, Year, and reads a dropped day-first style as Month Day, Year", () => {
    expect(DATE_FORMATS.map((format) => format.value)).toEqual(["US_NUMERIC", "US_SHORT", "MONTH_DAY_YEAR"]);
    expect(settingsFromRows([{ key: "dateFormat", value: "DAY_MONTH_YEAR" }]).dateFormat).toBe("MONTH_DAY_YEAR");
    expect(settingsFromRows([{ key: "dateFormat", value: "US_SHORT" }]).dateFormat).toBe("US_SHORT");
  });
});
