import { z } from "zod";

import { NO_EM_DASHES, system, type Task } from "./prompt-parts";

export const BASE_COMPACT_VERSION = "base-compact@3";

// The two-page base resume keeps its Skills, Tools & Platforms, Education and
// Certifications to about a third of page two, so the jobs get the room:
// the skills and tools that matter most for the candidate's usual title, and
// only the certifications that matter for it, each once.

/** How many skills and tools the two-page base resume keeps. */
export const COMPACT_SKILLS = 10;
export const COMPACT_TOOLS = 8;

const answerSchema = z.object({ skills: z.array(z.string()), tools: z.array(z.string()), certifications: z.array(z.string()) });

const INSTRUCTIONS = `You choose what a candidate's two-page resume keeps in its Skills, Tools & Platforms and Certifications sections, as JSON. Those sections, with Education, must take only about a third of the second page, so the experience gets the room.

- skills: at most ${COMPACT_SKILLS} of the candidate's skills, exactly as given, the ones that matter most for their title, most important first. Drop near-duplicates and narrow ones a broader kept skill covers.
- tools: at most ${COMPACT_TOOLS} of their tools and platforms, exactly as given, the same way.
- certifications: the ids of the certifications to keep: those that matter for the title, each only once. Drop one that repeats another, and one not relevant to the title. For a project, program or delivery manager, keep project-management, Agile and Scrum certifications and drop quality and process-improvement ones (QA, Six Sigma, Lean belts), one product's own tool certifications, and general business courses, unless the title is about that.`;

export type CompactInput = {
  title: string;
  skills: string[];
  tools: string[];
  certifications: { id: string; name: string }[];
};

/** What the two-page base resume keeps: skills and tools by name, certifications by id. */
export const compactBase: Task<CompactInput, { skills: string[]; tools: string[]; certifications: string[] }> = async (provider, { title, skills, tools, certifications }, options) => {
  const answer = await provider.complete({
    system: system(INSTRUCTIONS, NO_EM_DASHES),
    messages: [
      {
        role: "user",
        content: [
          `The candidate's usual title: "${title.trim() || "their usual role"}".`,
          `Skills:\n${skills.map((name) => `- ${name}`).join("\n") || "(none)"}`,
          `Tools & platforms:\n${tools.map((name) => `- ${name}`).join("\n") || "(none)"}`,
          `Certifications:\n${certifications.map((entry) => `- ${entry.id}: ${entry.name}`).join("\n") || "(none)"}`,
        ].join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "base_compact",
    creativity: "FAITHFUL",
    effort: "low",
    signal: options.signal,
  });
  // Only what was given, within the limits.
  const known = (given: readonly string[]) => {
    const names = new Map(given.map((name) => [name.toLowerCase(), name]));
    return (chosen: readonly string[], limit: number) => [...new Set(chosen.flatMap((name) => names.get(name.trim().toLowerCase()) ?? []))].slice(0, limit);
  };
  const ids = new Set(certifications.map((entry) => entry.id));
  return {
    data: {
      skills: known(skills)(answer.skills, COMPACT_SKILLS),
      tools: known(tools)(answer.tools, COMPACT_TOOLS),
      certifications: [...new Set(answer.certifications.filter((id) => ids.has(id)))],
    },
    promptVersion: BASE_COMPACT_VERSION,
  };
};
