import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { ApplicationStatus } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { isAiUsable } from "@/lib/ai/config";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { groupSuggestions, type SuggestionItem } from "@/lib/ai/tasks";
import { defineJob, findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import type { SettingsData } from "@/lib/settings";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// Questions that keep coming up (Drafts to review): a suggestion two or more
// drafts raise, worded differently or not, is one topic to answer once.
// "Yes, it's true" keeps the fact in the profile (the role it belongs to, or
// Facts about me) and puts it on the drafts that asked, and only those;
// "Not true" keeps that in Facts, so it's never suggested again; "Later" and
// "Dismiss" just put it away. The AI groups the suggestions in the
// background, only when they've changed.

const KEY = "group-suggestions";
/** How long "Later" puts a topic away. */
export const LATER_MS = 20 * 60 * 60 * 1000;
/** What "Not true" keeps in Facts about me, which every AI step reads. */
export const notTrueFact = (topic: string) => `Not true for me, so never suggest it: ${topic}.`;

/** The suggestions on the drafts you haven't sent, without the ones you dismissed beside a resume. */
async function openSuggestions(): Promise<SuggestionItem[]> {
  const drafts = await prisma.application.findMany({
    where: { status: ApplicationStatus.DRAFT, archivedAt: null },
    select: { id: true, company: true, title: true, resumeSuggestions: true, dismissedSuggestions: true },
    orderBy: { id: "asc" },
  });
  return drafts.flatMap((draft) =>
    draft.resumeSuggestions
      .filter((text) => !draft.dismissedSuggestions.includes(text))
      .map((text) => ({ applicationId: draft.id, company: draft.company.trim() || draft.title.trim() || "A draft", text })),
  );
}

const stampOf = (items: readonly SuggestionItem[]) =>
  createHash("sha1")
    .update(JSON.stringify(items.map((item) => [item.applicationId, item.text])))
    .digest("hex")
    .slice(0, 16);

export const groupSuggestionsJob = defineJob({
  type: "group-suggestions",
  input: z.object({}),
  result: z.object({ topics: z.number().int() }),
  async run(_input, { signal }) {
    const [all, profile, provider, options, settings] = await Promise.all([openSuggestions(), loadProfile(), getAiProvider(), loadTaskOptions(), loadSettings()]);
    const roles = profile.experience.map((entry) => ({ id: entry.id, label: [entry.role, entry.company].filter((part) => part.trim()).join(" at ") }));
    // Suggestions already answered or put away aren't grouped again.
    const handled = handledTexts(settings.topicDecisions);
    const items = all.filter((item) => !handled.has(item.text));
    const { data } = await groupSuggestions(provider, { items, roles, decided: Object.keys(settings.topicDecisions) }, { ...options, signal });
    // A topic that comes back under another name is the one you decided: its suggestions join that decision.
    const decisions = { ...settings.topicDecisions };
    const topics = data.flatMap(({ sameAs, ...topic }) => {
      const decision = sameAs ? decisions[sameAs] : undefined;
      if (!sameAs || !decision) return [topic];
      if (decision.state === "later") return [{ ...topic, topic: sameAs }];
      decisions[sameAs] = { ...decision, texts: [...new Set([...(decision.texts ?? []), ...topic.items.map((item) => item.text)])] };
      return [];
    });
    await saveSettings({ recurringTopics: { stamp: stampOf(all), topics }, topicDecisions: decisions });
    return { topics: topics.length };
  },
});

/** Groups the drafts' suggestions again when they've changed since the last time; in the background. */
export async function queueGrouping(settings: Pick<SettingsData, "recurringTopics">): Promise<void> {
  try {
    const items = await openSuggestions();
    if (stampOf(items) === settings.recurringTopics.stamp) return;
    if (!(await isAiUsable()) || (await findUnfinishedJobs(KEY)).length > 0) return;
    await startJob(groupSuggestionsJob, {}, { key: KEY });
  } catch (error) {
    logServerError("grouping the drafts' suggestions", error);
  }
}

/** The suggestions you've answered, marked not true or dismissed, on any draft, under any topic name. */
export function handledTexts(decisions: SettingsData["topicDecisions"]): Set<string> {
  return new Set(Object.values(decisions).flatMap((decision) => (decision.state === "later" ? [] : (decision.texts ?? []))));
}

const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3));

