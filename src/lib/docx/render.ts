import { sectionOrder, type ResumeSection, type ResumeTemplate } from "@/lib/resume-template";
import "server-only";

import { AlignmentType, BorderStyle, Document, Header, LevelFormat, Packer, Paragraph, Tab, TabStopType, TextRun, type ParagraphChild } from "docx";

import { DateStyle, PaperSize, ThemeAlign, ThemeFont, type DateFormat, type Tone } from "@/generated/prisma/enums";
import { SIGN_OFF_UNIT, type Unit } from "@/lib/application-data";
import { documentLabels } from "@/lib/document-labels";
import { defaultFrame, isFrameUnit, withFrame, type FrameUnitId } from "@/lib/letter-frame";
import { datesInWords, type Basics, type ProfileData } from "@/lib/profile";
import { CONTACT_SEPARATOR, educationOnOneRow, resumeContent, runningHeader, type ResumeOptions } from "@/lib/resume-content";
import { compactGroups } from "@/lib/skill-groups";
import { DENSITIES, onOneLine, PAGE_WIDTH, THEME_FONTS, TITLE_SEPARATOR, titleLinePoints, type ThemeData } from "@/lib/themes";
import { TONES } from "@/lib/tones";

// Resumes and cover letters as Word files (.docx), next to the PDFs. The PDF
// is the theme's exact look; the Word file is for editing and for job sites
// that ask for one, so it's a single column in fonts every copy of Word has,
// with the theme's accent on the headings. The content is the same as the
// PDF's: resumeContent for a resume, the letter's units for a letter.

export const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Twentieths of a point: page sizes and margins. */
const PAGE: Record<PaperSize, { width: number; height: number }> = {
  [PaperSize.A4]: { width: 11906, height: 16838 },
  [PaperSize.LETTER]: { width: 12240, height: 15840 },
};
const MARGIN = 1080; // 0.75 in
const BULLETS = "bullets";

/** A font Word has everywhere, in the theme font's family. */
export function wordFont(font: ThemeFont): string {
  if (font === ThemeFont.PLEX_MONO || font === ThemeFont.JETBRAINS_MONO) return "Consolas";
  if (font === ThemeFont.SEGOE_UI) return "Segoe UI";
  return THEME_FONTS[font].serif ? "Cambria" : "Calibri";
}

type Look = { head: string; body: string; accent: string; textWidth: number; margin: { x: number; y: number }; nextToTitle: boolean; size: number; small: number; header?: readonly string[] };

function look(theme: ThemeData, paper: PaperSize, template?: ResumeTemplate | null): Look {
  // Twentieths of a point: 1,440 an inch.
  // The PDF's own margins (the theme's padding, in page units of PAGE_WIDTH across), so Word has the same room on every page.
  const padding = DENSITIES[theme.density];
  const units = (value: number) => Math.round((value / PAGE_WIDTH) * PAGE[paper].width);
  const margin = template ? { x: Math.round(template.marginX * 1440), y: Math.round(template.marginY * 1440) } : padding ? { x: units(padding.paddingX), y: units(padding.paddingY) } : { x: MARGIN, y: MARGIN };
  return { head: wordFont(theme.headFont), body: wordFont(theme.bodyFont), accent: theme.accent.replace("#", ""), textWidth: PAGE[paper].width - 2 * margin.x, margin, nextToTitle: theme.dateStyle === DateStyle.NEXT_TO_TITLE, size: theme.textPoints ? theme.textPoints * 2 : 21, small: theme.textPoints ? theme.textPoints * 2 : 19 };
}

/** A Word document; each part starts on a new page, in the first part's fonts. */
function document(paper: PaperSize, { body, margin, size, header }: Look, ...parts: Paragraph[][]): Document {
  return new Document({
    styles: { default: { document: { run: { font: body, size }, paragraph: { spacing: { after: 60, line: 264 } } } } },
    numbering: {
      config: [
        {
          reference: BULLETS,
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }],
        },
      ],
    },
    sections: parts.map((children) => ({
      // On later pages only: page one has the contact details already.
      ...(header?.length ? { headers: { first: new Header({ children: [] }), default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 0 }, children: [new TextRun({ text: header.join("  ·  "), size: 15, color: "9A9A9A" })] })] }) } } : {}),
      properties: { titlePage: Boolean(header?.length), page: { size: PAGE[paper], margin: { top: margin.y, right: margin.x, bottom: margin.y, left: margin.x } } },
      children,
    })),
  });
}

