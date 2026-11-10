import "server-only";

import { createHash } from "node:crypto";

import { getAiProvider } from "@/lib/ai";
import { isAiUsable } from "@/lib/ai/config";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { BASE_COMPACT_VERSION, compactBase, irrelevantExtras } from "@/lib/ai/tasks";
import { BASE_LENGTH_PAGES, versionAt, versionBullets, versionPlan, writeMissingSummaries } from "@/lib/base-resume";
import { logServerError } from "@/lib/log";
import { countDocxPages } from "@/lib/docx/pages";
import { resumeDocx } from "@/lib/docx/render";
import { countPdfPages } from "@/lib/pdf/pages";
import { renderPdf } from "@/lib/pdf/render";
import { loadProfile } from "@/lib/profile-data";
import { fewestTrims, wholeRecentTrims } from "@/lib/resume-fit";
import { isSkill, resumeCertifications } from "@/lib/profile";
import { BASE_LENGTHS, type BaseLength } from "@/lib/settings";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { loadTheme } from "@/lib/theme-data";
import { BUILT_IN_THEMES, RESUME_POINTS } from "@/lib/themes";

/** The length a download asks for, else the one chosen on the Base resume page. */
export async function baseLengthOf(asked: string | null): Promise<BaseLength> {
  return BASE_LENGTHS.find((length) => length === asked) ?? (await loadSettings()).baseLength;
}

/**
 * The base resume's certifications and tools with no bearing on your usual
 * title, as `hide` entries: asked of the AI once, and again only when the
 * title, the certifications or the tools change. Empty without an AI model.
 */
export async function baseIrrelevant(): Promise<string[]> {
  const [profile, settings] = await Promise.all([loadProfile(), loadSettings()]);
  const certifications = resumeCertifications(profile.certifications).map((entry) => ({ id: entry.id, name: entry.name.trim() }));
  const tools = (profile.skills ?? []).filter((item) => !isSkill(item)).map((item) => item.name);
  const title = profile.basics?.headline.trim() ?? "";
  const from = createHash("sha256").update(JSON.stringify([title, certifications, tools])).digest("hex");
  if (settings.baseIrrelevant?.from === from) return settings.baseIrrelevant.hide;
  if (!(await isAiUsable())) return [];
  try {
    const [provider, options] = await Promise.all([getAiProvider(), loadTaskOptions()]);
    const { data } = await irrelevantExtras(provider, { target: { title }, certifications, tools }, options);
    const hide = [...data.certifications.map((id) => `certification:${id}`), ...data.tools.map((name) => `tool:${name.toLowerCase()}`)];
    await saveSettings({ baseIrrelevant: { from, hide } });
    return hide;
  } catch (error) {
    logServerError("judging the base resume's certifications and tools", error);
    return [];
  }
}

/**
 * The two-page base resume's bottom third: the skills, tools and
 * certifications it leaves out, as `hide` entries, so Skills, Tools &
 * Platforms, Education and Certifications take about a third of page two and
 * the jobs get the room. Chosen by the AI for your usual title once, and
 * again only when the title, skills, tools or certifications change.
 */
export async function baseCompactHide(): Promise<string[]> {
  const [profile, settings] = await Promise.all([loadProfile(), loadSettings()]);
  const certifications = resumeCertifications(profile.certifications).map((entry) => ({ id: entry.id, name: entry.name.trim() }));
  const all = profile.skills ?? [];
  const skills = all.filter((item) => isSkill(item)).map((item) => item.name);
  const tools = all.filter((item) => !isSkill(item)).map((item) => item.name);
  const title = profile.basics?.headline.trim() ?? "";
  const from = createHash("sha256").update(JSON.stringify([BASE_COMPACT_VERSION, title, skills, tools, certifications])).digest("hex");
  if (settings.baseCompact?.from === from) return settings.baseCompact.hide;
  if (!(await isAiUsable())) return [];
  try {
    const [provider, options] = await Promise.all([getAiProvider(), loadTaskOptions()]);
    const { data } = await compactBase(provider, { title, skills, tools, certifications }, options);
    const keep = new Set([...data.skills, ...data.tools].map((name) => name.toLowerCase()));
    const hide = [
      ...skills.filter((name) => !keep.has(name.toLowerCase())).map((name) => `skill:${name.toLowerCase()}`),
      ...tools.filter((name) => !keep.has(name.toLowerCase())).map((name) => `tool:${name.toLowerCase()}`),
      ...certifications.filter((entry) => !data.certifications.includes(entry.id)).map((entry) => `certification:${entry.id}`),
    ];
    await saveSettings({ baseCompact: { from, hide } });
    return hide;
  } catch (error) {
    logServerError("choosing the two-page resume's skills, tools and certifications", error);
    return [];
  }
}

/**
 * The base resume at `length` as a Word file, with the first `taken` trims,
 * the skills lines off or on, and what's hidden: the two-page bottom third,
 * plus `hide`. The same content the PDF prints with the same choices.
 */
export async function baseResumeDocx(length: BaseLength, taken: number, noSkills: boolean, hide: readonly string[] = []): Promise<Uint8Array> {
  const [profile, settings] = await Promise.all([loadProfile(), loadSettings()]);
  const theme = (await loadTheme(settings.baseThemeId)) ?? BUILT_IN_THEMES[0];
  const compact = length === "2" ? (settings.baseCompact?.hide ?? []) : [];
  return resumeDocx({
    theme: { ...theme, textPoints: RESUME_POINTS, noRoleSkills: noSkills, hide: [...compact, ...hide] },
    profile,
    template: settings.resumeTemplate,
    paper: settings.paper,
    includeReferences: settings.includeRefs,
    baseSummary: settings.baseSummary,
    language: settings.resumeLanguage,
    condense: versionAt(profile, length, settings.baseVersions, taken).condense,
    skillsList: true,
  });
}

