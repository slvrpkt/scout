import { z } from "zod";

import { system, type Task } from "./prompt-parts";

export const GROUP_TOOLS_VERSION = "group-tools@1";

// Profile → Tools & platforms is one box; the Full resume shows them in
// categories. This sorts the tools that have none yet, reusing the
// categories already there wherever one fits.

const answerSchema = z.object({ tools: z.array(z.object({ name: z.string(), category: z.string() })) });

const INSTRUCTIONS = `You sort a candidate's tools and platforms into categories for the "Tools & Platforms" section of their resume, as JSON.

- tools: each tool from "To sort", by its exact name, with its category.
- Use one of the existing categories whenever it fits. Only when none does, make a new short one in title case, like "AI Models & Frameworks", "Web & Mobile", "Data", "Cloud & DevOps", "Testing", "Integrations" or "Dev Tools".
- A category name has no ":" or "·" and is under 40 characters. Keep the categories few: at most about eight in all.`;

/** A category for each tool that came back right, by name. */
export const groupTools: Task<{ toSort: readonly string[]; categories: readonly string[] }, Record<string, string>> = async (provider, { toSort, categories }, { signal }) => {
  if (toSort.length === 0) return { data: {}, promptVersion: GROUP_TOOLS_VERSION };
  const answer = await provider.complete({
    system: system(INSTRUCTIONS),
    messages: [{ role: "user", content: [`Existing categories: ${categories.length > 0 ? categories.join("; ") : "none yet"}`, `To sort:\n${toSort.map((name) => `- ${name}`).join("\n")}`].join("\n\n") }],
    schema: answerSchema,
    schemaName: "tool_groups",
    creativity: "FAITHFUL",
    effort: "low",
    signal,
  });
  const asked = new Set(toSort);
  const data: Record<string, string> = {};
  for (const { name, category } of answer.tools) {
    const clean = category.replace(/[:·\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
    if (asked.has(name) && clean) data[name] = clean;
  }
  return { data, promptVersion: GROUP_TOOLS_VERSION };
};
