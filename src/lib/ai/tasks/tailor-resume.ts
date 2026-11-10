import { z } from "zod";

import type { AIProvider } from "@/lib/ai/provider";
import { unitsSchema, type Extracted, type Match, type Unit } from "@/lib/application-data";
import { publicationLabel } from "@/lib/citation";
import { documentLabels, ENGLISH_LABELS, languagesLine, type DocumentLabels } from "@/lib/document-labels";
import { fewSkills } from "@/lib/resume-content";
import { resumePublications, type ProfileData } from "@/lib/profile";
import { bulletBudgets, byRecency } from "@/lib/resume-fit";

import { guardSources, guardUnits } from "../fact-guard";

import {
  applicationFacts,
  postingForPrompt,
  READ_THE_POSTING,
  TAILORED_VOICE,
  candidateFacts,
  CREATIVITY,
  jobForPrompt,
  languageRule,
  NO_EM_DASHES,
  outcomeWriting,
  humanizeRules,
  profileForPrompt,
  system,
  truthfulness,
  UNTRUSTED_POSTING,
  type TaskOptions,
  type TaskResult,
} from "./prompt-parts";

export const TAILOR_RESUME_VERSION = "tailor-resume@26";

const answerSchema = z.object({
  /** The job title at the top of this resume. */
  headline: z.preprocess((value) => value ?? "", z.string()),
  summary: z.string(),
  roles: z.array(z.object({ id: z.string(), bullets: z.array(z.string()), skills: z.preprocess((value) => value ?? [], z.array(z.string())) })),
  projects: z.array(z.object({ id: z.string(), bullets: z.array(z.string()) })),
  education: z.array(z.object({ id: z.string(), notes: z.string() })),
  /** The Skills and the Tools & Platforms sections, for this job: groups of the profile's own names. */
  skillGroups: z.preprocess((value) => value ?? [], z.array(z.object({ group: z.string(), names: z.array(z.string()) }))),
  toolGroups: z.preprocess((value) => value ?? [], z.array(z.object({ group: z.string(), names: z.array(z.string()) }))),
  /** Two pages only: why this job is worth a third, or null. */
  thirdPageReason: z.preprocess((value) => value ?? null, z.string().nullable()),
  /** Ideas for the candidate to vet, which would make this a better match. */
  suggestions: z.preprocess((value) => value ?? [], z.array(z.string())),
});
type Answer = Omit<z.infer<typeof answerSchema>, "thirdPageReason" | "headline" | "suggestions" | "roles" | "skillGroups" | "toolGroups"> & {
  headline?: string;
  roles: { id: string; bullets: string[]; skills?: string[] }[];
  skillGroups?: { group: string; names: string[] }[];
  toolGroups?: { group: string; names: string[] }[];
};

const INSTRUCTIONS = `You tailor a candidate's resume to one job, as JSON.

The profile may hold far more than fits: every role, project, skill, degree and fact the candidate wrote is material to choose from. Choose what this job can use best, and leave out what it can't. Align all of it with the job description: lead with what the posting asks for, and say it in the posting's own terms wherever the profile backs them, without claiming anything the profile doesn't show.

- headline: the job title at the top of the resume. Use this posting's title when the candidate's experience backs it up, as it does when they've done the same kind of work under a similar title; otherwise leave it empty, and the candidate's usual title is used. Never put certifications or anything else here.
- summary: 2–3 sentences in the first person without "I" at the start of every sentence, about the candidate as this job would see them.
- roles: every role from the profile, by id, with as many bullets as "Bullets per role" gives it: choose that many of the role's points, the ones that matter most to this job, and rewrite them for it. Two closely related points may become one bullet. Put each role's bullets in order of importance to this job, the most important first: when the resume runs long, bullets go from the end. Make sure each of the posting's requirements that the profile backs is covered by at least one bullet somewhere. Keep each bullet to one line, and start with a verb.
- projects: every project from the profile, by id, with 1–3 bullets each, written like the roles' bullets: what was built and what it shows that this job cares about.
- roles' skills: for each role, only the few skills from the candidate's skill list that this job cares about most and that this role used, most relevant first. They print on one line under its bullets, so usually 3 to 6 and never more than fit one line. Use the posting's own word when it means the same as the candidate's, e.g. "CI/CD pipelines" for "Continuous Delivery". Only skills the role's bullets or the skill list back.
- education: every entry by id, with its notes shortened or left empty.
- skillGroups: the resume's Skills section, for this job. From the candidate's skills only: first the ones this posting asks for or would value, then the closely related ones around them that make the candidate stronger for it. In a few groups with short headings that fit this job (the candidate's own headings where they fit), the most relevant group and name first. Use each name as the candidate wrote it, or the posting's word for the same thing. Leave out what doesn't help this job.
- toolGroups: the resume's Tools & Platforms section, the same way, from the candidate's tools and platforms only.
- thirdPageReason: null, unless told otherwise below.
- suggestions: up to 5 short ideas for the candidate to vet, each one sentence, for what would make this resume a better match. Name what the posting asks for that the profile doesn't show or shows weakly, and say what to add if it's true for them, e.g. "The posting asks for Jira. If you've used it, add it to your Northwind Logistics role." Never assume it's true, and never put these on the resume. An empty list when there's nothing worth raising.
- The profile's publications go on the resume word for word, so don't answer with them; the summary may mention them.`;

