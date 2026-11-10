import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { getAiProvider } from "@/lib/ai";
import { isAiUsable } from "@/lib/ai/config";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { BASE_BULLETS_VERSION, condenseBullets, groupTools, writeBaseBullets, writeBaseSummary } from "@/lib/ai/tasks";
import { defineJob, findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { resumePublications, type ProfileData } from "@/lib/profile";
import { afterSteps, bulletBudgets, bulletsAt, byRecency, LAST_RESORT_FLOOR, recentCount, trimSteps, type TrimStep } from "@/lib/resume-fit";
import { roomProblem } from "@/lib/ai/tasks/condense-bullets";
import type { BaseLength, SettingsData } from "@/lib/settings";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// The base resume's versions: Full, every point polished, and Two and Three
// pages, the strongest points for your usual title chosen by the AI, the 3
// most recent jobs with the most room and older ones up to 5. Written in the
// background once Profile → Experience has been quiet for a moment, and kept
// until the experience or the title changes. A version that still runs long
// comes down a point at a time, older jobs first (5, 4, 3, 2, 1), then the
// recent ones (never below 2), each time with the job re-summarized at its
// new length, so no detail is simply cut. It says what it shortened.

export const BASE_SUMMARIES_KEY = "base-resume-summaries";
/** How long Experience has to be still before writing, as it saves while you type. */
const QUIET_MS = 20_000;

/** The lengths, and the page limit each is fitted to (null: none). */
export const BASE_LENGTH_PAGES: Record<BaseLength, number | null> = { full: null, "2": 2, "3": 3 };

type Job = ProfileData["experience"][number];

export const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.replace(/^\s*[-*•·]\s*/, "").trim())
    .filter(Boolean);

/** What a job's version was made from: when it changes, the version is out of date. */
export const fingerprintOf = (job: Pick<Job, "role" | "company" | "bullets">) =>
  createHash("sha256").update(JSON.stringify([job.role.trim(), job.company.trim(), lines(job.bullets)])).digest("hex");

/** What a whole version was made from: the title it's chosen for, and every job. */
export const versionKey = (profile: ProfileData, length: BaseLength) =>
  createHash("sha256")
    // The task's version too: a version chosen under older rules is written again.
    .update(JSON.stringify([BASE_BULLETS_VERSION, length, profile.basics.headline.trim(), profile.experience.map((job) => [job.id, fingerprintOf(job)])]))
    .digest("hex");

/** A version's bullets, while it's still true to the profile; null when it's out of date or not written yet. */
export function savedVersion(profile: ProfileData, length: BaseLength, versions: SettingsData["baseVersions"]): Record<string, string[]> | null {
  const saved = versions[length];
  return saved && saved.from === versionKey(profile, length) ? saved.bullets : null;
}

/**
 * Each job's bullets in a version, most important first: the AI's, or until
 * it has written them, what you wrote (Full) or your first points within the
 * job's budget (Two and Three pages).
 */
export function versionBullets(profile: ProfileData, length: BaseLength, versions: SettingsData["baseVersions"]): Record<string, string[]> {
  const saved = savedVersion(profile, length, versions);
  const budgets = bulletBudgets(
    profile.experience.map((job) => ({ ...job, bullets: lines(job.bullets).length })),
    BASE_LENGTH_PAGES[length],
  );
  return Object.fromEntries(
    profile.experience.map((job) => [job.id, saved?.[job.id] ?? (budgets ? lines(job.bullets).slice(0, budgets.get(job.id)?.max ?? 1) : lines(job.bullets))]),
  );
}

/** The trims for a version, in order: bullets off the ends of jobs, older jobs first, then projects and publications, then the recent jobs. */
export function versionPlan(profile: ProfileData, bullets: Record<string, string[]>): { ranked: string[]; recent: number; counts: Map<string, number>; steps: TrimStep[] } {
  const ranked = byRecency(profile.experience);
  const counts = new Map(profile.experience.map((job) => [job.id, bullets[job.id]?.length ?? 0]));
  const projects = profile.projects
    .toSorted((a, b) => (a.startYear ?? 0) * 12 + (a.startMonth ?? 1) - ((b.startYear ?? 0) * 12 + (b.startMonth ?? 1)))
    .map((project) => `project:${project.id}`);
  const publications = resumePublications(profile.publications)
    .toReversed()
    .map((publication) => `publication:${publication.id}`);
  const recent = recentCount(profile.experience);
  return { ranked, recent, counts, steps: trimSteps(ranked, counts, [...projects, ...publications], recent) };
}

/** A version's summaries of each job at each shorter length, while the version is current; only those that really save room. */
function versionSummaries(profile: ProfileData, length: BaseLength, versions: SettingsData["baseVersions"]): Record<string, Record<string, string[]>> {
  const version = versions[length];
  if (!version || !savedVersion(profile, length, versions)) return {};
  return Object.fromEntries(
    Object.entries(version.summaries ?? {}).map(([id, byCount]) => [
      id,
      Object.fromEntries(Object.entries(byCount).filter(([, lines]) => roomProblem(version.bullets[id] ?? [], lines) === null)),
    ]),
  );
}

