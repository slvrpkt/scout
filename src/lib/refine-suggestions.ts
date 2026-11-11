import { Tone } from "@/generated/prisma/enums";
import type { Match, Requirement } from "@/lib/application-data";

// The suggestion chips in the Refine with AI panel (E8-5), built from the
// resume as it is now (its ATS grade: what's still missing, what's covered),
// else from the application's match, with the prototype's chips where
// neither has anything to offer (decided 28 September 2026: no extra AI call).
// Built from the live grade, a chip like "Mention Linear" goes once Linear
// is on the resume.

export type RefineSuggestions = { resume: string[]; letter: string[]; email: string[] };

/** Longer requirements make clumsy chips; they're left out. */
const MAX_NAME = 28;

const shortName = (name: string | null | undefined) => {
  const trimmed = name?.trim();
  return trimmed && trimmed.length <= MAX_NAME ? trimmed : null;
};

/** What to call a gap: its skill or language, or its text when that's short, e.g. "Kubernetes". */
function gapName(text: string, requirement: Requirement | undefined): string | null {
  if (requirement?.kind === "skill") return shortName(requirement.skill);
  if (requirement?.kind === "language") return shortName(requirement.language);
  const name = shortName(text);
  // "Fintech experience" reads better lower-cased mid-sentence; "AWS" doesn't change.
  return name && /^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name;
}

export function refineSuggestions({
  match,
  requirements,
  tone,
  hasSummary,
  live,
}: {
  /** The resume as it is now: what's still missing from it, and what's covered (the ATS grade). */
  live?: { missing: string[]; covered: string[] } | null;
  match: Match | null;
  /** The extracted requirements, in the same order as the match's items. */
  requirements: Requirement[];
  tone: Tone;
  /** Whether the tailored resume has a summary to shorten. */
  hasSummary: boolean;
}): RefineSuggestions {
  const items = match?.items ?? [];
  const matched = items.find((item) => item.result === "covered" && item.skill)?.skill ?? null;
  const matchGap = items.flatMap((item, index) => {
    if (item.result !== "gap") return [];
    const name = gapName(item.requirement, requirements[index]);
    return name ? [name] : [];
  })[0];
  // The live grade wins: it follows every edit.
  const strongest = live ? (live.covered.map(shortName).find(Boolean) ?? matched) : matched;
  const gap = live ? (live.missing.map(shortName).find(Boolean) ?? undefined) : matchGap;

  return {
    resume: [
      ...(hasSummary ? ["Make the summary shorter"] : []),
      strongest ? `Emphasize ${strongest}` : "Emphasize leadership",
      // Something the profile lacks shows how the AI declines to invent it (APP-9).
      gap ? `Mention ${gap}` : "Mention accessibility",
    ],
    letter: [
      // The resume changes with the chat; the letter can be brought in line with it.
      "Rewrite it to match my latest resume",
      tone === Tone.FORMAL ? "Make it warmer" : "Make it more formal",
      "Shorter, under 200 words",
      ...(gap ? [`Handle the ${gap} gap differently`] : []),
    ],
    email: [
      "Shorter, under 100 words",
      tone === Tone.FORMAL ? "Make it warmer" : "Make it more formal",
      strongest ? `Lead with ${strongest}` : "Make the subject line stand out",
    ],
  };
}