/** **bold** and *italic*, as citations are written, as runs. */
export function markedRuns(text: string): TextRun[] {
  return text
    .split(/(\*\*[^*]+\*\*|\*[^*]+\*)/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("**") && part.endsWith("**") && part.length > 4
        ? new TextRun({ text: part.slice(2, -2), bold: true })
        : part.startsWith("*") && part.endsWith("*") && part.length > 2
          ? new TextRun({ text: part.slice(1, -1), italics: true })
          : new TextRun(part),
    );
}

const plain = (text: string, options: { bold?: boolean; italics?: boolean; color?: string; after?: number } = {}) =>
  new Paragraph({ spacing: options.after === undefined ? undefined : { after: options.after }, children: [new TextRun({ text, bold: options.bold, italics: options.italics, color: options.color })] });

const bullet = (text: string) => new Paragraph({ numbering: { reference: BULLETS, level: 0 }, spacing: { after: 30 }, children: [new TextRun(text)] });

/** A section heading: small caps-style, in the accent, with a rule under it. */
const heading = (title: string, { head, accent }: Look) =>
  new Paragraph({
    spacing: { before: 240, after: 100 },
    keepNext: true,
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: accent, space: 2 } },
    children: [new TextRun({ text: title.toUpperCase(), bold: true, color: accent, font: head, size: 22, characterSpacing: 20 })],
  });

/** "Role, Company" with the dates at the right margin; or, in your template's way, the company below in a smaller font. */
const entryHead = (title: string, at: string, dates: string, { textWidth, nextToTitle, small, size }: Look, layout: ResumeTemplate["entry"], language: string, emphasis = false, before = 120): Paragraph[] => {
  const role = emphasis ? { italics: true, color: "002366", size: size + 4 } : {};
  if (nextToTitle && layout === "inline") {
    const head = new Paragraph({ keepNext: true, spacing: { before, after: at ? 0 : 40 }, children: [new TextRun({ text: title, bold: true, ...role }), ...(dates ? [new TextRun({ text: ` - ${datesInWords(dates, language)}`, ...role })] : [])] });
    return at ? [head, new Paragraph({ keepNext: true, spacing: { after: 40 }, children: [new TextRun({ text: at, size: small })] })] : [head];
  }
  const below = layout !== "inline";
  const beside = layout !== "company-below";
  const children: ParagraphChild[] = [new TextRun({ text: title, bold: true, ...role })];
  if (at && !below) children.push(new TextRun({ text: title ? `, ${at}` : at, ...role }));
  if (dates && beside) children.push(new TextRun({ children: [new Tab(), dates] }));
  const head = new Paragraph({ keepNext: true, spacing: { before, after: below ? 0 : 40 }, tabStops: [{ type: TabStopType.RIGHT, position: textWidth }], children });
  if (!below) return [head];
  const line = [at, beside ? "" : dates].filter(Boolean).join(" · ");
  return line ? [head, new Paragraph({ keepNext: true, spacing: { after: 40 }, children: [new TextRun({ text: line, size: small })] })] : [head];
};

const skillsUsed = (label: string, skills: string[], { accent, small }: Look) =>
  new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: `${label} · `, color: accent }), new TextRun({ text: skills.join(", "), size: small })] });

export type ResumeDocxProps = ResumeOptions & { theme: ThemeData; profile: ProfileData; paper: PaperSize; language?: string | null };

/** A resume as a Word file: the base resume from the profile, a tailored one from its units. */
export async function resumeDocx(props: ResumeDocxProps): Promise<Uint8Array> {
  const { style, children } = resumeParagraphs(props);
  return Packer.toBuffer(document(props.paper, style, children));
}

