import { z } from "zod";

import { system, type Task } from "./prompt-parts";

export const GROUP_SUGGESTIONS_VERSION = "group-suggestions@2";

// The resume suggestions across the candidate's drafts, grouped by what
// they're about, so a topic that keeps coming up ("HIPAA", "SELC documents")
// can be answered once (recurring-questions.ts). Code keeps the topics two or
// more drafts raise.

const answerSchema = z.object({
  topics: z.array(
    z.object({
      /** A short name for what they're about, e.g. "HIPAA / protected health information". */
      topic: z.string(),
      /** The numbers of the suggestions about it. */
      members: z.array(z.number().int()),
      /** The profile role it points to, by id, or null when it's about the candidate in general. */
      roleId: z.string().nullable(),
      /** The fact, as the candidate might confirm it, in their voice, from what the suggestions say points to it; "" when nothing does. */
      guess: z.string(),
      /** The topic already decided that this is the same as, by its name, or null. */
      sameAs: z.preprocess((value) => value ?? null, z.string().nullable()),
    }),
  ),
});

const INSTRUCTIONS = `You group a candidate's resume suggestions, from several job drafts, by what they're about, as JSON.

- topics: one per thing the suggestions ask about, worded differently or not ("name HIPAA", "mention PHI handling" and "protected health information" are one topic). Only group suggestions that ask about the same skill, tool, duty, document or credential; a suggestion that stands alone may be left out. members: the numbers of its suggestions.
- topic: a short name for it, e.g. "HIPAA / protected health information", "SELC documents", "Agile metrics (velocity, burndown)".
- roleId: the id of the candidate's role the suggestions point to, from the list of roles, when they point to one; null when it's about the candidate in general (a clearance, a certification, a language).
- sameAs: when the topic is the same as one in the list of topics already decided (the same skill, tool, duty, document or credential, however it's worded, e.g. "Jira / Confluence tooling" and "Jira and Confluence for sprints"), that topic's name exactly as listed; otherwise null.
- guess: the fact as the candidate might confirm it, one sentence in their voice without "I", only from what the suggestions say points to it, e.g. "Handled protected health information under HIPAA privacy and security controls in claims EDI work." Empty when nothing points to it.`;

export type SuggestionItem = { applicationId: string; company: string; text: string };
export type RecurringTopic = { topic: string; roleId: string | null; guess: string; items: SuggestionItem[] };

export type GroupInput = {
  items: SuggestionItem[];
  roles: { id: string; label: string }[];
  /** Topics the candidate already answered or put away: a topic that's the same as one of these isn't asked again. */
  decided?: string[];
};
export type GroupedTopic = RecurringTopic & { sameAs: string | null };

/** The topics two or more drafts raise, each with its suggestions, a role it points to and a guess at the fact. */
export const groupSuggestions: Task<GroupInput, GroupedTopic[]> = async (provider, { items, roles, decided = [] }, { signal }) => {
  if (new Set(items.map((item) => item.applicationId)).size < 2) return { data: [], promptVersion: GROUP_SUGGESTIONS_VERSION };
  const answer = await provider.complete({
    system: system(INSTRUCTIONS),
    messages: [
      {
        role: "user",
        content: [
          `The candidate's roles:\n${roles.map((role) => `${role.id}: ${role.label}`).join("\n")}`,
          decided.length > 0 && `Topics already decided:\n${decided.map((topic) => `- ${topic}`).join("\n")}`,
          `The suggestions:\n${items.map((item, index) => `${index}. (${item.company}) ${item.text}`).join("\n")}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "suggestion_topics",
    effort: "low",
    signal,
  });
  const roleIds = new Set(roles.map((role) => role.id));
  const topics = answer.topics.flatMap((topic) => {
    const members = [...new Set(topic.members)].filter((index) => index >= 0 && index < items.length).map((index) => items[index]);
    // Two drafts or more: one draft's question is answered beside its resume.
    if (new Set(members.map((item) => item.applicationId)).size < 2 || !topic.topic.trim()) return [];
    const sameAs = topic.sameAs && decided.includes(topic.sameAs.trim()) ? topic.sameAs.trim() : null;
    return [{ topic: topic.topic.trim().slice(0, 120), roleId: topic.roleId && roleIds.has(topic.roleId) ? topic.roleId : null, guess: topic.guess.trim().slice(0, 400), items: members, sameAs }];
  });
  return { data: topics, promptVersion: GROUP_SUGGESTIONS_VERSION };
};
