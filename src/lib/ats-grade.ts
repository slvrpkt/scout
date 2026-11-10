import type { Requirement } from "@/lib/application-data";
import type { ResumeContent } from "@/lib/resume-content";

// The ATS grade on a tailored resume: half Format, half Job match, as a letter
// with what to fix. Format follows the checks of career-ops' verify-ats
// (github.com/career-ops-hq/career-ops, MIT), read from what Scout is about to
// print rather than from a file, leaving out its font check: an ATS reads the
// text, and fonts aren't what it ranks. Job match is how much of what the
// posting asks for the resume covers, hard skills counting double, as
// scanners such as Jobscan rank them. Tips are worth a look but don't change
// the score. It's Scout's own measure: no applicant tracking system publishes
// one.

export const ATS_GOAL = 90;
export const ATS_ATTEMPTS = 3;

export type AtsGrade = {
  letter: "A" | "B" | "C" | "D" | "F";
  score: number;
  format: number;
  /** Share of what the posting asks for that's covered, hard skills counting double, or null when it lists nothing. */
  match: number | null;
  /** Each Format check, for why it got this score. */
  checks: { label: string; earned: number; points: number }[];
  /** What the posting asks for that the resume covers. */
  covered: string[];
  /** What to do about the format, in words. */
  fixes: string[];
  /** What the posting asks for that the resume doesn't cover yet, hard skills first. */
  missing: string[];
  /** Worth a look, but not part of the score. */
  tips: string[];
  /** What the posting asks that no resume can show: worth knowing before you apply. */
  beforeApplying: string[];
  /** The posting's top skills that are on the resume but not where a recruiter reads first, for Rewrite to Reach A. */
  placement: string[];
};

/** What else the grade looks at, from the profile and the posting. */
export type GradeExtras = {
  /** The posting's job title. */
  title?: string | null;
  /** The candidate's years of experience, overlapping roles counted once. */
  years?: number;
  /** The profile's own contact details, to see which made it onto the resume. */
  phone?: string;
  city?: string;
  linkedin?: string;
};

const STOP_WORDS = new Set(
  "a an and are as at be by can for from have in is it its of on or our required requirement strong the to we will with you your years year experience ability knowledge understanding excellent good must plus preferred".split(" "),
);

/** Names that mean the same thing: an acronym and its words, or two spellings. */
const SAME = [
  ["pmp", "project management professional"],
  ["pgmp", "program management professional"],
  ["capm", "certified associate in project management"],
  ["csm", "certified scrum master", "certified scrummaster"],
  ["scrum master", "scrummaster"],
  ["safe", "scaled agile framework", "scaled agile"],
  ["sasm", "safe advanced scrum master"],
  ["js", "javascript"],
  ["ts", "typescript"],
  ["ci/cd", "cicd", "continuous integration", "continuous delivery", "continuous deployment"],
  ["ml", "machine learning"],
  ["ai", "artificial intelligence"],
  ["ai/ml", "ai and ml", "artificial intelligence/machine learning"],
  ["nlp", "natural language processing"],
  ["mlops", "ml ops", "machine learning operations"],
  ["aws", "amazon web services"],
  ["gcp", "google cloud platform", "google cloud"],
  ["azure", "microsoft azure"],
  ["sdlc", "software development lifecycle", "software development life cycle"],
  ["qa", "quality assurance"],
  ["ux", "user experience"],
  ["ui", "user interface"],
  ["kpi", "kpis", "key performance indicators", "key performance indicator"],
  ["okr", "okrs", "objectives and key results"],
  ["pmo", "project management office"],
  ["ms project", "microsoft project"],
  ["power bi", "powerbi"],
  ["sql", "structured query language"],
  ["etl", "extract transform load"],
  ["bdd", "behavior driven development", "behavior-driven development"],
  ["tdd", "test driven development", "test-driven development"],
  ["devops", "dev ops"],
  ["saas", "software as a service"],
  ["hhs", "department of health and human services", "health and human services"],
  ["508", "section 508"],
];

