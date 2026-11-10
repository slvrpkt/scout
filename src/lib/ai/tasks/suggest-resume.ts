import { z } from "zod";

import type { Extracted, Unit } from "@/lib/application-data";
import type { ProfileData } from "@/lib/profile";

import { jobForPrompt, profileForPrompt, system, UNTRUSTED_POSTING, type Task } from "./prompt-parts";

export const SUGGEST_RESUME_VERSION = "suggest-resume@1";

const answerSchema = z.object({ suggestions: z.array(z.string()) });

const INSTRUCTIONS = `You look at a candidate's tailored resume against a job, as JSON, and say what would make it a better match.

- suggestions: up to 5 short ideas for the candidate to vet, each one sentence. Name what the posting asks for that the resume doesn't show or shows weakly, and say what to add if it's true for them, e.g. "The posting asks for Jira. If you've used it, add it to your Northwind Logistics role." Never assume it's true. Leave out what the resume already covers. An empty list when there's nothing worth raising.`;

export type SuggestResumeInput = { profile: ProfileData; extracted: Extracted; units: readonly Pick<Unit, "label" | "text">[] };

/** What would make the resume as it stands now a better match, for the candidate to vet. */
export const suggestResume: Task<SuggestResumeInput, string[]> = async (provider, { profile, extracted, units }, { signal }) => {
  const answer = await provider.complete({
    system: system(INSTRUCTIONS, UNTRUSTED_POSTING),
    messages: [
      {
        role: "user",
        content: [`The candidate's profile:\n${profileForPrompt(profile)}`, `The job:\n${jobForPrompt(extracted, null)}`, `The resume as it stands:\n${units.map((unit) => `${unit.label}: ${unit.text}`).join("\n")}`].join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "resume_suggestions",
    effort: "low",
    signal,
  });
  return { data: answer.suggestions.map((idea) => idea.trim().slice(0, 300)).filter(Boolean).slice(0, 5), promptVersion: SUGGEST_RESUME_VERSION };
};
