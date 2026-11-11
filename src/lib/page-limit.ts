import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { DocumentKind, VersionCause } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { isAiUsable } from "@/lib/ai/config";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { condenseBullets, irrelevantExtras, tailorResume } from "@/lib/ai/tasks";
import { extractedOf, matchSchema, trimmedSchema, unitsSchema, type Trimmed, type Unit } from "@/lib/application-data";
import { updateDocuments } from "@/lib/document-units";
import { saveVersion } from "@/lib/document-versions";
import { logServerError } from "@/lib/log";
import { countPdfPages } from "@/lib/pdf/pages";
import { renderPdf } from "@/lib/pdf/render";
import { prisma } from "@/lib/prisma";
import type { ProfileData } from "@/lib/profile";
import { loadFactTexts } from "@/lib/profile-data";
import { afterSteps, bulletsAt, byRecency, chooseTrims, fewestTrims, recentCount, trimSteps, wholeRecentTrims, type ThirdPage } from "@/lib/resume-fit";
import { skillNamesIn } from "@/lib/skill-groups";
import { resumeCertifications } from "@/lib/profile";
import { pagesInWords } from "@/lib/settings";
import { bulletLines, isPublicationUnit } from "@/lib/unit-text";
import { citationExcerpt } from "@/lib/citation";
import { withCurrentIds } from "@/lib/unit-ids";
import { carryHeadings } from "@/lib/resume-heading";

// "Resume length" (E10-10, SET-9): a new tailored resume that runs over its
// page limit is fitted once, when the application is created, with the
// two-page rule (resume-fit.ts): one bullet at a time off the older roles
// from the oldest, then the oldest projects and the last publications, then
// the 3rd, 2nd and 1st most recent roles. A role that's trimmed is rewritten
// to its new length by the AI, keeping its facts (condense-bullets); points
// are never simply cut off, so without a rewrite (or an AI model) a role keeps
// its points, and an older one can still go to its title line. Measured in the real PDF, the fewest trims that
// fit are found by halving. What changed is kept on the document, so it can
// be put back.

/** One role's bullets rewritten to each length asked for; what came back right. */
export type Condenser = (input: { role: string; company: string; bullets: string[]; counts: number[] }) => Promise<Record<number, string[]>>;

const lines = (text: string) => bulletLines(text).split("\n").filter(Boolean);

/** The units of a role or project, oldest first, with where they are. */
function oldestFirst(units: Unit[], entries: { id: string; startYear: number | null; startMonth: number | null }[], prefix: string) {
  const start = new Map(entries.map((entry) => [`${prefix}${entry.id}`, (entry.startYear ?? 0) * 12 + (entry.startMonth ?? 1)]));
  return units
    .map((unit, index) => ({ unit, index }))
    .filter(({ unit }) => start.has(unit.id))
    .sort((a, b) => start.get(a.unit.id)! - start.get(b.unit.id)!);
}

/** The AI model's condense-bullets for this application's posting, or null without an AI model (then roles keep their points). */
async function loadCondenser(applicationId: string): Promise<Condenser | null> {
  if (!(await isAiUsable())) return null;
  const [provider, options, application] = await Promise.all([
    getAiProvider(),
    loadTaskOptions(),
    prisma.application.findUnique({ where: { id: applicationId }, select: { postingText: true } }),
  ]);
  return async (input) => (await condenseBullets(provider, { ...input, posting: application?.postingText || undefined }, options)).data;
}

/** Of a resume's certifications and tools, those with no bearing on the job, as `hide` entries; the fit's last resort. */
export type ExtrasJudge = (input: { certifications: { id: string; name: string }[]; tools: string[] }) => Promise<string[]>;

/** The AI model's judge of what's irrelevant to this application's posting, or null without an AI model (then nothing is hidden). */
async function loadJudge(applicationId: string): Promise<ExtrasJudge | null> {
  if (!(await isAiUsable())) return null;
  const [provider, options, application] = await Promise.all([
    getAiProvider(),
    loadTaskOptions(),
    prisma.application.findUnique({ where: { id: applicationId }, select: { postingText: true } }),
  ]);
  if (!application?.postingText.trim()) return null;
  return async (input) => {
    const { data } = await irrelevantExtras(provider, { target: { posting: application.postingText }, ...input }, options);
    return [...data.certifications.map((id) => `certification:${id}`), ...data.tools.map((name) => `tool:${name.toLowerCase()}`)];
  };
}