const DEGREES: [RegExp, number][] = [
  [/\b(ph\.?\s?d|doctorate|doctoral)\b/i, 4],
  [/\b(master'?s?|m\.?\s?sc?\b|mba|m\.?\s?eng)\b/i, 3],
  [/\b(bachelor'?s?|b\.?\s?sc?\b|b\.?\s?a\b|b\.?\s?eng|undergraduate degree)\b/i, 2],
  [/\b(associate'?s? degree)\b/i, 1],
];

/** The degree level a text names, 0 for none. */
const degreeLevel = (text: string) => DEGREES.find(([pattern]) => pattern.test(text))?.[1] ?? 0;

/** What no resume can show, but can rule you out. */
const CANT_SHOW = /\b(clearance|public trust|citizen(ship)?|authori[sz]ed to work|work authori[sz]ation|sponsorship|visa|on-?site|in office|relocat\w*|travel up to|\d+% travel|drug (test|screen)|background check|driver'?s licen[cs]e|must reside)\b/i;

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#./]+/gu, " ")
    .split(" ")
    .map((word) => word.replace(/\.+$/, ""))
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));

/** Whether `name` is in `text` as whole words. */
const phrase = (text: string, name: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escaped(name)}($|[^\\p{L}\\p{N}])`, "iu").test(text);

/** "Project Management Professional (PMP)" anywhere: each name means the other, here. */
function pairsIn(text: string): string[][] {
  return [...text.matchAll(/([\p{L}][\p{L}\s&/-]{3,60}?)\s*\(([\p{Lu}0-9/&]{2,10})\)/gu)].map((match) => [match[2].toLowerCase(), match[1].trim().toLowerCase()]);
}

/** Every name that means the same as `name`, itself included. */
function namesFor(name: string, pairs: readonly string[][]): string[] {
  const lower = name.toLowerCase().trim();
  const groups = [...SAME, ...pairs].filter((group) => group.includes(lower));
  return [...new Set([lower, ...groups.flat()])];
}

/** A requirement's skill, under any of its names, else most of its meaningful words, appear in the text. */
function covers(words: ReadonlySet<string>, text: string, requirement: Pick<Requirement, "text" | "skill">, pairs: readonly string[][]): boolean {
  if (requirement.skill?.trim()) {
    return namesFor(requirement.skill, pairs).some((name) => phrase(text, name) || (wordsOf(name).length > 0 && wordsOf(name).every((word) => words.has(word))));
  }
  const wanted = wordsOf(requirement.text);
  if (wanted.length === 0) return true;
  return wanted.filter((word) => words.has(word) || namesFor(word, pairs).some((name) => phrase(text, name))).length / wanted.length >= 0.6;
}

/** How many times a skill shows, under any of its names. */
const timesIn = (text: string, name: string, pairs: readonly string[][]) =>
  namesFor(name, pairs).reduce((count, alias) => count + (text.match(new RegExp(`(^|[^\\p{L}\\p{N}])${escaped(alias)}(?=$|[^\\p{L}\\p{N}])`, "giu"))?.length ?? 0), 0);

export const letterOf = (score: number): AtsGrade["letter"] => (score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F");

/** The whole resume's text, for the checks. */
export function resumeWords(content: ResumeContent): string {
  return [
    content.name,
    content.headline,
    ...content.contacts,
    content.summary,
    ...content.experience.flatMap((role) => [role.role, role.company, role.descriptor, ...role.bullets, ...role.skills]),
    ...content.projects.flatMap((project) => [project.name, ...project.bullets, ...project.skills]),
    ...content.education.flatMap((entry) => [entry.degree, entry.school, entry.notes]),
    ...content.certifications.flatMap((entry) => [entry.name, entry.detail]),
    ...content.publications.map((entry) => entry.citation),
    content.skills,
    content.languages,
  ]
    .filter(Boolean)
    .join(" ");
}

/** The roles that count as current, and where a recruiter reads first. */
const RECENT_ROLES = 3;

export function atsGrade({
  content,
  sidebar,
  requirements,
  extras = {},
}: {
  content: ResumeContent;
  /** Whether it prints in two columns. */
  sidebar: boolean;
  /** What the posting asks for. Spoken languages are left to the match table. */
  requirements: readonly (Pick<Requirement, "text" | "skill"> & Partial<Pick<Requirement, "kind" | "years">>)[];
  extras?: GradeExtras;
}): AtsGrade {
  const text = resumeWords(content);
  const lower = text.toLowerCase();
  const pairs = pairsIn(`${text} ${requirements.map((requirement) => requirement.text).join(" ")}`);
  const fixes: string[] = [];
  const tips: string[] = [];
  // Images, the encoding and hidden text are fine by how Scout prints: 20 of the 100.
  const checks: AtsGrade["checks"] = [{ label: "Real text, no images, no hidden words, standard encoding", earned: 20, points: 20 }];
  const check = (label: string, earned: number, points: number) => checks.push({ label, earned, points });

  check("Enough text for an ATS to read", text.length >= 300 ? 15 : 0, 15);
  if (text.length < 300) fixes.push("Add more to the resume: there's very little text for an ATS to read.");

  const sections: [boolean, string][] = [
    [content.experience.length > 0, "Experience"],
    [content.education.length > 0, "Education"],
  ];
  check("Standard section headings: Experience, Education", (sections.filter(([present]) => present).length * 20) / sections.length, 20);
  for (const [present, name] of sections) {
    if (!present) fixes.push(`Add an ${name} section: an ATS looks for it by name.`);
  }

  // Contact details an ATS can read: the email counts most, then the phone and where you are.
  const contactText = content.contacts.join(" ");
  const email = contactText.includes("@");
  const phone = /\d{3}\D{0,3}\d{3}\D{0,3}\d{3,4}/.test(contactText);
  const city = extras.city?.trim();
  const place = city === undefined ? true : Boolean(city) && lower.includes(city.toLowerCase());
  check(city === undefined ? "Your email is on the resume" : "Contact details an ATS can read: email, phone and location", city === undefined ? (email ? 15 : 0) : (email ? 9 : 0) + (phone ? 3 : 0) + (place ? 3 : 0), 15);
  if (!email) fixes.push("Add your email in Profile → Basics.");
  if (city !== undefined && !phone) fixes.push("Add your phone number in Profile → Basics.");
  if (!place) fixes.push("Add your city and state in Profile → Basics: recruiters often search by location.");
  if (extras.linkedin !== undefined && !extras.linkedin.trim()) tips.push("Add your LinkedIn profile in Profile → Basics: recruiters look for it.");

  check("Single column", sidebar ? 0 : 30, 30);
  if (sidebar) fixes.push("Use a single column: a sidebar can scramble the reading order. Rewrite to Reach A does this for you.");

  // Job match: each skill and requirement, hard skills, years and degrees counting double.
  const words = new Set(wordsOf(text));
  const label = (requirement: Pick<Requirement, "text" | "skill">) => requirement.skill?.trim() || requirement.text.trim();
  const items: { label: string; weight: number; hard: boolean; met: boolean }[] = [];
  const beforeApplying: string[] = [];
  for (const requirement of requirements) {
    if (requirement.kind === "language") continue;
    if (CANT_SHOW.test(requirement.text)) {
      beforeApplying.push(requirement.text.trim());
      continue;
    }
    if (requirement.kind === "years") {
      if (requirement.years && extras.years !== undefined) items.push({ label: requirement.text.trim(), weight: 2, hard: true, met: extras.years >= requirement.years });
      continue;
    }
    const level = degreeLevel(requirement.text);
    if (level > 0 && !requirement.skill?.trim()) {
      const yours = Math.max(0, ...content.education.map((entry) => degreeLevel(entry.degree)));
      items.push({ label: requirement.text.trim(), weight: 2, hard: true, met: yours >= level });
      continue;
    }
    const hard = requirement.kind === "skill" && Boolean(requirement.skill?.trim());
    items.push({ label: label(requirement), weight: hard ? 2 : 1, hard, met: covers(words, lower, requirement, pairs) });
  }
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  const match = total > 0 ? Math.round((items.filter((item) => item.met).reduce((sum, item) => sum + item.weight, 0) / total) * 100) : null;
  const covered = items.filter((item) => item.met).map((item) => item.label);
  const missing = items.filter((item) => !item.met).toSorted((a, b) => Number(b.hard) - Number(a.hard)).map((item) => item.label);

  // Tips: what a recruiter skimming or searching notices. They don't change the score.
  const hardSkills = requirements.filter((requirement) => requirement.kind === "skill" && requirement.skill?.trim()).map((requirement) => requirement.skill!.trim());
  const top = hardSkills.slice(0, 5);
  const firstRead = [content.summary, ...content.experience.slice(0, 1).flatMap((role) => [role.role, ...role.bullets, ...role.skills])].join(" ");
  const placement = top.filter((skill) => timesIn(lower, skill, pairs) > 0 && timesIn(firstRead, skill, pairs) === 0);
  if (placement.length > 0) tips.push(`Recruiters read the summary and your newest role first. These skills from the posting are on the resume, but not there: ${placement.join(", ")}.`);

  const title = extras.title?.trim();
  if (title && !phrase(`${content.headline} ${content.summary}`, title)) tips.push(`Recruiters search by job title. "${title}" isn't in your title line or summary.`);

  const recent = content.experience.slice(0, RECENT_ROLES).flatMap((role) => [role.role, ...role.bullets, ...role.skills]).join(" ");
  const older = content.experience.slice(RECENT_ROLES).flatMap((role) => [role.role, ...role.bullets, ...role.skills]).join(" ");
  const olderOnly = hardSkills.filter((skill) => timesIn(older, skill, pairs) > 0 && timesIn(`${recent} ${content.summary}`, skill, pairs) === 0);
  if (olderOnly.length > 0) tips.push(`Only in older roles, so they can look out of date: ${olderOnly.join(", ")}. If you've used them lately, say so in a recent role.`);

  const once = top.filter((skill) => timesIn(lower, skill, pairs) === 1);
  if (once.length > 0) tips.push(`Mentioned only once: ${once.join(", ")}. A key skill reads stronger in two or three places, such as the summary and a role, and no more than that.`);

  const bullets = content.experience.flatMap((role) => role.bullets);
  const measured = bullets.filter((bullet) => /\d/.test(bullet)).length;
  if (bullets.length > 0 && measured / bullets.length < 0.3) tips.push(`${measured} of ${bullets.length} bullets have a number in them. Recruiters and ATS rankings favour results you can measure: where your profile has the figures, add them.`);

  const format = Math.round(checks.reduce((sum, { earned }) => sum + earned, 0));
  const score = match === null ? format : Math.round((format + match) / 2);
  return { letter: letterOf(score), score, format, match, checks, covered, fixes, missing, tips, beforeApplying, placement };
}
