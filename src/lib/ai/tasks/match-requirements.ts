import { z } from "zod";

import { matchSchema, type Extracted, type Match } from "@/lib/application-data";
import { experienceMonths, formatMonthYear, languageLevelLabel, sameName, type ProfileData } from "@/lib/profile";

import { profileForPrompt, system, UNTRUSTED_POSTING, type Task } from "./prompt-parts";

export const MATCH_REQUIREMENTS_VERSION = "match-requirements@3";

// The model says which profile skill or language each requirement is about,
// and, reading the whole background, whether the profile shows it. Code
// decides covered, partial or gap: from the profile's skills when one fits,
// so that part stays deterministic (NEW-4, E7-4), and from the model's
// verdict and its named evidence for the rest (degrees, duties, experience).
const verdicts = ["shown", "implied", "not_shown"] as const;
const answerSchema = z.object({
  matches: z.array(
    z.object({
      /** The requirement's number in the list. */
      requirement: z.number().int(),
      /** A skill from the profile's list, spelled as there, or null. */
      skill: z.string().nullable(),
      /** A language from the profile's list, or null. */
      language: z.string().nullable(),
      /** Whether the whole profile shows it: outright, implied by what it does show, or not at all. */
      verdict: z.preprocess((value) => value ?? "not_shown", z.enum(verdicts)),
      /** What in the profile shows or implies it, named, e.g. "B.S. in Computer Science, State University". */
      evidence: z.preprocess((value) => value ?? "", z.string()),
    }),
  ),
});

const INSTRUCTIONS = `You compare a job's requirements with a candidate's whole background: education, roles and what they did in them, projects, skills, certifications and languages.

For each numbered requirement:
- skill: which ONE of the candidate's skills it is about, if any, copied exactly as it appears in candidateSkills. Match on meaning ("Strong prototyping skills in Figma" is about "Figma"; "Has built or maintained a design system" is about "Design systems"), but don't stretch: when no skill really fits, null.
- language: which of the candidate's languages it is about, if any, or null.
- verdict: whether the profile as a whole shows the candidate meets it.
  - "shown": the profile states it, in a degree, a role, a bullet, a skill or a certification.
  - "implied": nothing states it, but what the profile shows makes it very likely, e.g. "produced artifacts for all phases of the SDLC" is implied by roles as a developer, a business or QA analyst and a project manager; "stakeholder communication" by years leading client projects. Not a guess: something named in the profile must point to it.
  - "not_shown": nothing in the profile shows or implies it. A named tool, product, certification or license (PMP, Jira, a CPA) is never implied: it's shown or not.
- evidence: for "shown" and "implied", what in the profile backs it, named, in a few words, e.g. "B.S. in Information Technology, George Mason University" or "Developer at Acme, BA at Initech, PM at Globex". Empty for "not_shown".

Degrees: judge the level and the field. A higher degree meets a lower one (a master's meets "a bachelor's"). Computer science, information technology, information systems, any engineering (nanosystems included), math, statistics, data science (applied data science included), physics and business analytics are STEM and technology fields; "or a related field" takes in close neighbours. "Or equivalent experience" is met by enough years in the field. Never call a requirement not_shown when the profile shows it. Answer every requirement once.`;

export type MatchInput = {
  requirements: Extracted["requirements"];
  profile: ProfileData;
  today?: Date;
  /** This job's resume as the candidate edited it, when regrading it: what it says is theirs to say, and counts as shown. */
  resumeText?: string;
};

/** NEW-4: each requirement covered, partial or a gap, with its evidence. */
export const matchRequirements: Task<MatchInput, Match> = async (provider, { requirements, profile, today = new Date(), resumeText = "" }, { signal }) => {
  const needsModel = requirements.some((requirement) => requirement.kind !== "years");
  const answer = needsModel
    ? await provider.complete({
        system: system(INSTRUCTIONS, UNTRUSTED_POSTING),
        messages: [
          {
            role: "user",
            content: [
              `The requirements:\n${JSON.stringify(
                requirements.map((requirement, index) => ({ number: index, text: requirement.text, kind: requirement.kind, skill: requirement.skill })),
                null,
                2,
              )}`,
              `candidateSkills: ${JSON.stringify(profile.skills.map((skill) => skill.name))}`,
              `candidateLanguages: ${JSON.stringify(profile.languages.map((language) => language.name))}`,
              `The candidate's whole profile:\n${profileForPrompt(profile)}`,
              ...(resumeText.trim()
                ? [
                    `The candidate's resume for this job, as they edited it. What it says is true for them: it counts as shown, like the profile, and evidence from it names the resume part, e.g. "your resume's Fieldnote role":\n${resumeText.trim().slice(0, 30_000)}`,
                  ]
                : []),
            ].join("\n\n"),
          },
        ],
        schema: answerSchema,
        schemaName: "requirement_matches",
        creativity: "FAITHFUL",
        effort: "low",
        signal,
      })
    : { matches: [] };

  const mapped = new Map(answer.matches.map((match) => [match.requirement, match]));
  return {
    data: matchSchema.parse({
      items: requirements.map((requirement, index) => classify(requirement, mapped.get(index), profile, today)),
    }),
    promptVersion: MATCH_REQUIREMENTS_VERSION,
  };
};