/** The trims for these units: roles most recent first with their bullets now, and every trim in order. */
export function resumeTrims(units: Unit[], profile: ProfileData) {
  const roles = profile.experience.flatMap((entry) => {
    const unit = units.find((item) => item.id === `experience:${entry.id}`);
    return unit ? [{ ...entry, unit, bullets: lines(unit.text).length }] : [];
  });
  const counts = new Map(roles.map((role) => [role.id, role.bullets]));
  const projects = oldestFirst(units, profile.projects, "project:").map(({ unit }) => unit.id);
  const publications = units.filter((unit) => isPublicationUnit(unit.id)).map((unit) => unit.id).toReversed();
  return { roles, counts, steps: trimSteps(byRecency(roles), counts, [...projects, ...publications], recentCount(roles)) };
}

/**
 * Fits the application's tailored resume to `maxPages`. Returns what was
 * summarized, cut or left out, and whether it fits now. Older roles, projects
 * and publications first; then the last resorts, before any recent role is
 * shortened: the skills line under each role, then the certifications and
 * tools with no bearing on the job. At two pages, `thirdPage` says what to
 * do when two would shorten the recent jobs: "ask" leaves the resume as it
 * is and returns `ask: true`.
 */
export async function fitResumeToPages(
  applicationId: string,
  profile: ProfileData,
  maxPages: number,
  pages: (path: string) => Promise<number> = async (path) => countPdfPages(await renderPdf(path)),
  condenser?: Condenser | null,
  thirdPage: ThirdPage = "deny",
  judge?: ExtrasJudge | null,
): Promise<{ trimmed: Trimmed; fits: boolean; ask?: boolean }> {
  const skillsLines = (shown: boolean) => prisma.application.updateMany({ where: { id: applicationId }, data: { resumeNoSkills: !shown } });
  const hidden = (hide: string[]) => prisma.application.updateMany({ where: { id: applicationId }, data: { resumeHide: hide } });
  await skillsLines(true);
  await hidden([]);
  const fits = async () => (await pages(`/print/resume/${applicationId}`)) <= maxPages;
  if (await fits()) return { trimmed: [], fits: true };

  const document = await prisma.document.findUnique({ where: { applicationId_kind: { applicationId, kind: DocumentKind.RESUME } } });
  const parsed = unitsSchema.safeParse(document?.units);
  if (!parsed.success) return { trimmed: [], fits: false };
  // Matched to the profile by label where a job, project or degree has a new id (unit-ids.ts).
  const original = withCurrentIds(parsed.data, profile);
  const { roles, counts, steps } = resumeTrims(original, profile);
  if (steps.length === 0) {
    await skillsLines(false);
    return { trimmed: [], fits: await fits() };
  }

  const condense = condenser === undefined ? await loadCondenser(applicationId) : condenser;
  // Each role's rewrites, asked for once, for every length its trims reach.
  const versions = new Map<string, Record<number, string[]>>();
  const floor = afterSteps(counts, steps, steps.length).counts;
  const versionsFor = async (role: (typeof roles)[number]) => {
    if (versions.has(role.id)) return versions.get(role.id)!;
    let made: Record<number, string[]> = {};
    if (condense) {
      const wanted = Array.from({ length: role.bullets - (floor.get(role.id) ?? role.bullets) }, (_, index) => role.bullets - 1 - index).filter((count) => count > 0);
      try {
        made = await condense({ role: role.role, company: role.company, bullets: lines(role.unit.text), counts: wanted });
      } catch (error) {
        logServerError("summarizing a role to fit", error);
      }
    }
    versions.set(role.id, made);
    return made;
  };

  /** The units after the first `taken` trims, and how each role came out. */
  const unitsAt = async (taken: number) => {
    const after = afterSteps(counts, steps, taken);
    const shown = new Map<string, ReturnType<typeof bulletsAt>>();
    for (const role of roles) {
      const count = after.counts.get(role.id)!;
      if (count >= role.bullets) continue;
      shown.set(role.id, bulletsAt(lines(role.unit.text), count, await versionsFor(role)));
    }
    const units = original
      .filter((unit) => !after.leftOut.has(unit.id))
      .map((unit) => {
        const role = shown.get(unit.id.replace(/^experience:/, ""));
        return role && unit.id.startsWith("experience:") ? { ...unit, text: role.bullets.join("\n") } : unit;
      });
    return { units, after, shown };
  };
  const write = async (units: Unit[]) =>
    updateDocuments(applicationId, async (documents) => {
      documents[DocumentKind.RESUME] = units;
    });

  const pagesNow = async () => pages(`/print/resume/${applicationId}`);
  const fitsWith = async (trims: number, limit: number) => {
    await write((await unitsAt(trims)).units);
    return (await pagesNow()) <= limit;
  };
  // The recent roles stay whole while the last resorts go, at any page limit:
  // the skills line under each role, then the certifications and tools with no bearing on the job.
  const whole = wholeRecentTrims(steps, byRecency(roles), recentCount(roles));
  const keepingRecent = async () => ({ ...(await fewestTrims(whole, (trims) => fitsWith(trims, maxPages))), pages: maxPages, ask: false });
  let choice = await keepingRecent();
  if (!choice.fits) {
    await skillsLines(false);
    choice = await keepingRecent();
  }
  if (!choice.fits) {
    const extras = judge === undefined ? await loadJudge(applicationId) : judge;
    const tools = original.find((unit) => unit.id === "tools")?.text ?? "";
    const certifications = resumeCertifications(profile.certifications).map((entry) => ({ id: entry.id, name: entry.name.trim() }));
    const hide = extras ? await extras({ certifications, tools: skillNamesIn(tools) }).catch((error: unknown) => (logServerError("judging certifications and tools to fit", error), [])) : [];
    if (hide.length > 0) {
      await hidden(hide);
      choice = await keepingRecent();
    }
  }
  // Only then the recent roles, never below 2 points each.
  if (!choice.fits) choice = await chooseTrims(steps.length, whole, maxPages, thirdPage, fitsWith);
  // Two pages would shorten the 3 most recent jobs: the resume stays as it is until the user says whether a third page may be used.
  if (choice.ask) {
    await write(original);
    await skillsLines(true);
    await hidden([]);
    return { trimmed: [], fits: false, ask: true };
  }
  const { taken, fits: fitted } = choice;
  const final = await unitsAt(taken);
  await write(final.units);

  const trimmed: Trimmed = [];
  for (const role of roles) {
    const result = final.shown.get(role.id);
    if (!result) continue;
    if (result.how === "summarized") {
      trimmed.push({ kind: "summarized", unitId: role.unit.id, label: role.unit.label, original: role.unit.text, count: result.bullets.length });
    } else if (result.how === "title-only") {
      trimmed.push({ kind: "bullets", unitId: role.unit.id, label: role.unit.label, lines: lines(role.unit.text) });
    }
  }
  original.forEach((unit, index) => {
    if (final.after.leftOut.has(unit.id)) trimmed.push({ kind: "unit", unit, index });
  });
  await prisma.document.updateMany({ where: { applicationId, kind: DocumentKind.RESUME }, data: { trimmed: trimmed.length > 0 ? trimmedSchema.parse(trimmed) : Prisma.DbNull } });
  return saveTrimmed(applicationId, trimmed, fitted);
}