/** So applicant tracking systems see the match: the posting's own words for what the candidate has really done. */
const JOB_WORDING = `Only each role's title, employer, location and dates stay exactly as they are. Rewrite every bullet you choose for this job: keep what the candidate did and say the same thing in the words this job uses, leading with the part it cares about. A bullet copied with small changes isn't good enough, even where the job is a close match. The resume has no skills section, so also work the skills this job cares about into the bullets of the roles where they were used. Rewording never adds a fact: no new tools, numbers, results, clients or certifications.

Match the posting's language as closely as you can. Wherever a responsibility or requirement in the posting matches what the candidate has done, rewrite their content to use the posting's exact words and phrases, as many as fit naturally, so an applicant tracking system recognizes the match.

You may also state work that the candidate's content strongly implies but doesn't spell out, when it's very likely they did it as part of that role. This covers duties only. It never covers employers, job titles, dates, numbers, results, tools, certifications or degrees, which must come from the profile as they are. If it's only a guess, leave it out.`;

/** SET-9: what "Resume length" asks for. Over a limit, the resume is trimmed afterwards (E10-10); with none, nothing is left out. */
function pageFit(maxPages: number | null | undefined): string | null {
  if (maxPages === 1) {
    return "The resume has to fit on one page: keep the summary to two sentences, make every bullet short, and keep education and project notes to a few words.";
  }
  if (maxPages === 2) {
    return "The resume has to fit on two pages: keep the summary to three sentences, and keep education and project notes short. Write it for two pages either way. Two pages is right for nearly every job. Only in the rare case where this job's requirements and the candidate's relevant experience truly can't be done justice in two pages, set thirdPageReason to one plain sentence telling the candidate why a third page would be worth it for this job; otherwise leave it null.";
  }
  if (maxPages === 3) {
    return "The resume may run to three pages, and no further: keep the summary to three sentences, and use the extra room for more detail on the older roles, the projects and the education notes where this job can use it. Don't pad it to fill the pages.";
  }
  if (maxPages === null) {
    return "There is no page limit, so keep everything the candidate wrote: every role and project, older ones included, keeps every point as a bullet of its own, every skill stays, and education notes stay in full. Only clean up the wording: clear, correct and consistent. This comes before anything about fewer bullets or leaving things out.";
  }
  return null;
}

export type TailorInput = {
  profile: ProfileData;
  extracted: Extracted;
  match: Match | null;
  /** What the candidate tells the AI for this application (APP-15). */
  facts: string[];
  /** The posting as pasted, for the fact guard. */
  posting: string;
  /** What the posting asks for that the last version didn't cover. */
  focus?: readonly string[];
};

/**
 * APP-4: the tailored resume as units (summary, each role, each project,
 * skills, each degree, each publication, languages). At two pages, also why
 * this job would be worth a third, in the rare case it would.
 */