/** Whether a line says much the same as one already there (most of its words in common), so it isn't added twice. */
export function alreadySaid(lines: readonly string[], text: string): boolean {
  const mine = words(text);
  if (mine.size === 0) return lines.some((line) => line.trim().toLowerCase() === text.trim().toLowerCase());
  return lines.some((line) => {
    const theirs = words(line);
    const shared = [...mine].filter((word) => theirs.has(word)).length;
    return shared / Math.max(mine.size, theirs.size) >= 0.7;
  });
}

export type RecurringQuestion = {
  topic: string;
  roleId: string | null;
  /** The role it points to, as the profile names it. */
  roleLabel: string | null;
  guess: string;
  /** The drafts that ask, each once, with the suggestion they raised. */
  drafts: { applicationId: string; company: string; text: string }[];
};

/**
 * The topics to show now: not answered, not marked not true or dismissed,
 * past their Later, and still raised by two drafts or more as they stand.
 */
export async function recurringQuestions(now = new Date()): Promise<RecurringQuestion[]> {
  const [settings, items, profile] = await Promise.all([loadSettings(), openSuggestions(), loadProfile()]);
  const handled = handledTexts(settings.topicDecisions);
  const open = new Set(items.filter((item) => !handled.has(item.text)).map((item) => `${item.applicationId}\n${item.text}`));
  const roleLabel = (id: string | null) => {
    const role = id && profile.experience.find((entry) => entry.id === id);
    return role ? [role.role, role.company].filter((part) => part.trim()).join(" at ") : null;
  };
  return settings.recurringTopics.topics.flatMap((topic) => {
    const decision = settings.topicDecisions[topic.topic];
    const drafts = topic.items.filter((item) => open.has(`${item.applicationId}\n${item.text}`));
    const byDraft = [...new Map(drafts.map((item) => [item.applicationId, item])).values()];
    if (byDraft.length < 2) return [];
    if (decision && decision.state !== "later") return [];
    // Later: back the next day, or sooner when a draft that wasn't asking then raises it.
    if (decision?.state === "later") {
      const waiting = decision.until && Date.parse(decision.until) > now.getTime();
      const newDraft = byDraft.some((item) => !(decision.drafts ?? []).includes(item.applicationId));
      if (waiting && !newDraft) return [];
    }
    return [{ topic: topic.topic, roleId: topic.roleId, roleLabel: roleLabel(topic.roleId), guess: topic.guess, drafts: byDraft }];
  });
}

/**
 * After this feature adds to the profile: the change is taken as seen, so it
 * doesn't rewrite every recent draft or mark the older ones out of date (the
 * drafts that asked are changed on their own).
 */
export async function acceptProfileChange(): Promise<void> {
  const stamp = createHash("sha256").update(JSON.stringify(await loadProfile())).digest("hex");
  await saveSettings({ profileStamp: stamp });
  (globalThis as unknown as { lastProfile?: string }).lastProfile = stamp;
}

/** Every suggestion a topic was grouped from, on any draft: what a decision on it covers. */
export async function topicTexts(topic: string): Promise<string[]> {
  const settings = await loadSettings();
  return settings.recurringTopics.topics.find((entry) => entry.topic === topic)?.items.map((item) => item.text) ?? [];
}

/** Takes suggestions off drafts' lists, by their text. */
export async function removeSuggestions(items: readonly { applicationId: string; text: string }[]): Promise<void> {
  const byDraft = new Map<string, Set<string>>();
  for (const item of items) byDraft.set(item.applicationId, (byDraft.get(item.applicationId) ?? new Set()).add(item.text));
  for (const [applicationId, texts] of byDraft) {
    const application = await prisma.application.findUnique({ where: { id: applicationId }, select: { resumeSuggestions: true } });
    if (!application) continue;
    await prisma.application.update({ where: { id: applicationId }, data: { resumeSuggestions: application.resumeSuggestions.filter((text) => !texts.has(text)) } });
  }
}