function resumeParagraphs({ theme, profile, paper, language, ...options }: ResumeDocxProps): { style: Look; children: Paragraph[] } {
  const { template } = options;
  const style = { ...look(theme, paper, template), header: runningHeader(profile.basics) };
  const labels = documentLabels(language);
  const content = resumeContent(profile, { ...options, hide: theme.hide }, labels);
  const entry = template?.entry ?? "inline";
  const centered = theme.align === ThemeAlign.CENTER && !template ? AlignmentType.CENTER : AlignmentType.LEFT;
  // "Name - Job title" on one row, all of it the name's size, smaller only to fit; the title not bold.
  const namePoints = template ? template.nameSize : 20;
  const nameSize = Math.round((content.headline ? titleLinePoints(`${content.name}${TITLE_SEPARATOR}${content.headline}`, theme.headFont, style.textWidth / 20, namePoints) : namePoints) * 2);
  const children: Paragraph[] = [
    new Paragraph({ alignment: centered, spacing: { after: 40 }, children: [new TextRun({ text: content.name, bold: true, font: style.head, size: nameSize }), ...(content.headline ? [new TextRun({ text: `${TITLE_SEPARATOR}${content.headline}`, font: style.head, size: nameSize })] : [])] }),
  ];
  const contactText = content.contacts.join(CONTACT_SEPARATOR);
  if (content.contacts.length > 0) children.push(new Paragraph({ alignment: centered, spacing: { after: 120 }, children: [new TextRun({ text: contactText, size: Math.round(onOneLine(contactText, theme.bodyFont, style.textWidth / 20) * 2) })] }));

  const sections: Record<ResumeSection, () => void> = {
    summary: () => {
  if (content.summary) children.push(heading(labels.profile, style), plain(content.summary));
    },
    experience: () => {
  if (content.experience.length > 0) {
    children.push(heading(labels.experience, style));
    let bare = false;
    for (const role of content.experience) {
      // After a job shown as its title line alone, the next sits close.
      children.push(...entryHead(role.role, role.company, role.dates, style, entry, labels.locale, true, bare ? 20 : 120));
      if (role.descriptor) children.push(plain(role.descriptor, { italics: true }));
      children.push(...role.bullets.map(bullet));
      const skills = role.skills.length > 0 && !theme.noRoleSkills;
      if (skills) children.push(skillsUsed(labels.skills, role.skills, style));
      bare = !role.descriptor && role.bullets.length === 0 && !skills;
    }
  }
    },
    projects: () => {
  if (content.projects.length > 0) {
    children.push(heading(labels.projects, style));
    for (const project of content.projects) {
      children.push(...entryHead(project.name, project.link, project.dates, style, entry, labels.locale), ...project.bullets.map(bullet));
      if (project.skills.length > 0 && !theme.noRoleSkills) children.push(skillsUsed(labels.skills, project.skills, style));
    }
  }
    },
    education: () => {
  if (content.education.length > 0) {
    children.push(heading(labels.education, style));
    if (educationOnOneRow(content.education)) {
      // The degrees on one line, the highest first.
      children.push(
        new Paragraph({
          spacing: { before: 60, after: 60 },
          children: content.education.flatMap((school, index) => [
            ...(index > 0 ? [new TextRun({ text: "  ·  " })] : []),
            new TextRun({ text: school.degree, bold: true }),
            ...(school.school ? [new TextRun({ text: `, ${school.school}` })] : []),
          ]),
        }),
      );
    } else {
      let bare = false;
      for (const school of content.education) {
        children.push(...entryHead(school.degree, school.school, school.dates, style, entry, labels.locale, false, bare ? 20 : 120));
        if (school.notes) children.push(plain(school.notes));
        bare = !school.notes;
      }
    }
  }
    },
    certifications: () => {
  if (content.certifications.length > 0) {
    children.push(heading(labels.certifications, style));
    children.push(plain(content.certifications.map((entry) => `\u2022 ${[entry.name, entry.detail].filter(Boolean).join(", ")}${entry.link ? ` ${entry.link}` : ""}`).join("   ")));
  }
    },
    publications: () => {
  if (content.publications.length > 0) {
    children.push(heading(labels.publications, style));
    for (const entry of content.publications) {
      children.push(new Paragraph({ spacing: { after: 80 }, children: [...markedRuns(entry.citation), ...(entry.link ? [new TextRun(` ${entry.link}`)] : [])] }));
    }
  }
    },
    skills: () => {
  // The sidebar's sections follow the main ones, as in a single-column theme.
  // Skills, then tools and platforms: the groups run across one paragraph, as Certifications do, each name once.
  const shown = new Set<string>();
  for (const [title, text] of [[labels.skills, content.skills], [labels.tools, content.tools]] as const) {
    if (!text) continue;
    const groups = compactGroups(text, shown);
    if (groups.length === 0) continue;
    children.push(heading(title, style));
    children.push(
      new Paragraph({
        children: groups.flatMap(({ label, names }, index) => [
          ...(index > 0 ? [new TextRun("  |  ")] : []),
          ...(label ? [new TextRun({ text: `${label}: `, bold: true })] : []),
          new TextRun(names.join(", ")),
        ]),
      }),
    );
  }
    },
    languages: () => {
  if (content.languages) children.push(heading(labels.languages, style), plain(content.languages));
    },
    references: () => {
  if (content.references.length > 0) {
    children.push(heading(labels.references, style));
    for (const reference of content.references) {
      children.push(plain(reference.name, { bold: true, after: 0 }));
      if (reference.role) children.push(plain(reference.role, { after: 0 }));
      if (reference.contact) children.push(plain(reference.contact));
    }
  }
    },
  };
  // The order the theme has, or your template's.
  for (const section of sectionOrder(template ?? { order: [] })) sections[section]();

  return { style, children };
}

