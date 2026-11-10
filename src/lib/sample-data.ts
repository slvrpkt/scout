import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { ApplicationStatus, DocumentKind, NoteKind } from "@/generated/prisma/enums";
import { agentDedupeKey } from "@/lib/agent/candidates";
import { dayOf } from "@/lib/calendar-view";
import { isoInZone } from "@/lib/dates";
import { EMPTY_QUERY, type FoundPosting } from "@/lib/job-search/search";

import { hasUserData, seedDemo } from "../../prisma/seed/demo";

// Sample data (Settings → Your data): a whole job search to look around in,
// loaded with one button and removed with another. On top of the demo seed
// (Jane Doe's profile and nine applications) it fills in what that leaves
// empty: tailored documents on every application, what was sent and when,
// calls, interviews and notes in their histories, the job agent's searches
// runs (three of them in the last day, with what each found) and finds,
// three drafts waiting for review, a past search in Find jobs with the two
// postings kept from it, and two startups. Which rows are sample is kept in the `sampleData` setting,
// so removing it leaves everything the user added themselves.

export const SAMPLE_SETTING = "sampleData";

/** The tables sample rows go into, by id; the profile's fields go by key. */
const TABLES = [
  "application",
  "skill",
  "language",
  "experience",
  "project",
  "education",
  "publication",
  "reference",
  "fact",
  "agentSearch",
  "agentCandidate",
  "posting",
  "startup",
  "postingSearch",
] as const;
type Table = (typeof TABLES)[number];

/** `settings`: the setting keys sample data wrote (the agent's runs and today's budget), only when they weren't there. */
type Manifest = { loadedAt: string; ids: Record<Table, string[]>; profileFields: string[]; settings?: string[] };

/** The settings sample data fills in for the Agent screen, when they're unset. */
const SAMPLE_SETTINGS = ["agentRuns", "agentUsage"] as const;

