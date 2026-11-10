import { templateContacts, type ResumeTemplate } from "@/lib/resume-template";
import type { Unit } from "@/lib/application-data";
import { ageLabel, ENGLISH_LABELS, languagesLine, type DocumentLabels } from "@/lib/document-labels";
import { publicationHref, publicationLink } from "@/lib/citation";
import { ageOn, formatDateRange, formatMonthYear, resumeCertifications, resumePublications, type Basics, type CertificationItem, type ProfileData, isSkill } from "@/lib/profile";
import { inEditorOrder, skillsText, withoutNames } from "@/lib/skill-groups";
import { withCurrentIds } from "@/lib/unit-ids";

// What a resume shows, worked out from the profile (the base resume) or from
// a tailored document's units, so the renderer only has to lay it out.

export type ResumeContent = {
  name: string;
  headline: string;
  /** Email, phone, "City, Country", website, LinkedIn and "Age N", whichever are filled in. */
  contacts: string[];
  summary: string;
  experience: {
    id: string;
    role: string;
    company: string;
    /** A line about the company or the role (#257), as written; never tailored. */
    descriptor: string;
    dates: string;
    bullets: string[];
    /** The skills used in the role (RES-6). */
    skills: string[];
  }[];
  /** Projects (PRO-13), laid out like roles. */
  projects: {
    id: string;
    name: string;
    /** "github.com/jane/tidewater", without "https://". */
    link: string;
    dates: string;
    bullets: string[];
    skills: string[];
  }[];
  education: { id: string; degree: string; school: string; dates: string; notes: string }[];
  /** Publications (#218), word for word, in the profile's order. */
  publications: {
    id: string;
    /** As written, with **bold** and *italic*. */
    citation: string;
    /** "doi.org/10.1038/…", without "https://". */
    link: string;
    /** What the link opens, or null when it isn't a web address. */
    href: string | null;
  }[];
  /** Certifications, word for word from the profile, on every resume (tailored ones too). */
  certifications: { id: string; name: string; detail: string; link: string; href: string | null }[];
  /** "Figma · User research · …" */
  skills: string;
  /** The Full resume's tools and platforms, a line per category the AI sorted them into; empty elsewhere. */
  tools: string;
  /** "Dutch: Native · English: Fluent (C2)" */
  languages: string;
  references: { id: string; name: string; role: string; contact: string }[];
};

export type ResumeOptions = {
  /** A tailored document's units; they replace the profile's text (APP-4). */
  units?: Unit[];
  /** Settings → "Include references" (SET-9). */
  includeReferences?: boolean;
  /** The base resume's short summary, and what it was written from. */
  baseSummary?: { from: string; text: string } | null;
  /** For "Age N"; defaults to now. */
  today?: Date;
  /**
   * The base resume's two-page rule (resume-fit.ts, base-resume.ts): each
   * job's bullets as the fit chose them, by experience id, and the projects
   * and publications it left out ("project:<id>", "publication:<id>").
   * Ignored for tailored resumes.
   */
  condense?: { bullets: Record<string, string[]>; leftOut: string[] } | null;
  /** Your template's layout (resume-template.ts): it decides what the title shows. */
  template?: ResumeTemplate | null;
  /** The base resume's Skills and Tools & Platforms sections, every point of the profile's, at every length. */
  skillsList?: boolean;
  /**
   * Left out to fit, as the last resort before the recent jobs are
   * shortened: certifications ("certification:<id>") and tools and platforms
   * ("tool:<name in lower case>") with no bearing on the job; and on the
   * two-page base resume, the skills ("skill:<name>"), tools and
   * certifications its bottom third has no room for.
   */
  hide?: readonly string[];
};

/** The separator between contact details on one line. */
export const CONTACT_SEPARATOR = "  ·  ";

/** Contact details in the order the resume header lists them. */
export function contactItems(basics: Basics, today = new Date(), labels = ENGLISH_LABELS): string[] {
  const age = basics.showAge ? ageOn(basics.dob, today) : null;
  return [
    basics.email,
    basics.phone,
    [basics.city, basics.state].map((part) => part.trim()).filter(Boolean).join(", "),
    basics.website,
    basics.linkedin,
    age === null ? "" : ageLabel(age, labels),
  ]
    .map((item) => item.trim())
    .filter(Boolean);
}

/** A link as a resume shows it: "https://www.example.com/x/" is "example.com/x". */
export const displayLink = (link: string) =>
  link
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** About one printed line; two at the very most, for a single long name. */
const SKILLS_LINE = 95;