/**
 * A version after its first `taken` trims, as `condense` for ResumeDocument
 * and the Word file, and what the trims changed, in words: each job brought
 * down a point is shown rewritten at its new length (or the nearest longer
 * one written), never with points simply cut off.
 */
export function versionAt(profile: ProfileData, length: BaseLength, versions: SettingsData["baseVersions"], taken: number) {
  const bullets = versionBullets(profile, length, versions);
  const summaries = versionSummaries(profile, length, versions);
  const plan = versionPlan(profile, bullets);
  const after = afterSteps(plan.counts, plan.steps, Math.min(Math.max(0, taken), plan.steps.length));
  const shown: Record<string, string[]> = {};
  const dropped: string[] = [];
  for (const job of profile.experience) {
    const all = bullets[job.id] ?? [];
    const count = after.counts.get(job.id) ?? all.length;
    const fitted = bulletsAt(all, count, summaries[job.id]);
    shown[job.id] = fitted.bullets;
    const name = job.company.trim() || job.role.trim() || "A job";
    if (fitted.how === "summarized") dropped.push(`${name}: re-summarized from ${all.length} points to ${fitted.bullets.length}`);
    else if (fitted.how === "title-only") dropped.push(`${name}: shown as its title and dates only`);
    else if (count < all.length) dropped.push(`${name}: kept at ${all.length} points, as a shorter version couldn't be written`);
  }
  for (const id of after.leftOut) {
    const [kind, key] = id.split(":");
    if (kind === "project") dropped.push(`Project: ${profile.projects.find((project) => project.id === key)?.name.trim() || "a project"}`);
    else dropped.push(`Publication: ${profile.publications.find((publication) => publication.id === key)?.citation.trim().slice(0, 80) || "a publication"}`);
  }
  return { condense: { bullets: shown, leftOut: [...after.leftOut] }, dropped, steps: plan.steps.length };
}

/** Each shorter length a job of a version may be brought down to: every job to 1 (the title line alone needs no summary). */
export function shorterCounts(profile: ProfileData, bullets: Record<string, string[]>): Map<string, number[]> {
  return new Map(
    profile.experience.map((job) => {
      const has = bullets[job.id]?.length ?? 0;
      return [job.id, Array.from({ length: Math.max(0, has - LAST_RESORT_FLOOR) }, (_, index) => has - 1 - index)];
    }),
  );
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });

/** Waits until Profile → Experience hasn't changed for QUIET_MS. */
async function untilQuiet(signal: AbortSignal): Promise<void> {
  for (;;) {
    const newest = (await prisma.experience.aggregate({ _max: { updatedAt: true } }))._max.updatedAt;
    const since = newest ? Date.now() - newest.getTime() : Infinity;
    if (since >= QUIET_MS) return;
    await sleep(QUIET_MS - since, signal);
  }
}

/**
 * Writes the base resume's versions that are out of date, one AI request
 * each: Two pages first, as it's the one most often sent, then Three, then
 * Full. A version the AI can't write keeps the stand-in until the next edit.
 */
