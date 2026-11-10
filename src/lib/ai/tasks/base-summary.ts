import { z } from "zod";

import type { ProfileData } from "@/lib/profile";

import { CANDIDATE_VOICE, humanizeRules, NO_EM_DASHES, profileForPrompt, system, type Task } from "./prompt-parts";

export const BASE_SUMMARY_VERSION = "base-summary@3";

const answerSchema = z.object({ summary: z.string() });

const INSTRUCTIONS = `You write the summary at the top of a candidate's general resume, as JSON.

- summary: 2 to 3 sentences about the candidate, from what their own summary and experience say, for a reader who has never met them. Write it as resumes are written, with no name and no pronouns at all: never he, she, they or I. "Led delivery of...", not "He led delivery of...". Keep the numbers that matter. Show the scope of what they led and the results they delivered, where their profile says so. Nothing that isn't in their profile.`;

/** The base resume's summary, as short as a tailored resume's. */
export const writeBaseSummary: Task<{ profile: ProfileData }, string> = async (provider, { profile }, options) => {
  const answer = await provider.complete({
    system: system(INSTRUCTIONS, NO_EM_DASHES, CANDIDATE_VOICE, humanizeRules(options.humanize)),
    messages: [{ role: "user", content: `The candidate's profile:\n${profileForPrompt(profile)}` }],
    schema: answerSchema,
    schemaName: "base_summary",
    creativity: "FAITHFUL",
    effort: "low",
    signal: options.signal,
  });
  return { data: answer.summary.trim(), promptVersion: BASE_SUMMARY_VERSION };
};