/** As many skills as fit the line under a job, the most relevant being first. */
export function fewSkills(skills: readonly string[]): string[] {
  const kept: string[] = [];
  let length = 0;
  for (const skill of skills) {
    if (kept.length > 0 && length + skill.length + 2 > SKILLS_LINE) break;
    kept.push(skill);
    length += skill.length + 2;
  }
  return kept;
}

/** How high a degree is, from its name: a doctorate 4, a master's 3, a bachelor's 2, anything else 1. */
export function degreeRank(degree: string): number {
  if (/\b(ph\.?\s?d|d\.?phil|doctor(ate)?)\b/i.test(degree)) return 4;
  if (/\b(master'?s?|m\.?\s?sc|m\.?\s?s|m\.?\s?a|mba|m\.?\s?eng|m\.?\s?ed)\b/i.test(degree)) return 3;
  if (/\b(bachelor'?s?|b\.?\s?sc|b\.?\s?s|b\.?\s?a|b\.?\s?eng|b\.?\s?tech)\b/i.test(degree)) return 2;
  return 1;
}

/** Whether the degrees fit on one line: none shows a year or notes. */
export const educationOnOneRow = (education: readonly { dates: string; notes: string }[]) => education.length > 1 && education.every((school) => !school.dates && !school.notes);

/** What the resume shows, with its dates and levels in the words of `labels`. */
export function resumeContent(
  profile: ProfileData,
  { units: given, hide = [], includeReferences = false, today = new Date(), condense = null, template = null, baseSummary, skillsList = false }: ResumeOptions = {},
  labels: DocumentLabels = ENGLISH_LABELS,
): ResumeContent {
  const { basics } = profile;
  // Units whose job, project or degree has a new id are matched to it by label (unit-ids.ts).
  const units = given && withCurrentIds(given, profile);
  const skillNames = new Map(profile.skills.map((skill) => [skill.id, skill.name]));
  const dates = { locale: labels.locale, present: labels.present };
  // The base resume's two-page rule: what it left out (condense).
  const leftOut = new Set(condense?.leftOut ?? []);

  const experience = (entry: ProfileData["experience"][number], bullets: string) => ({
    id: entry.id,
    role: entry.role.trim(),
    // Where the company is, on the job's line.
    company: [entry.company, entry.location].map((part) => part.trim()).filter(Boolean).join(", "),
    descriptor: entry.descriptor.trim(),
    dates: formatDateRange(entry, dates),
    bullets: lines(bullets),
    skills: fewSkills(entry.skillIds.flatMap((id) => skillNames.get(id) ?? [])),
  });
  const project = (entry: ProfileData["projects"][number], bullets: string) => ({
    id: entry.id,
    name: entry.name.trim(),
    link: displayLink(entry.link),
    dates: formatDateRange(entry, dates),
    bullets: lines(bullets),
    skills: entry.skillIds.flatMap((id) => skillNames.get(id) ?? []),
  });
  const publication = (entry: ProfileData["publications"][number], citation: string) => ({
    id: entry.id,
    citation: citation.trim(),
    link: displayLink(publicationLink(entry.link)),
    href: publicationHref(entry.link),
  });
  const education = (entry: ProfileData["education"][number], notes: string) => ({
    id: entry.id,
    degree: entry.degree.trim(),
    school: entry.school.trim(),
    // The graduation year alone, only when it's switched on in Profile → Education.
    dates: entry.showYear === true && entry.endYear ? String(entry.endYear) : "",
    notes: notes.trim(),
  });

  const content: ResumeContent = {
    name: basics.name.trim() || "Your name",
    // Beside the name, always: a tailored resume's own, else the profile's.
    headline: template && !template.headline ? "" : basics.headline.trim(),
    contacts: template ? templateContacts(basics, template) : contactItems(basics, today, labels),
    // The base resume's short version, while it still matches what you wrote.
    summary: baseSummary?.from === basics.summary.trim() ? baseSummary.text : basics.summary.trim(),
    experience: profile.experience.map((entry) => {
      const shown = experience(entry, entry.bullets);
      const fitted = condense?.bullets[entry.id];
      return fitted ? { ...shown, bullets: fitted } : shown;
    }),
    projects: profile.projects.filter((entry) => !leftOut.has(`project:${entry.id}`)).map((entry) => project(entry, entry.bullets)),
    education: profile.education.map((entry) => education(entry, entry.notes)),
    publications: resumePublications(profile.publications)
      .filter((entry) => !leftOut.has(`publication:${entry.id}`))
      .map((entry) => publication(entry, entry.citation)),
    certifications: resumeCertifications(profile.certifications).map((entry) => certification(entry, labels)),
    // A line per group, as Profile → Skills shows them (#280): on the Full
    // version only. Shorter resumes have them in the jobs' bullets instead.
    skills: skillsList && !units ? skillsText(inEditorOrder(profile.skills.filter(isSkill))) : "",
    tools: skillsList && !units ? skillsText(inEditorOrder(profile.skills.filter((item) => !isSkill(item)))) : "",
    languages: languagesLine(profile.languages, labels),
    references: includeReferences
      ? profile.references.map((reference) => ({
          id: reference.id,
          name: reference.name.trim(),
          role: [reference.relation, reference.company].map((part) => part.trim()).filter(Boolean).join(", "),
          contact: [reference.email, reference.phone].map((part) => part.trim()).filter(Boolean).join(" · "),
        }))
      : [],
  };

  if (units) {
    // A tailored resume holds exactly what its units hold, in their order:
    // a role, project, degree or publication without a unit was left out on purpose.
    const text = (id: string) => units.find((unit) => unit.id === id)?.text ?? "";
    const withUnit = <T extends { id: string }>(prefix: string, entries: T[]) =>
      units.flatMap((unit) => {
        if (!unit.id.startsWith(prefix)) return [];
        const entry = entries.find(({ id }) => `${prefix}${id}` === unit.id);
        return entry ? [{ entry, text: unit.text }] : [];
      });

    if (text("headline").trim() && (!template || template.headline)) content.headline = text("headline").trim();
    content.summary = text("summary").trim();
    content.languages = text("languages").trim();
    // A tailored resume's Skills and Tools & Platforms, chosen for its job.
    content.skills = text("skills").trim();
    content.tools = text("tools").trim();
    content.experience = withUnit("experience:", profile.experience).map(({ entry, text: bullets }) => {
      // The skills line in this job's words, when it was written for it.
      const skills = text(`role-skills:${entry.id}`).split(", ").map((skill) => skill.trim()).filter(Boolean);
      const shown = experience(entry, bullets);
      return skills.length > 0 ? { ...shown, skills: fewSkills(skills) } : shown;
    });
    content.projects = withUnit("project:", profile.projects).map(({ entry, text }) => project(entry, text));
    content.education = withUnit("education:", profile.education).map(({ entry, text }) =>
      education(entry, text),
    );
    content.publications = withUnit("publication:", profile.publications).flatMap(({ entry, text }) =>
      text.trim() ? [publication(entry, text)] : [],
    );
  }

  // The highest degree first: a doctorate, then a master's, then a bachelor's, then the rest, each as listed.
  content.education = content.education.toSorted((a, b) => degreeRank(b.degree) - degreeRank(a.degree));

  if (hide.length > 0) {
    const hidden = new Set(hide);
    content.certifications = content.certifications.filter((entry) => !hidden.has(`certification:${entry.id}`));
    content.tools = withoutNames(content.tools, new Set(hide.filter((id) => id.startsWith("tool:")).map((id) => id.slice("tool:".length))));
    content.skills = withoutNames(content.skills, new Set(hide.filter((id) => id.startsWith("skill:")).map((id) => id.slice("skill:".length))));
  }

  return content;
}

/** "Mar 2024" from "2024-03"; "" when not given. */
function monthLabel(value: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  return match ? formatMonthYear(Number(match[1]), Number(match[2]), { locale }) : "";
}

/** A certification as a resume shows it: its name, then "Issuer · Issued Mar 2024 · Expires Mar 2027 · ID 123". */
function certification(entry: CertificationItem, labels: DocumentLabels): ResumeContent["certifications"][number] {
  const issued = monthLabel(entry.issuedOn, labels.locale);
  const expires = entry.noExpiry ? "" : monthLabel(entry.expiresOn, labels.locale);
  const href = /^https?:\/\//i.test(entry.url.trim()) ? entry.url.trim() : null;
  return {
    id: entry.id,
    name: entry.name.trim(),
    detail: [entry.issuer.trim(), issued && `Issued ${issued}`, expires && `Expires ${expires}`, entry.credentialId.trim() && `ID ${entry.credentialId.trim()}`]
      .filter(Boolean)
      .join(" · "),
    link: displayLink(entry.url.trim()),
    href,
  };
}

/** The faded lines at the top right of a resume's later pages: name, email and phone. */
export const runningHeader = ({ name, email, phone }: Pick<Basics, "name" | "email" | "phone">) => [name, email, phone].map((line) => line.trim()).filter(Boolean);
