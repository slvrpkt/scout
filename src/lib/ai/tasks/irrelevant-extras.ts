import { z } from "zod";

import { NO_EM_DASHES, postingForPrompt, system, UNTRUSTED_POSTING, type Task } from "./prompt-parts";

export const IRRELEVANT_EXTRAS_VERSION = "irrelevant-extras@1";

// A last resort for a resume that still runs over its page limit once the
// older jobs are trimmed and the skills lines under the jobs are gone, before
// the recent jobs are shortened: the certifications, tools and platforms with
// no bearing at all on the job (a tailored resume) or the candidate's usual
// title (the base resume). Anything relevant, said or implied, stays.

const answerSchema = z.object({ certifications: z.array(z.string()), tools: z.array(z.string()) });

const INSTRUCTIONS = `A candidate's resume runs over its page limit. As a last resort, you pick what can go from its Certifications and its Tools & Platforms, as JSON.

- certifications: the ids of certifications with no relevance at all to the target, e.g. a quality-assurance certification for a technical project manager role. Keep any the target asks for or would value, said or implied.
- tools: the names, exactly as given, of tools and platforms with no relevance at all to the target. A tool the target doesn't name but would clearly value (the same kind of work, a related or competing product) stays.
- When in doubt, keep it. Empty lists when everything is relevant.`;

export type ExtrasInput = {
  /** What the resume is for: the posting (tailored) or the candidate's usual title (base). */
  target: { posting: string } | { title: string };
  certifications: { id: string; name: string }[];
  tools: string[];
};

/** The certifications (by id) and tools (by name) that can go, of those given. */
export const irrelevantExtras: Task<ExtrasInput, { certifications: string[]; tools: string[] }> = async (provider, { target, certifications, tools }, options) => {
  if (certifications.length === 0 && tools.length === 0) return { data: { certifications: [], tools: [] }, promptVersion: IRRELEVANT_EXTRAS_VERSION };
  const posting = "posting" in target;
  const answer = await provider.complete({
    system: system(INSTRUCTIONS, posting && UNTRUSTED_POSTING, NO_EM_DASHES),
    messages: [
      {
        role: "user",
        content: [
          posting ? `The target, a job posting:\n${postingForPrompt(target.posting)}` : `The target: the candidate's usual job title, "${target.title.trim() || "their usual role"}".`,
          `Certifications:\n${certifications.map((entry) => `- ${entry.id}: ${entry.name}`).join("\n") || "(none)"}`,
          `Tools & platforms:\n${tools.map((name) => `- ${name}`).join("\n") || "(none)"}`,
        ].join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "irrelevant_extras",
    creativity: "FAITHFUL",
    effort: "low",
    signal: options.signal,
  });
  // Only what was given.
  const ids = new Set(certifications.map((entry) => entry.id));
  const names = new Map(tools.map((name) => [name.toLowerCase(), name]));
  return {
    data: {
      certifications: [...new Set(answer.certifications.filter((id) => ids.has(id)))],
      tools: [...new Set(answer.tools.flatMap((name) => names.get(name.trim().toLowerCase()) ?? []))],
    },
    promptVersion: IRRELEVANT_EXTRAS_VERSION,
  };
};