export class SampleDataError extends Error {
  override name = "SampleDataError";
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

type IdTable = { findMany(args: { select: { id: true } }): Promise<{ id: string }[]>; deleteMany(args: { where: { id: { in: string[] } } }): Promise<unknown> };
const table = (db: Prisma.TransactionClient | PrismaClient, name: Table) => db[name] as unknown as IdTable;

async function snapshot(db: PrismaClient): Promise<{ ids: Record<Table, Set<string>>; profileFields: Set<string> }> {
  const entries = await Promise.all(TABLES.map(async (name) => [name, new Set((await table(db, name).findMany({ select: { id: true } })).map((row) => row.id))] as const));
  const fields = await db.profileField.findMany({ select: { key: true } });
  return { ids: Object.fromEntries(entries) as Record<Table, Set<string>>, profileFields: new Set(fields.map((field) => field.key)) };
}

async function readManifest(db: PrismaClient): Promise<Manifest | null> {
  const row = await db.setting.findUnique({ where: { key: SAMPLE_SETTING } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as Manifest;
  } catch {
    return null;
  }
}

export type SampleDataState = { loaded: boolean; loadedAt: string | null; canLoad: boolean };

/** Whether sample data is in, and whether it can be loaded (it needs an empty profile and no applications). */
export async function sampleDataState(db: PrismaClient): Promise<SampleDataState> {
  const manifest = await readManifest(db);
  return { loaded: manifest !== null, loadedAt: manifest?.loadedAt ?? null, canLoad: manifest === null && !(await hasUserData(db)) };
}

/** Loads the sample job search; refuses when it's already in or the user has a profile or applications of their own. */
export async function loadSampleData(db: PrismaClient, now = new Date(), timeZone = "UTC"): Promise<{ applications: number }> {
  if (await readManifest(db)) throw new SampleDataError("The sample data is already loaded. Remove it first to load it fresh.");
  if (await hasUserData(db)) {
    throw new SampleDataError("Sample data needs an empty Scout: this one already has a profile or applications. Export them and use Delete everything first, or keep working with your own.");
  }
  const before = await snapshot(db);
  const existing = new Set((await db.setting.findMany({ where: { key: { in: [...SAMPLE_SETTINGS] } }, select: { key: true } })).map((row) => row.key));
  const written: string[] = [];
  const save = async () => {
    const after = await snapshot(db);
    const manifest: Manifest = {
      loadedAt: now.toISOString(),
      ids: Object.fromEntries(TABLES.map((name) => [name, [...after.ids[name]].filter((id) => !before.ids[name].has(id))])) as Record<Table, string[]>,
      profileFields: [...after.profileFields].filter((key) => !before.profileFields.has(key)),
      settings: written,
    };
    await db.setting.upsert({ where: { key: SAMPLE_SETTING }, create: { key: SAMPLE_SETTING, value: JSON.stringify(manifest) }, update: { value: JSON.stringify(manifest) } });
  };
  try {
    await seedDemo(db, { now });
    await seedExtras(db, now, timeZone);
    for (const [key, value] of Object.entries(await sampleRuns(db, now, timeZone))) {
      if (existing.has(key)) continue;
      await db.setting.create({ data: { key, value: JSON.stringify(value) } });
      written.push(key);
    }
  } catch (error) {
    // Whatever got in goes again, so a failed load leaves nothing half there.
    await save();
    await removeSampleData(db);
    throw error;
  }
  await save();
  return { applications: (await readManifest(db))!.ids.application.length };
}

/** The sample applications' ids, so nothing of them goes to Google Drive; empty without sample data. */
export async function sampleApplicationIds(db: PrismaClient): Promise<Set<string>> {
  return new Set((await readManifest(db))?.ids.application ?? []);
}

/** Removes the sample rows (and what hangs off them: documents, history, notes) and nothing else. */
export async function removeSampleData(db: PrismaClient): Promise<{ applications: number }> {
  const manifest = await readManifest(db);
  if (!manifest) return { applications: 0 };
  await db.$transaction(async (tx) => {
    // Candidates, postings and startups first: they point at applications.
    for (const name of ["agentCandidate", "posting", "postingSearch", "startup", "application", "agentSearch", "fact", "experience", "project", "skill", "language", "education", "publication", "reference"] as const) {
      const ids = manifest.ids[name] ?? [];
      if (ids.length > 0) await table(tx, name).deleteMany({ where: { id: { in: ids } } });
    }
    if (manifest.profileFields.length > 0) await tx.profileField.deleteMany({ where: { key: { in: manifest.profileFields } } });
    if (manifest.settings?.length) await tx.setting.deleteMany({ where: { key: { in: manifest.settings } } });
    await tx.setting.delete({ where: { key: SAMPLE_SETTING } });
  });
  return { applications: manifest.ids.application?.length ?? 0 };
}

/** What happened on each sample application after it was sent, days after sending (negative: hours before now). */
const HISTORY: Record<string, { kind: NoteKind; after: number; body: string }[]> = {
  "Oaken Studio": [
    { kind: NoteKind.EMAIL, after: 3, body: "Recruiter (Priya) replied: they'd like a portfolio walkthrough." },
    { kind: NoteKind.CALL, after: 6, body: "Phone screen with Priya, 30 min.\n- Team of 6 designers, reporting to the Head of Design\n- They're rebuilding the component library this year\n- Next: portfolio review with the design leads" },
    { kind: NoteKind.INTERVIEW, after: 14, body: "Portfolio review with Marco and Ana.\n- Went well; lots of questions on the token migration at Northwind\n- Asked how I handle pushback from engineering" },
    { kind: NoteKind.INTERVIEW, after: 24, body: "Final round: system design exercise + culture chat with the VP." },
    { kind: NoteKind.UPDATE, after: 37, body: "Offer received by email.\n- Base €86k, 10% bonus, 28 days holiday\n- Decision needed by Friday" },
  ],
  "Northstar Health": [
    { kind: NoteKind.CALL, after: 5, body: "Intro call with the hiring manager (Dr. Lewis). Patient-facing app, very regulated." },
    { kind: NoteKind.INTERVIEW, after: 15, body: "Case study presentation.\n- Presented the Fieldnote onboarding redesign\n- They want examples of accessibility work" },
    { kind: NoteKind.NOTE, after: 20, body: "Prepare: WCAG audit story, metrics from the Northwind portal." },
  ],
  "Tidewater Energy": [{ kind: NoteKind.EMAIL, after: 6, body: "Screening questionnaire received; sent it back the same day." }],
  "Kestrel Maps": [{ kind: NoteKind.NOTE, after: 2, body: "Followed the company page on LinkedIn. Follow up next week if nothing comes back." }],
  Parcelhub: [
    { kind: NoteKind.CALL, after: 8, body: "Recruiter screen. Salary range is lower than hoped." },
    { kind: NoteKind.UPDATE, after: 28, body: "Rejection email: they went with an internal candidate. Asked to keep in touch." },
  ],
  "Quill & Co": [{ kind: NoteKind.UPDATE, after: 45, body: "Declined their offer: accepted a better fit elsewhere. Thanked the team." }],
};

const query = (keywords: string, place = "", extra: Partial<typeof EMPTY_QUERY> = {}) => ({ ...EMPTY_QUERY, keywords, place, country: "nl", ...extra });

/** Agent finds: a title, company, place, score and why, and the run that found them (0 the latest, this morning). */
const FINDS = [
  { run: 0, title: "Senior Product Designer", company: "Harbor Labs", place: "Rotterdam", score: 91, reasons: ["Design systems at the core of the role", "B2B logistics, like Northwind"], redFlags: [], status: "DRAFTED" },
  { run: 0, title: "Lead UX Designer", company: "Cobalt Insurance", place: "Amsterdam", score: 86, reasons: ["Leads a team of 4", "Research-heavy, matches Fieldnote work"], redFlags: ["Four days in the office"], status: "DRAFTED" },
  { run: 0, title: "Product Designer, Platform", company: "Lumen Cloud", place: "Remote (EU)", score: 78, reasons: ["Figma and tokens", "Remote within the EU"], redFlags: ["Early-stage; salary not listed"], status: "SCORED" },
  { run: 0, title: "Design Systems Designer", company: "Vela Retail", place: "Utrecht", score: 73, reasons: ["Owns the component library"], redFlags: ["More visual than product work"], status: "SCORED" },
  { run: 0, title: "UX Designer, Payments", company: "Kiwi Pay", place: "Amsterdam", score: 69, reasons: ["Fintech onboarding, like Meridian"], redFlags: ["Contract until June"], status: "SCORED" },
  { run: 0, title: "Interaction Designer", company: "Ferro Rail", place: "Utrecht", score: 58, reasons: ["Transport domain"], redFlags: ["Mostly kiosk interfaces", "Contract role"], status: "DISMISSED" },
  { run: 1, title: "Senior Product Designer, Growth", company: "Tulip Travel", place: "Remote (EU)", score: 88, reasons: ["Experiments and onboarding", "Fully remote"], redFlags: [], status: "DRAFTED" },
  { run: 1, title: "Service Designer", company: "Gemeente Utrecht", place: "Utrecht", score: 71, reasons: ["Service design across channels"], redFlags: ["Dutch required at C1"], status: "SCORED" },
  { run: 1, title: "Product Designer", company: "Bricks & Co", place: "The Hague", score: 66, reasons: ["Small team, broad role"], redFlags: ["Junior-level pay"], status: "SCORED" },
  { run: 1, title: "Visual Designer", company: "Studio Neon", place: "Amsterdam", score: 41, reasons: [], redFlags: ["Brand and marketing, not product"], status: "DISMISSED" },
  { run: 2, title: "Lead Product Designer", company: "Quantum Grid", place: "Rotterdam", score: 82, reasons: ["Energy, like Tidewater", "Leads the design team"], redFlags: ["Hybrid, 3 days on site"], status: "SCORED" },
  { run: 2, title: "Design Ops Lead", company: "Orbit Health", place: "Remote (EU)", score: 64, reasons: ["Design systems and process"], redFlags: ["Less hands-on design"], status: "SCORED" },
  { run: 2, title: "UX Researcher", company: "Delta Learning", place: "Amsterdam", score: 55, reasons: ["Research skills"], redFlags: ["Research only, no design"], status: "SCORED" },
  { run: 2, title: "Product Designer", company: "Hops & Barley", place: "Eindhoven", score: 52, reasons: [], redFlags: ["Far from Rotterdam", "Salary below range"], status: "SCORED" },
] as const;

/** When the three sample runs were: this morning at 04:00, yesterday at 13:00 and at 08:00, in the user's time zone. */
function runTimes(now: Date, timeZone: string): Date[] {
  // Today's date and the zone's offset now ("+01:00"), so 04:00 is its wall clock.
  const [date, offset] = [dayOf(now, timeZone), isoInZone(now, timeZone).slice(19)];
  const at = (days: number, hour: number) => new Date(Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00${offset}`) - days * DAY);
  return [at(0, 4), at(1, 13), at(1, 8)].map((time) => (time.getTime() > now.getTime() ? new Date(time.getTime() - DAY) : time));
}

/** The agent's run log and today's budget, as three scheduled runs would have left them. */
async function sampleRuns(db: PrismaClient, now: Date, timeZone: string): Promise<Record<(typeof SAMPLE_SETTINGS)[number], unknown>> {
  const times = runTimes(now, timeZone);
  const found = [23, 17, 14];
  const runs = times.map((at, run) => {
    const finds = FINDS.filter((find) => find.run === run);
    const drafts = finds.filter((find) => find.status === "DRAFTED").length;
    return {
      at: at.toISOString(),
      manual: false,
      message: `${found[run]} postings found across 5 searches, ${finds.length} new. Scored ${finds.length}${drafts ? `; ${drafts} ${drafts === 1 ? "draft is" : "drafts are"} waiting for your review` : ""}.`,
    };
  });
  const today = dayOf(now, timeZone);
  const todays = FINDS.filter((find) => dayOf(times[find.run], timeZone) === today);
  await db.agentSearch.updateMany({ data: { lastRunAt: times[0] } });
  return { agentRuns: runs, agentUsage: { day: today, scored: todays.length, drafted: todays.filter((find) => find.status === "DRAFTED").length } };
}

/** Find jobs: a past search and what it found, two of them kept. */
const SEARCH_RESULTS = [
  { title: "Senior UX Designer", company: "Noord Mobility", place: "Amsterdam", salary: "€65,000 – €80,000", kept: true },
  { title: "Product Designer", company: "Greenhouse Foods", place: "Rotterdam", salary: "", kept: true },
  { title: "Senior Product Designer", company: "Harbor Labs", place: "Rotterdam", salary: "€70,000 – €90,000", kept: false },
  { title: "Product Designer, Checkout", company: "Basket", place: "Rotterdam", salary: "€55,000 – €68,000", kept: false },
  { title: "UX/UI Designer", company: "Port of Rotterdam", place: "Rotterdam", salary: "", kept: false },
  { title: "Product Designer", company: "Coolblue", place: "Rotterdam", salary: "", kept: false },
  { title: "Senior Interaction Designer", company: "Erasmus MC", place: "Rotterdam", salary: "€5,000 – €6,800 a month", kept: false },
  { title: "Design Lead", company: "Swapfiets", place: "Amsterdam", salary: "", kept: false },
];

/** What the demo seed leaves empty, so every screen has something to show. */
async function seedExtras(db: PrismaClient, now: Date, timeZone: string): Promise<void> {
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const applications = await db.application.findMany({ include: { documents: true, events: { orderBy: { at: "asc" } } } });
  const template = applications.find((application) => application.documents.length > 0);
  if (!template) throw new SampleDataError("The sample applications have no documents to copy.");
  const resume = template.documents.find((document) => document.kind === DocumentKind.RESUME)!;
  const letter = template.documents.find((document) => document.kind === DocumentKind.COVER_LETTER)!;
  const letterFor = (company: string) =>
    (letter.units as { id: string; label: string; text: string }[]).map((unit) => ({ ...unit, text: unit.text.replaceAll(template.company, company) })) as Prisma.InputJsonValue;
  const documentsFor = (company: string) => [
    { kind: DocumentKind.RESUME, units: resume.units as Prisma.InputJsonValue, themeId: resume.themeId },
    { kind: DocumentKind.COVER_LETTER, units: letterFor(company), themeId: letter.themeId },
  ];

  for (const application of applications) {
    // Tailored documents on every application, as if each had been drafted.
    if (application.documents.length === 0) {
      await db.document.createMany({ data: documentsFor(application.company).map((document) => ({ ...document, applicationId: application.id })) });
    }
    // What was sent, kept with the status change that sent it.
    const sending = application.events.find((event) => event.previousSentAt === null && event.to !== ApplicationStatus.DRAFT && event.to !== ApplicationStatus.DECLINED);
    if (sending) {
      await db.sentDocument.createMany({
        data: documentsFor(application.company).map((document) => ({ ...document, applicationId: application.id, eventId: sending.id, sentAt: sending.at })),
      });
    }
    // Calls, interviews and notes, at the time they happened.
    for (const entry of HISTORY[application.company] ?? []) {
      if (!application.sentAt) continue;
      const at = new Date(Math.min(application.sentAt.getTime() + entry.after * DAY + 10 * HOUR, now.getTime() - HOUR));
      await db.note.create({ data: { applicationId: application.id, kind: entry.kind, body: entry.body, at, createdAt: at, updatedAt: at } });
    }
    // A second send, by hand: the portfolio link to the recruiter.
    if (application.company === "Oaken Studio" && application.sentAt) {
      const at = new Date(application.sentAt.getTime() + 4 * DAY + 15 * HOUR);
      await db.sentDocument.createMany({ data: documentsFor(application.company).map((document) => ({ ...document, applicationId: application.id, sentAt: at })) });
      await db.note.create({ data: { applicationId: application.id, kind: NoteKind.UPDATE, body: "Sent to Priya (recruiter) by email, with the portfolio link", at, createdAt: at, updatedAt: at } });
    }
  }

  // The job agent: five saved searches and what they found.
  const searches = await Promise.all(
    [
      query("product designer", "Rotterdam"),
      query("ux designer", "Amsterdam"),
      query("design systems", "", { remoteOnly: true }),
      query("service designer", "Utrecht"),
      query("lead product designer", "", { remoteOnly: true }),
    ].map((search, position) =>
      db.agentSearch.create({
        data: { name: search.keywords, query: search, position, maxPages: 5, lastRunAt: ago(0.2), lastMessage: `${[6, 4, 3, 2, 1][position]} postings found, ${[2, 1, 1, 1, 0][position]} new.` },
      }),
    ),
  );
  const times = runTimes(now, timeZone);
  for (const [index, find] of FINDS.entries()) {
    const foundAt = new Date(times[find.run].getTime() + index * 60_000);
    const url = `https://example.com/jobs/sample-${index + 1}`;
    const posting = { source: "FREEHIRE" as const, externalId: `sample-${index + 1}`, url, title: find.title, company: find.company, place: find.place };
    const draft =
      find.status === "DRAFTED"
        ? await db.application.create({
            data: {
              origin: "AGENT",
              agentScore: find.score,
              awaitingReview: true,
              title: `${find.title} · ${find.company}`,
              company: find.company,
              role: find.title,
              location: find.place,
              postingUrl: url,
              postingText: `${find.company} is hiring a ${find.title} in ${find.place}. You'll own our design system and work with product and engineering on B2B tools.`,
              language: "English",
              createdAt: foundAt,
              documents: { create: documentsFor(find.company) },
            },
          })
        : null;
    await db.agentCandidate.create({
      data: {
        ...posting,
        remote: find.place.startsWith("Remote"),
        salary: find.score >= 75 ? "€70k – €90k" : "",
        postedAt: ago(index + 1),
        via: "FreeHire",
        description: `${find.company} is looking for a ${find.title}.`,
        complete: true,
        score: find.score,
        reasons: [...find.reasons],
        redFlags: [...find.redFlags],
        status: find.status,
        applicationId: draft?.id ?? null,
        dedupeKey: agentDedupeKey(posting),
        searchId: searches[index % searches.length].id,
        createdAt: foundAt,
      },
    });
  }

  // Find jobs: yesterday's search for product designers in Rotterdam, two of its postings kept.
  const results: FoundPosting[] = SEARCH_RESULTS.map((result, index) => ({
    source: "FREEHIRE",
    externalId: `sample-search-${index + 1}`,
    title: result.title,
    company: result.company,
    place: result.place,
    remote: false,
    salary: result.salary,
    postedAt: ago(index + 1).toISOString(),
    url: `https://example.com/jobs/sample-search-${index + 1}`,
    via: index % 3 === 0 ? "LinkedIn" : "",
    description: `${result.company} is hiring a ${result.title} in ${result.place}.`,
    complete: true,
  }));
  await db.postingSearch.create({
    data: { source: "FREEHIRE", query: query("product designer", "Rotterdam"), postings: results as unknown as Prisma.InputJsonValue, found: results.length, next: null, createdAt: ago(1), updatedAt: ago(1) },
  });
  for (const [index, result] of SEARCH_RESULTS.entries()) {
    if (!result.kept) continue;
    const { postedAt, ...posting } = results[index];
    await db.posting.create({ data: { ...posting, postedAt: postedAt ? new Date(postedAt) : null, savedAt: ago(0.9) } });
  }

  // Startups: one new, one already contacted.
  for (const [index, startup] of [
    { company: "Tessellate", summary: "Design tooling for hardware teams", location: "Delft", status: "NEW" as const, score: 82 },
    { company: "Pollen Health", summary: "Remote care for chronic conditions", location: "Remote", status: "CONTACTED" as const, score: 74 },
  ].entries()) {
    await db.startup.create({
      data: {
        source: "YC",
        externalId: `sample-${index + 1}`,
        company: startup.company,
        website: `https://example.com/${startup.company.toLowerCase().replace(/\s+/g, "-")}`,
        summary: startup.summary,
        location: startup.location,
        remote: startup.location === "Remote",
        stage: "Seed",
        roles: ["Founding Product Designer"],
        emails: [{ email: `hello@${startup.company.toLowerCase().replace(/\s+/g, "")}.example.com`, label: "Founders", from: "" }],
        links: [{ label: "Website", url: `https://example.com/${startup.company.toLowerCase()}` }],
        postedAt: ago(index + 3),
        score: startup.score,
        reasons: ["Early design hire", "Product and systems work"],
        status: startup.status,
        notes: startup.status === "CONTACTED" ? "Emailed the founders on Monday." : "",
      },
    });
  }
}