/**
 * Writes this application's resume again for `maxPages`, in today's words and
 * layout. What it was stays in its history. Returns why a third page would be
 * worth it, when the AI says so.
 */
export async function rewriteResume(
  applicationId: string,
  profile: ProfileData,
  { maxPages, detail, before, focus, signal }: { maxPages: number | null; detail: string; before: string; focus?: readonly string[]; signal?: AbortSignal },
): Promise<string | null> {
  const application = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
  const [provider, options, facts] = await Promise.all([getAiProvider(), loadTaskOptions(), loadFactTexts(applicationId)]);
  const match = matchSchema.safeParse(application.match);
  const { data, promptVersion, thirdPageReason, suggestions } = await tailorResume(
    provider,
    { profile, extracted: extractedOf(application), match: match.success ? match.data : null, facts, posting: application.postingText, focus },
    { ...options, language: application.language || options.language, maxPages, signal },
  );
  await updateDocuments(
    applicationId,
    async (documents, tx) => {
      const resume = await tx.document.findUnique({ where: { applicationId_kind: { applicationId, kind: DocumentKind.RESUME } } });
      if (!resume) return;
      await saveVersion(tx, resume.id, documents[DocumentKind.RESUME] ?? [], { cause: VersionCause.BEFORE_RESTORE, detail: before });
      // The titles, companies and place you changed for this resume stay.
      documents[DocumentKind.RESUME] = carryHeadings(documents[DocumentKind.RESUME] ?? [], data);
      await tx.application.update({ where: { id: applicationId }, data: { resumeSuggestions: suggestions, resumeWrittenAt: new Date() } });
    },
    { version: { cause: VersionCause.REGENERATED, detail } },
  );
  await prisma.document.updateMany({ where: { applicationId, kind: DocumentKind.RESUME }, data: { trimmed: Prisma.DbNull, writtenWith: promptVersion } });
  return thirdPageReason;
}

