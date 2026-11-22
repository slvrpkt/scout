import { z } from "zod";

import { keptSuggestions } from "@/lib/suggestion-filter";
import type { Extracted, Match, Unit } from "@/lib/application-data";
import type { ProfileData } from "@/lib/profile";

import { jobForPrompt, profileForPrompt, system, UNTRUSTED_POSTING, type Task } from "./prompt-parts";

export const SUGGEST_RESUME_VERSION = "suggest-resume@4";

const answerSchema = z.object({ suggestions: z.array(z.string()) });

const INSTRUCTIONS = `You look at a candidate's tailored resume against a job, as JSON, and say what would make it a better match.

- The job's requirements may come with inProfile (covered, partial or gap) and a note naming the evidence, from a check of the whole profile: start from it. Partial means implied but not said outright.
- suggestions: up to 5 short ideas for the candidate to vet, each one or two sentences, for what would make this resume a stronger match. Read the whole profile (education, roles and their bullets, projects, skills, certifications) before raising anything, and name the evidence. Three kinds, in this order:
  - Implied but not said: the profile points to it, but the resume doesn't say it in the posting's terms. Name what points to it and what to add if it's true, e.g. "Your roles as developer, BA/QA and PM span the SDLC, but the resume doesn't name the artifacts. If true, add a bullet naming them (requirements specs, test plans, release notes) to your Northwind Logistics role."
  - Shown but buried: the profile has it, but the resume leaves out something this job makes a core duty, or tucks it away in an old role. A skill already anywhere on the resume, its Skills or Tools section included, isn't buried: an ATS and a recruiter both find it there. Don't suggest moving it into a role's bullets.
  - Not shown: the posting asks for it and nothing in the profile shows or implies it, e.g. "The posting asks for PMP; your profile doesn't show one. If you hold it, add it under Certifications." Never assume it's true.
  Judge by meaning, never by matching words. Before raising anything, read the resume and the profile for it under any name: what they show, say in other words or clearly imply is covered, and isn't a suggestion.
  Degrees: never raise a degree as missing or as not meeting the posting. Any bachelor's or higher in a science, technology, engineering or math field (computer science, IT, information systems, any engineering including nanosystems, math, statistics, physics, data science, business analytics) meets a STEM, technical, engineering or "computer science or related field" degree, and a higher degree meets a lower one. A degree in another field than one the posting prefers is left alone: say nothing about it. The one degree idea allowed: when the degree's own name hides that it meets the ask, how the resume could say so (e.g. "B.Sc. in Nanosystems Engineering (Engineering)").
  Never raise:
  - A tool, skill or certification already anywhere on the resume, its Skills or Tools & Platforms sections included, to have it named in a role's bullets as well.
  - A nice-to-have, plus or preferred item the profile doesn't show (a certification "as a plus", a preferred industry); nor anything that ends with "if not, no action is needed".
  - Generic soft skills to name outright (problem solving, communication, interpersonal, organizational, customer service, teamwork): the work shows them.
  - Logistics that aren't resume content: travel, relocation, hours, start date, salary, location.
  Only what a recruiter for this job would weigh and the candidate can act on in a minute: a required skill or duty the resume doesn't show although the profile points to it, or a required item the profile doesn't show at all. Fewer, better ideas: two that matter beat five that don't, and an empty list is fine. Don't flatter: no idea that only says the resume is good. An empty list when there's nothing worth raising.`;

export type SuggestResumeInput = { profile: ProfileData; extracted: Extracted; units: readonly Pick<Unit, "label" | "text">[]; match?: Match | null };

/** What would make the resume as it stands now a better match, for the candidate to vet. */
export const suggestResume: Task<SuggestResumeInput, string[]> = async (provider, { profile, extracted, units, match = null }, { signal }) => {
  const answer = await provider.complete({
    system: system(INSTRUCTIONS, UNTRUSTED_POSTING),
    messages: [
      {
        role: "user",
        content: [`The candidate's profile:\n${profileForPrompt(profile)}`, `The job:\n${jobForPrompt(extracted, match)}`, `The resume as it stands:\n${units.map((unit) => `${unit.label}: ${unit.text}`).join("\n")}`].join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "resume_suggestions",
    effort: "low",
    signal,
  });
  return { data: keptSuggestions(answer.suggestions), promptVersion: SUGGEST_RESUME_VERSION };
};