type Item = Match["items"][number];

function classify(
  requirement: Extracted["requirements"][number],
  mapped: { skill: string | null; language: string | null; verdict?: (typeof verdicts)[number]; evidence?: string } | undefined,
  profile: ProfileData,
  today: Date,
): Item {
  const base = { requirement: requirement.text, skill: null, experienceIds: [] as string[], note: null };

  if (requirement.kind === "years") {
    const dated = profile.experience.filter((entry) => entry.startYear !== null);
    if (dated.length === 0) return { ...base, result: "gap", note: "Add your experience to check this" };
    const first = dated.reduce(
      (earliest, entry) => (entry.startYear! * 12 + (entry.startMonth ?? 1) < earliest.startYear! * 12 + (earliest.startMonth ?? 1) ? entry : earliest),
      dated[0],
    );
    const count = profile.experience.length;
    const roles = `${count} ${count === 1 ? "role" : "roles"} in your profile, since ${formatMonthYear(first.startYear, first.startMonth)}`;
    const years = Math.floor(experienceMonths(profile, today) / 12);
    return years >= (requirement.years ?? 0)
      ? { ...base, result: "covered", note: roles }
      : { ...base, result: "gap", note: `${roles} (about ${years} ${years === 1 ? "year" : "years"})` };
  }

  // Names must be the profile's own: a model can't add a skill by misspelling one.
  const language = profile.languages.find(
    (entry) => (mapped?.language && sameName(entry.name, mapped.language)) || (requirement.language && sameName(entry.name, requirement.language)),
  );
  if (requirement.kind === "language" || (language && !mapped?.skill)) {
    return language
      ? { ...base, result: "covered", skill: language.name, note: `${language.name}: ${languageLevelLabel(language.level)}` }
      : { ...base, result: "gap", note: "Not in your profile" };
  }

  // The model's pick first, then the skill the posting names; spelling may differ a little.
  const skill =
    profile.skills.find((entry) => mapped?.skill && sameSkill(entry.name, mapped.skill)) ??
    profile.skills.find((entry) => requirement.skill && sameSkill(entry.name, requirement.skill));
  if (!skill) {
    // No skill of the profile's fits: the reading of the whole background decides, with what backs it.
    const evidence = mapped?.evidence?.trim().slice(0, 200) ?? "";
    if (mapped?.verdict === "shown" && evidence) return { ...base, result: "covered", note: evidence };
    if (mapped?.verdict === "implied" && evidence) return { ...base, result: "partial", note: `Implied by ${evidence}; worth naming outright` };
    return {
      ...base,
      result: "gap",
      note: requirement.kind === "skill" ? "Not in your profile yet" : "Not shown in your profile",
    };
  }
  const roles = profile.experience.filter((entry) => entry.skillIds.includes(skill.id));
  return roles.length > 0
    ? {
        ...base,
        result: "covered",
        skill: skill.name,
        experienceIds: roles.map((entry) => entry.id),
        note: `Used at ${[...new Set(roles.map((entry) => entry.company || entry.role))].join(", ")}`,
      }
    : { ...base, result: "partial", skill: skill.name, note: "In your skills, but not linked to a role yet" };
}

/**
 * Whether two skill names mean the same skill, forgiving case, punctuation
 * and a plural: "Design system" is "Design systems", "UX-research" is "UX research".
 */
export function sameSkill(a: string, b: string): boolean {
  const key = (name: string) =>
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(" ")
      .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word))
      .join(" ");
  return key(a) === key(b);
}