export type LetterDocxProps = {
  theme: ThemeData;
  paper: PaperSize;
  basics: Basics;
  units: Unit[];
  company: string;
  location: string;
  tone: Tone;
  date: Date;
  dateFormat: DateFormat;
  language?: string | null;
};

/** A cover letter as a Word file, part for part as CoverLetterDocument draws it. */
export async function letterDocx(props: LetterDocxProps): Promise<Uint8Array> {
  const { style, children } = letterParagraphs(props);
  return Packer.toBuffer(document(props.paper, style, children));
}

/** The cover letter, then the resume on a new page, as one Word file: what an application went out with. */
export async function letterAndResumeDocx(letter: LetterDocxProps, resume: ResumeDocxProps): Promise<Uint8Array> {
  const first = letterParagraphs(letter);
  return Packer.toBuffer(document(resume.paper, first.style, first.children, resumeParagraphs(resume).children));
}

function letterParagraphs({ theme, paper, basics, units, company, location, tone, date, dateFormat, language }: LetterDocxProps): { style: Look; children: Paragraph[] } {
  const style = look(theme, paper);
  const parts = withFrame(units, defaultFrame({ basics, company, location, date, dateFormat, labels: documentLabels(language) }));
  const text = (id: FrameUnitId) => parts.find((unit) => unit.id === id)?.text.trim() ?? "";
  const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);
  const paragraphs = parts.filter((unit) => !isFrameUnit(unit.id) && unit.id !== SIGN_OFF_UNIT && unit.text.trim());
  const closing = parts.find((unit) => unit.id === SIGN_OFF_UNIT)?.text.trim() || TONES[tone].signOff;
  const [name = "", ...contactLines] = lines(text("sender"));

  const children: Paragraph[] = [
    new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: name, bold: true, font: style.head, size: 32 })] }),
    ...contactLines.map((line, index) => plain(line, { after: index === contactLines.length - 1 ? 360 : 0 })),
  ];
  if (text("date")) children.push(plain(text("date"), { after: 240 }));
  const recipient = lines(text("recipient"));
  children.push(...recipient.map((line, index) => plain(line, { after: index === recipient.length - 1 ? 240 : 0 })));
  if (text("greeting")) children.push(plain(text("greeting"), { after: 200 }));
  // A line break inside a paragraph stays one.
  const withBreaks = (value: string) => value.split("\n").map((line, index) => new TextRun(index === 0 ? { text: line } : { text: line, break: 1 }));
  children.push(...paragraphs.map((unit) => new Paragraph({ spacing: { after: 200 }, children: withBreaks(unit.text.trim()) })));
  children.push(plain(closing, { after: 480 }));
  if (text("signature")) children.push(plain(text("signature")));

  return { style, children };
}