/** The answer to "a third page?": this resume again with room for three, fitted. Only this resume: Settings stay. Returns whether it fits. */
export async function rewriteForThreePages(applicationId: string, profile: ProfileData): Promise<boolean> {
  await rewriteResume(applicationId, profile, { maxPages: 3, detail: "the resume for up to three pages", before: "As it was before the three-page rewrite" });
  return (await fitResumeToPages(applicationId, profile, 3, undefined, undefined, "allow")).fits;
}

/** Once trimming is done, the resume as it is now becomes a version (E8-10), so the untrimmed draft stays one click away. */
async function saveTrimmed(applicationId: string, trimmed: Trimmed, fits: boolean): Promise<{ trimmed: Trimmed; fits: boolean }> {
  if (trimmed.length > 0) {
    await prisma.$transaction(async (tx) => {
      const resume = await tx.document.findUnique({ where: { applicationId_kind: { applicationId, kind: DocumentKind.RESUME } } });
      if (resume) await saveVersion(tx, resume.id, unitsSchema.parse(resume.units), { cause: VersionCause.TRIMMED });
    });
  }
  return { trimmed, fits };
}

/** The opening message's lines about what was trimmed (E10-10): "Summarized the Studio Brik role into 2 bullets, keeping its facts, to fit two pages". */
export function describeTrim(trimmed: Trimmed, profile: ProfileData, fits: boolean, maxPages: number): string[] {
  const limit = pagesInWords(maxPages);
  const lines = trimmed.map((cut) => {
    if (cut.kind === "summarized") return `Summarized the ${cut.label} into ${cut.count} ${cut.count === 1 ? "bullet" : "bullets"}, keeping its facts, to fit ${limit}`;
    if (cut.kind === "bullets") {
      const count = cut.lines.length;
      return `Shortened the ${cut.label} by ${count} ${count === 1 ? "bullet" : "bullets"} to fit ${limit}`;
    }
    const project = profile.projects.find((entry) => `project:${entry.id}` === cut.unit.id);
    if (project) return `Left out the ${project.name.trim() || "untitled"} project to fit ${limit}`;
    if (isPublicationUnit(cut.unit.id)) return `Left out the publication “${citationExcerpt(cut.unit.text)}” to fit ${limit}`;
    const entry = profile.experience.find((role) => `experience:${role.id}` === cut.unit.id);
    const name = entry?.company.trim() || entry?.role.trim() || cut.unit.label;
    const years = entry?.startYear ? ` (${entry.startYear}–${entry.current ? "now" : (entry.endYear ?? "")})` : "";
    return `Left out ${name}${years} to fit ${limit}`;
  });
  if (!fits && trimmed.length > 0) lines.push(`It still runs over ${limit}, so shorten it by hand if it has to fit`);
  return lines;
}