export const tailorResume = async (
  provider: AIProvider,
  { profile, extracted, match, facts, posting, focus = [] }: TailorInput,
  options: TaskOptions,
): Promise<TaskResult<Unit[]> & { thirdPageReason: string | null; suggestions: string[] }> => {
  const answer = await provider.complete({
    system: system(
      INSTRUCTIONS,
      READ_THE_POSTING,
      pageFit(options.maxPages),
      truthfulness(options.strict),
      JOB_WORDING,
      outcomeWriting("tailored"),
      candidateFacts(profile, facts),
      CREATIVITY[options.creativity],
      languageRule(options.language),
      UNTRUSTED_POSTING,
      NO_EM_DASHES,
      TAILORED_VOICE,
      humanizeRules(options.humanize),
    ),
    messages: [
      {
        role: "user",
        cached: `The candidate's profile:\n${profileForPrompt(profile)}`,
        content: [
          `The job:\n${jobForPrompt(extracted, match)}`,
          // The whole posting, not only its requirements: what the job is really about.
          posting.trim() && `The posting, in full:\n${postingForPrompt(posting)}`,
          `Bullets per role:\n${bulletsPerRole(profile, options.maxPages)}`,
          applicationFacts(facts),
          focus.length > 0 &&
            `The last version didn't cover these, in the posting's words. Work in each one the profile backs, using those words; leave out any it doesn't:\n${focus.map((item) => `- ${item}`).join("\n")}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "tailored_resume",
    creativity: options.creativity,
    signal: options.signal,
  });
  // The languages line in the resume's language: the chosen one, or the posting's. Each role keeps to its budget, and with no limit everything stays.
  const units = resumeUnits(profile, options.maxPages === null ? keepEverything(profile, answer) : capRoles(profile, answer, options.maxPages), documentLabels(options.language ?? extracted.language));
  // E6-6: in strict mode, note what the profile and posting don't back.
  return {
    data: options.strict ? guardUnits(units, guardSources(profile, extracted, posting, facts)) : units,
    promptVersion: TAILOR_RESUME_VERSION,
    thirdPageReason: (options.maxPages === 2 && answer.thirdPageReason?.trim().slice(0, 300)) || null,
    suggestions: answer.suggestions.map((idea) => idea.trim().slice(0, 300)).filter(Boolean).slice(0, 5),
  };
};

const pointsIn = (bullets: string) => bullets.split("\n").filter((line) => line.trim()).length;

/** Each role's budget (resume-fit.ts): chosen from its points, more for the recent roles; null with no limit. */
function roleBudgets(profile: ProfileData, maxPages?: number | null) {
  return bulletBudgets(profile.experience.map((entry) => ({ ...entry, bullets: pointsIn(entry.bullets) })), maxPages);
}

/** "Bullets per role" for the prompt, most recent first. */
export function bulletsPerRole(profile: ProfileData, maxPages?: number | null): string {
  const budgets = roleBudgets(profile, maxPages);
  return byRecency(profile.experience)
    .map((id) => {
      const entry = profile.experience.find((role) => role.id === id)!;
      const name = [entry.role.trim(), entry.company.trim()].filter(Boolean).join(" at ") || "Untitled role";
      const has = pointsIn(entry.bullets);
      const budget = budgets?.get(id);
      if (!budget) return `- ${id} (${name}): all ${has} of its points, each its own bullet`;
      const count = budget.min === budget.max ? `${budget.max}` : `${budget.min} to ${budget.max}`;
      return `- ${id} (${name}): ${count}, chosen from its ${has} points`;
    })
    .join("\n");
}

/** A role the model gave more bullets than its budget keeps its first ones, the most important to this job. */
export function capRoles(profile: ProfileData, answer: Answer, maxPages?: number | null): Answer {
  const budgets = roleBudgets(profile, maxPages);
  if (!budgets) return answer;
  return {
    ...answer,
    roles: answer.roles.map((role) => (budgets.has(role.id) ? { ...role, bullets: role.bullets.slice(0, budgets.get(role.id)!.max) } : role)),
  };
}

/**
 * No limit: what the candidate wrote all stays. A role or project the model
 * gave fewer bullets, or education notes it emptied, keeps the profile's own
 * (resumeUnits).
 */
export function keepEverything(profile: ProfileData, answer: Answer): Answer {
  const whole = (entries: { id: string; bullets: string[] }[], written: { id: string; bullets: string }[]) =>
    entries.filter((entry) => entry.bullets.length >= pointsIn(written.find((item) => item.id === entry.id)?.bullets ?? ""));
  return {
    ...answer,
    roles: whole(answer.roles, profile.experience),
    projects: whole(answer.projects, profile.projects),
    education: answer.education.filter((entry) => entry.notes.trim()),
  };
}

/**
 * Turns the answer into units, trusting nothing: unknown roles, projects and
 * degrees are dropped, and a role or
 * project the model skipped keeps its bullets from the profile. The publications and languages
 * come from the profile, publications word for word (#218), and languages with their levels in
 * the words of `labels`.
 */
export function resumeUnits(profile: ProfileData, answer: Answer, labels: DocumentLabels = ENGLISH_LABELS): Unit[] {
  const roles = new Map(answer.roles.map((role) => [role.id, role.bullets]));
  const projects = new Map(answer.projects.map((project) => [project.id, project.bullets]));
  const notes = new Map(answer.education.map((entry) => [entry.id, entry.notes]));
  const roleSkills = new Map(answer.roles.map((role) => [role.id, fewSkills([...new Set((role.skills ?? []).map((skill) => skill.trim()).filter(Boolean))])]));
  const headline = answer.headline?.trim();
  const units: Unit[] = [
    ...(headline ? [{ id: "headline", label: "Job title", text: headline }] : []),
    { id: "summary", label: "Summary", text: answer.summary.trim() },
    // Skills, and Tools & Platforms, chosen and grouped for this job from the profile's own.
    ...sectionUnit("skills", "Skills", answer.skillGroups ?? [], profile.skills.filter((item) => (item.kind ?? "SKILL") === "SKILL")),
    ...sectionUnit("tools", "Tools & platforms", answer.toolGroups ?? [], profile.skills.filter((item) => item.kind === "TOOL")),
    ...profile.experience.map((entry) => {
      const bullets = (roles.get(entry.id) ?? entry.bullets.split("\n")).map((line) => line.trim()).filter(Boolean);
      return { id: `experience:${entry.id}`, label: `${entry.company || entry.role} role`, text: bullets.join("\n") };
    }),
    // The skills line under each job, in this job's words.
    ...profile.experience.flatMap((entry) => (roleSkills.get(entry.id)?.length ? [{ id: `role-skills:${entry.id}`, label: `${entry.company || entry.role} skills`, text: roleSkills.get(entry.id)!.join(", ") }] : [])),
    ...profile.projects.map((entry) => {
      const bullets = (projects.get(entry.id) ?? entry.bullets.split("\n")).map((line) => line.trim()).filter(Boolean);
      return { id: `project:${entry.id}`, label: `${entry.name || "Untitled"} project`, text: bullets.join("\n") };
    }),
    ...profile.education.map((entry) => ({
      id: `education:${entry.id}`,
      label: entry.degree || entry.school,
      text: (notes.get(entry.id) ?? entry.notes).trim(),
    })),
    ...resumePublications(profile.publications).map((entry) => ({
      id: `publication:${entry.id}`,
      label: publicationLabel(entry.citation),
      text: entry.citation.trim(),
    })),
    {
      id: "languages",
      label: "Languages",
      text: languagesLine(profile.languages, labels),
    },
  ];
  return unitsSchema.parse(units);
}

/**
 * A Skills or Tools & Platforms section as a unit, "Group: a · b" a line,
 * trusting nothing: only names the profile has in that section, each once,
 * as the profile spells them; empty groups left out.
 */
function sectionUnit(id: "skills" | "tools", label: string, groups: readonly { group: string; names: string[] }[], known: readonly { name: string }[]) {
  const seen = new Set<string>();
  const lines = groups.flatMap(({ group, names }) => {
    const kept = names.flatMap((name) => {
      const match = known.find((item) => item.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (!match || seen.has(match.name.toLowerCase())) return [];
      seen.add(match.name.toLowerCase());
      return [match.name];
    });
    const heading = group.replace(/[:·\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
    return kept.length > 0 ? [`${heading ? `${heading}: ` : ""}${kept.join(" · ")}`] : [];
  });
  return lines.length > 0 ? [{ id, label, text: lines.join("\n") }] : [];
}