export const condenseBaseResumeJob = defineJob({
  type: "condense-base-resume",
  input: z.object({}),
  result: z.object({ written: z.number().int() }),
  async run(_input, { step, signal }) {
    if (!(await isAiUsable())) return { written: 0 };
    await untilQuiet(signal);
    const [provider, options] = await Promise.all([getAiProvider(), loadTaskOptions()]);
    const { loadProfile } = await import("@/lib/profile-data");
    let written = 0;
    // Tools & platforms not in a category yet: sorted into one, for the Full resume.
    try {
      const tools = await prisma.skill.findMany({ where: { kind: "TOOL" }, select: { id: true, name: true, group: true } });
      const toSort = tools.filter((tool) => !tool.group.trim());
      if (toSort.length > 0) {
        await step("Sorting your tools and platforms");
        const categories = [...new Set(tools.map((tool) => tool.group.trim()).filter(Boolean))];
        const { data } = await groupTools(provider, { toSort: toSort.map((tool) => tool.name), categories }, { ...options, signal });
        for (const tool of toSort) if (data[tool.name]) await prisma.skill.updateMany({ where: { id: tool.id, group: "" }, data: { group: data[tool.name] } });
      }
    } catch (error) {
      if (signal.aborted) throw error;
      logServerError("sorting tools", error);
    }
    for (const length of ["2", "3", "full"] as const) {
      const profile = await loadProfile();
      const settings = await loadSettings();
      if (savedVersion(profile, length, settings.baseVersions) || profile.experience.length === 0) continue;
      await step(length === "full" ? "Polishing your full resume" : `Choosing your strongest points for ${length === "2" ? "two" : "three"} pages`);
      try {
        const { data, promptVersion } = await writeBaseBullets(provider, { profile, title: profile.basics.headline || "", maxPages: BASE_LENGTH_PAGES[length] }, { ...options, signal });
        const latest = await loadSettings();
        // A new version starts without summaries; they're written next.
        await saveSettings({ baseVersions: { ...latest.baseVersions, [length]: { from: versionKey(profile, length), bullets: data, promptVersion } } });
        written += 1;
      } catch (error) {
        if (signal.aborted) throw error;
        logServerError("base resume version", error);
      }
    }
    // Each job of the two- and three-page versions re-summarized at every shorter length it may need.
    for (const length of ["2", "3"] as const) {
      if (await writeMissingSummaries(length, { signal, step })) written += 1;
    }
    // Each page count fitted now, so the preview shows what the download will.
    if (written > 0) {
      const { fittedBaseResume } = await import("@/lib/base-resume-fit");
      for (const length of ["2", "3"] as const) {
        await step(`Fitting ${length === "2" ? "two" : "three"} pages`);
        await fittedBaseResume(length).catch((error: unknown) => logServerError("fitting the base resume", error));
      }
    }
    // The summary at the top, as short as a tailored resume's.
    const profile = await loadProfile();
    const from = profile.basics.summary.trim();
    if (from && (await loadSettings()).baseSummary?.from !== from) {
      try {
        const { data } = await writeBaseSummary(provider, { profile }, { ...options, signal });
        if (data) await saveSettings({ baseSummary: { from, text: data } });
      } catch (error) {
        if (signal.aborted) throw error;
        logServerError("base resume summary", error);
      }
    }
    return { written };
  },
});

/**
 * Rewrites each job of a version at every shorter length its fit may need
 * that isn't written yet, so a job brought down a point is always said again
 * in fewer points rather than cut. Run in the background after an edit, and
 * again before fitting, for any length that failed then. Returns whether
 * anything new was saved.
 */
export async function writeMissingSummaries(
  length: "2" | "3",
  { signal, step }: { signal?: AbortSignal; step?: (label: string) => Promise<unknown> } = {},
): Promise<boolean> {
  if (!(await isAiUsable())) return false;
  const { loadProfile } = await import("@/lib/profile-data");
  const [profile, settings] = await Promise.all([loadProfile(), loadSettings()]);
  const version = settings.baseVersions[length];
  if (!version || !savedVersion(profile, length, settings.baseVersions)) return false;
  const summaries: Record<string, Record<string, string[]>> = { ...version.summaries };
  const needed = shorterCounts(profile, version.bullets);
  const missing = profile.experience.flatMap((job) => {
    const original = version.bullets[job.id] ?? [];
    const counts = (needed.get(job.id) ?? []).filter((count) => {
      const saved = summaries[job.id]?.[count];
      return !saved || roomProblem(original, saved) !== null;
    });
    return counts.length > 0 ? [{ job, counts }] : [];
  });
  if (missing.length === 0) return false;
  const [provider, options] = await Promise.all([getAiProvider(), loadTaskOptions()]);
  let changed = false;
  for (const { job, counts } of missing) {
    await step?.(`Summarizing ${job.company.trim() || job.role.trim() || "a job"} for ${length === "2" ? "two" : "three"} pages`);
    try {
      const { data } = await condenseBullets(provider, { role: job.role, company: job.company, bullets: version.bullets[job.id] ?? [], counts }, { ...options, signal });
      if (Object.keys(data).length === 0) continue;
      summaries[job.id] = { ...summaries[job.id], ...Object.fromEntries(Object.entries(data).map(([count, bullets]) => [String(count), bullets])) };
      changed = true;
    } catch (error) {
      if (signal?.aborted) throw error;
      logServerError("base resume summaries", error);
    }
  }
  if (!changed) return false;
  const latest = await loadSettings();
  const current = latest.baseVersions[length];
  // Saved only if the version is still the one they were written for.
  if (!current || current.from !== version.from) return false;
  await saveSettings({ baseVersions: { ...latest.baseVersions, [length]: { ...current, summaries } } });
  return true;
}

/** After Profile → Experience changes, or at startup: write the versions in the background, unless that's already queued or under way. */
export async function queueBaseResumeSummaries(): Promise<void> {
  try {
    if ((await findUnfinishedJobs(BASE_SUMMARIES_KEY)).length > 0) return;
    await startJob(condenseBaseResumeJob, {}, { key: BASE_SUMMARIES_KEY });
  } catch (error) {
    logServerError("base resume versions", error);
  }
}

/** Whether versions are being written right now, for the Resume page. */
export async function summarizingBaseResume(): Promise<boolean> {
  return (await findUnfinishedJobs(BASE_SUMMARIES_KEY)).length > 0;
}
