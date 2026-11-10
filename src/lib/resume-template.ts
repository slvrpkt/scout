import { z } from "zod";

import type { Basics } from "@/lib/profile";

// "Your template": the layout read from a resume you uploaded (Base resume →
// Import a theme). While there is one, base and tailored resumes follow its
// margins, title, section order and job layout, in a single column; the
// theme still gives the fonts and color. The file itself isn't kept.

/** A resume's sections, in the order they print without a template. */
// The default order: Education near the end, right before Certifications.
export const RESUME_SECTIONS = ["summary", "experience", "projects", "publications", "skills", "languages", "education", "certifications", "references"] as const;
export type ResumeSection = (typeof RESUME_SECTIONS)[number];

export const CONTACT_KINDS = ["location", "email", "phone", "website", "linkedin"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const resumeTemplateSchema = z.object({
  fileName: z.string().max(200),
  /** Page margins, in inches. */
  marginX: z.number().min(0.2).max(2),
  marginY: z.number().min(0.2).max(2),
  /** The name's size at the top of the first page, in points. */
  nameSize: z.number().min(9).max(40),
  /** Whether a job title shows under the name. */
  headline: z.boolean(),
  /** What the title shows besides the name, in order. */
  contacts: z.array(z.enum(CONTACT_KINDS)),
  /** The sections found, in order; any others follow. */
  order: z.array(z.enum(RESUME_SECTIONS)),
  /** A job's lines: all on one, company on its own smaller line with the dates, or with the dates beside the title. */
  entry: z.enum(["inline", "company-below", "company-below-dates-right"]),
});
export type ResumeTemplate = z.infer<typeof resumeTemplateSchema>;

/** The sections in the template's order, then the rest. */
export const sectionOrder = (template: Pick<ResumeTemplate, "order">): ResumeSection[] => [...new Set([...template.order, ...RESUME_SECTIONS])];

/** What the title shows besides the name, from the profile. */
export function templateContacts(basics: Basics, { contacts }: Pick<ResumeTemplate, "contacts">): string[] {
  const values: Record<ContactKind, string> = {
    location: [basics.city, basics.state].map((part) => part.trim()).filter(Boolean).join(", "),
    email: basics.email,
    phone: basics.phone,
    website: basics.website,
    linkedin: basics.linkedin,
  };
  return contacts.map((kind) => values[kind].trim()).filter(Boolean);
}

export type LayoutLine = { text: string; size: number };
export type ResumeLayout = { marginX: number; marginY: number; lines: LayoutLine[] };

const HEADINGS: Record<ResumeSection, readonly string[]> = {
  summary: ["summary", "professional summary", "career summary", "executive summary", "profile", "professional profile", "about", "about me", "objective", "career objective"],
  experience: ["experience", "work experience", "professional experience", "relevant experience", "employment", "employment history", "work history", "career history"],
  projects: ["projects", "selected projects", "key projects", "personal projects"],
  education: ["education", "education and training", "academic background"],
  certifications: ["certifications", "certificates", "licenses", "licenses and certifications", "certifications and licenses"],
  publications: ["publications", "selected publications"],
  skills: ["skills", "technical skills", "key skills", "core skills", "core competencies", "competencies", "areas of expertise", "expertise"],
  languages: ["languages"],
  references: ["references"],
};

const headingOf = (text: string): ResumeSection | null => {
  const words = text.toLowerCase().replace(/&/g, "and").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  return RESUME_SECTIONS.find((section) => HEADINGS[section].includes(words)) ?? null;
};

const EMAIL = /[^\s|·•,]+@[^\s|·•,]+\.[a-z]{2,}/i;
const PHONE = /\+?\d[\d\s().-]{7,}\d/;
const LINKEDIN = /linkedin\.com/i;
const WEBSITE = /(https?:\/\/|www\.)\S+|\b[\w-]+\.(com|org|net|io|dev|me)\b/i;
const LOCATION = /^[\p{L} .'-]+,\s*[\p{L} .'-]+(\s+\d{4,5})?$/u;
const DATES = /\b(19|20)\d{2}\b|\bpresent\b/i;
const BULLET = /^\s*[•·▪◦‣*-]\s/;

const kindOf = (fragment: string): ContactKind | null => {
  if (EMAIL.test(fragment)) return "email";
  if (LINKEDIN.test(fragment)) return "linkedin";
  if (WEBSITE.test(fragment)) return "website";
  if (PHONE.test(fragment)) return "phone";
  return LOCATION.test(fragment) ? "location" : null;
};

/** The template a resume's layout makes, or null when it has too few sections to go by. */
export function templateFromLayout({ marginX, marginY, lines }: ResumeLayout, fileName: string): ResumeTemplate | null {
  const round = (value: number, step: number) => Number((Math.round(value / step) * step).toFixed(2));
  const headings = lines.flatMap((line, index) => {
    const section = headingOf(line.text);
    return section ? [{ section, index }] : [];
  });
  const order = [...new Set(headings.map((heading) => heading.section))];
  if (order.length < 2 || headings[0].index === 0) return null;

  const fragments = lines
    .slice(1, headings[0].index)
    .flatMap((line) => line.text.split(/\s*[|·•]\s*|\s{3,}/))
    .map((fragment) => fragment.trim())
    .filter(Boolean);
  const kinds = fragments.map(kindOf);

  const experience = headings.find((heading) => heading.section === "experience")?.index;
  const [first, second] = experience === undefined ? [] : lines.slice(experience + 1, experience + 3);
  const twoLines = first && second && !BULLET.test(first.text) && !BULLET.test(second.text) && !headingOf(second.text);

  return resumeTemplateSchema.parse({
    fileName: fileName.slice(0, 200),
    marginX: Math.min(2, Math.max(0.2, round(marginX, 0.05))),
    marginY: Math.min(2, Math.max(0.2, round(marginY, 0.05))),
    nameSize: Math.min(40, Math.max(9, round(lines[0].size, 0.5))),
    headline: kinds.includes(null),
    contacts: [...new Set(kinds.filter((kind) => kind !== null))],
    order,
    entry: !twoLines ? "inline" : DATES.test(first.text) ? "company-below-dates-right" : "company-below",
  });
}

const SECTION_NAMES: Record<ResumeSection, string> = {
  summary: "Summary",
  experience: "Experience",
  projects: "Projects",
  education: "Education",
  certifications: "Certifications",
  publications: "Publications",
  skills: "Skills",
  languages: "Languages",
  references: "References",
};

/** What was taken from the file, in words, one line each. */
export function templateSummary(template: ResumeTemplate): string[] {
  const title = [template.headline ? "job title" : "", ...template.contacts].filter(Boolean).join(", ");
  return [
    `Margins: ${template.marginX.toFixed(2)} in at the sides, ${template.marginY.toFixed(2)} in top and bottom`,
    `Name size: ${template.nameSize} pt`,
    `Title: name${title ? `, ${title}` : ""}`,
    `Order: ${template.order.map((section) => SECTION_NAMES[section]).join(", ")}`,
    `Jobs: ${template.entry === "inline" ? "title and company on one line" : "title, then company in a smaller font, then dates"}`,
  ];
}