/** What a hide list leaves out, in words, for what the fit says it shortened. */
export function hiddenInWords(hide: readonly string[], profile: Awaited<ReturnType<typeof loadProfile>>): string[] {
  const certifications = hide.flatMap((id) => (id.startsWith("certification:") ? ((profile.certifications ?? []).find((entry) => `certification:${entry.id}` === id)?.name.trim() ?? []) : []));
  const tools = hide.flatMap((id) => (id.startsWith("tool:") ? ((profile.skills ?? []).find((item) => item.name.toLowerCase() === id.slice(5))?.name ?? id.slice(5)) : []));
  return [
    ...(certifications.length > 0 ? [`Certifications not relevant to the job, to fit: ${certifications.join(", ")}`] : []),
    ...(tools.length > 0 ? [`Tools and platforms not relevant to the job, to fit: ${tools.join(", ")}`] : []),
  ];
}

/**
 * The base resume at `length` as a PDF. Full prints every point. Two and
 * three pages print the chosen points, and if they still run over, the
 * fewest trims that fit, found by halving: each brings a job down a point,
 * older jobs first, re-summarized at its new length. If that isn't enough,
 * the last resorts come before the recent jobs are brought down: the skills
 * line under each job, then the certifications and tools with no bearing on
 * your usual title. What
 * was done is saved, so the preview and the Word file follow, and the page
 * can say what was shortened.
 */
export async function fittedBaseResume(length: BaseLength): Promise<Uint8Array> {
  const pages = BASE_LENGTH_PAGES[length];
  if (pages === null) return renderPdf("/print/base?length=full&fit=0");
  // Two pages: the bottom sections kept to about a third of page two first, so the jobs keep more of their points.
  if (length === "2") await baseCompactHide();
  // Any shorter version of a job not written yet (or that failed before) is written first, so nothing is cut to fit.
  await writeMissingSummaries(length as "2" | "3").catch((error: unknown) => logServerError("base resume summaries", error));
  const [profile, settings] = await Promise.all([loadProfile(), loadSettings()]);
  const rendered = new Map<string, Uint8Array>();
  const render = async (taken: number, skills = true, hidden = false) => {
    const key = `${skills}:${hidden}:${taken}`;
    const pdf = rendered.get(key) ?? (await renderPdf(`/print/base?length=${length}&fit=${taken}&skills=${skills ? "on" : "off"}&hide=${hidden ? "on" : "off"}`));
    rendered.set(key, pdf);
    return pdf;
  };
  const fitsWithin = (upTo: number, skills: boolean, hidden: boolean) => fewestTrims(upTo, async (trims) => countPdfPages(await render(trims, skills, hidden)) <= pages);
  // Older jobs, projects and publications first; then the last resorts: the skills line under each job, then the
  // certifications and tools with no bearing on your title; only then the recent jobs.
  const plan = versionPlan(profile, versionBullets(profile, length, settings.baseVersions));
  const keepingRecent = wholeRecentTrims(plan.steps, plan.ranked, plan.recent);
  let noSkills = false;
  let hide: string[] = [];
  let { taken, fits } = await fitsWithin(keepingRecent, true, false);
  if (!fits) {
    noSkills = true;
    ({ taken, fits } = await fitsWithin(keepingRecent, false, false));
  }
  if (!fits) {
    hide = await baseIrrelevant();
    if (hide.length > 0) ({ taken, fits } = await fitsWithin(keepingRecent, false, true));
  }
  if (!fits) ({ taken, fits } = await fitsWithin(plan.steps.length, false, hide.length > 0));
  // The Word file follows the same trims, so it's measured too (in Word, where it's installed). Where Word
  // lays it out longer, the same steps go on, in the same order, until Word fits as well: then the PDF and
  // the Word file hold exactly the same words, both within the limit.
  const wordPages = async (trims: number) => countDocxPages(await baseResumeDocx(length, trims, noSkills, hide));
  const inWord = await wordPages(taken);
  if (inWord !== null && inWord > pages) {
    fits = false;
    if (!noSkills) {
      noSkills = true;
      fits = ((await wordPages(taken)) ?? 0) <= pages;
    }
    if (!fits && hide.length === 0) {
      hide = await baseIrrelevant();
      if (hide.length > 0) fits = ((await wordPages(taken)) ?? 0) <= pages;
    }
    if (!fits) {
      const further = await fewestTrims(plan.steps.length - taken, async (more) => ((await wordPages(taken + more)) ?? 0) <= pages);
      taken += further.taken;
      fits = further.fits;
    }
  }
  const { dropped } = versionAt(profile, length, settings.baseVersions, taken);
  const changes = [...dropped, ...(noSkills ? ["The skills line under each job, to fit"] : []), ...hiddenInWords(hide, profile)];
  const before = settings.baseFit[length];
  if (
    before?.taken !== taken ||
    Boolean(before.noSkills) !== noSkills ||
    before.fits !== fits ||
    JSON.stringify(before.hide ?? []) !== JSON.stringify(hide) ||
    JSON.stringify(before.dropped) !== JSON.stringify(changes)
  ) {
    await saveSettings({ baseFit: { ...(await loadSettings()).baseFit, [length]: { taken, dropped: changes, noSkills, hide, fits } } });
  }
  return render(taken, !noSkills, hide.length > 0);
}
