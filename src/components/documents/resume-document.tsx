import { Fragment, type CSSProperties, type ReactElement, type ReactNode } from "react";

import { CitationText } from "@/components/citation";
import type { PaperSize, ThemeLayout } from "@/generated/prisma/enums";
import { cn } from "@/lib/cn";
import { documentLabels } from "@/lib/document-labels";
import { documentLanguage } from "@/lib/document-language";
import { datesInWords, type ProfileData } from "@/lib/profile";
import { CONTACT_SEPARATOR, educationOnOneRow, resumeContent, type ResumeContent, type ResumeOptions } from "@/lib/resume-content";
import { compactGroups } from "@/lib/skill-groups";
import { sectionOrder, type ResumeTemplate } from "@/lib/resume-template";
import { HEADER_POINTS, onOneLine, PAGE_WIDTH, PAPER_SIZES, pointsToUnits, resolveTheme, TITLE_SEPARATOR, titleLinePoints, withTemplate, type ThemeData } from "@/lib/themes";

import { Contact, ContactLine, DocumentPage, DocumentSection, plainUnit, type UnitRenderer } from "./document-page";
import styles from "./document.module.css";

type ResumeDocumentProps = ResumeOptions & {
  theme: ThemeData;
  profile: ProfileData;
  paper: PaperSize;
  /** Overrides the theme's layout, e.g. a tailored resume in a single column. */
  layout?: ThemeLayout;
  /** The language it's written in (SET-7), for its headings too; without one, it's read from the text and the headings are English. */
  language?: string | null;
  /** Draws each tailored part; the preview's adds editing (E8-3). */
  renderUnit?: UnitRenderer;
};

/** Enough of a resume's own words to tell its script and direction. */
const sampleText = (content: ResumeContent) =>
  [
    content.name,
    content.headline,
    content.summary,
    ...content.experience.flatMap((role) => [role.role, ...role.bullets]),
    ...content.projects.flatMap((project) => [project.name, ...project.bullets]),
  ].join(" ");

/**
 * A resume (RES-1, RES-6, APP-4), the same markup for the preview and the
 * PDF. The base resume passes the profile alone; a tailored resume also
 * passes its units, which replace the profile's text.
 *
 * Sections without content are left out. Each tailored part is drawn by
 * `renderUnit` with its unit id, for editing it in place (E8-3).
 */
export function ResumeDocument({ theme, profile, paper, layout, language, renderUnit = plainUnit, ...options }: ResumeDocumentProps) {
  const { template } = options;
  // Your template is one column, with its own margins and title.
  const resolved = withTemplate(resolveTheme(theme, template ? "SINGLE" : layout), template, paper);
  const entry = template?.entry ?? "inline";
  const labels = documentLabels(language);
  const content = resumeContent(profile, { ...options, hide: theme.hide }, labels);
  const { lang, dir } = documentLanguage(language, sampleText(content));

  const sidebar = [
    resolved.split && content.contacts.length > 0 && (
      <DocumentSection key="contact" title={labels.contact}>
        <ul className={styles.contactList}>
          {content.contacts.map((item, index) => (
            <li key={index}>
              <Contact>{item}</Contact>
            </li>
          ))}
        </ul>
      </DocumentSection>
    ),
    content.skills && (
      <DocumentSection key="skills" title={labels.skills}>
        {renderUnit({ id: "skills", children: <SkillGroups text={content.skills} /> })}
      </DocumentSection>
    ),
    content.tools && (
      <DocumentSection key="tools" title={labels.tools}>
        <SkillGroups text={content.tools} skills={content.skills} />
      </DocumentSection>
    ),
    content.languages && (
      <DocumentSection key="languages" title={labels.languages}>
        {renderUnit({ id: "languages", children: <p>{content.languages}</p> })}
      </DocumentSection>
    ),
    // Always the last thing on the resume.
    content.certifications.length > 0 && (
      <DocumentSection key="certifications" title={labels.certifications}>
        <ul className={styles.inlineList}>
          {content.certifications.map((entry) => (
            <li key={entry.id}>
              {[entry.name, entry.detail].filter(Boolean).join(", ")}
              {entry.link && (
                <>
                  {" "}
                  {entry.href ? (
                    <a href={entry.href} target="_blank" rel="noreferrer" className={styles.link}>
                      <Contact>{entry.link}</Contact>
                    </a>
                  ) : (
                    <Contact>{entry.link}</Contact>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </DocumentSection>
    ),
  ].filter(Boolean);

  const main = [
    content.summary && (
      <DocumentSection key="summary" title={labels.profile}>
        {renderUnit({ id: "summary", children: <p className={styles.summary}>{content.summary}</p> })}
      </DocumentSection>
    ),
    content.experience.length > 0 && (
      <DocumentSection key="experience" title={labels.experience}>
        {content.experience.map((role) => (
          <Fragment key={role.id}>
            {renderUnit({
              id: `experience:${role.id}`,
              // A job shown as its title line alone sits close to the next.
              className: cn(styles.entry, !role.descriptor && role.bullets.length === 0 && (role.skills.length === 0 || theme.noRoleSkills) && styles.bare),
              head: <EntryHead emphasis title={role.role} at={role.company} dates={role.dates} timeline={resolved.timeline} nextToTitle={resolved.nextToTitle} lang={labels.locale} layout={entry} />,
              children: (
                <>
                  {role.descriptor && <p className={styles.descriptor}>{role.descriptor}</p>}
                  {role.bullets.length > 0 && (
                    <ul className={styles.bullets}>
                      {role.bullets.map((bullet, index) => (
                        <li key={index}>{bullet}</li>
                      ))}
                    </ul>
                  )}
                  {role.skills.length > 0 && !theme.noRoleSkills && (
                    <p className={styles.entrySkills}>
                      <span className={styles.accent}>{`${labels.skills} · `}</span>
                      {role.skills.join(", ")}
                    </p>
                  )}
                </>
              ),
            })}
          </Fragment>
        ))}
      </DocumentSection>
    ),
    content.projects.length > 0 && (
      <DocumentSection key="projects" title={labels.projects}>
        {content.projects.map((project) => (
          <Fragment key={project.id}>
            {renderUnit({
              id: `project:${project.id}`,
              className: styles.entry,
              head: (
                <EntryHead
                  title={project.name}
                  at={project.link && <Contact>{project.link}</Contact>}
                  dates={project.dates}
                  timeline={resolved.timeline}
                  nextToTitle={resolved.nextToTitle}
                  lang={labels.locale}
                  layout={entry}
                />
              ),
              children: (
                <>
                  {project.bullets.length > 0 && (
                    <ul className={styles.bullets}>
                      {project.bullets.map((bullet, index) => (
                        <li key={index}>{bullet}</li>
                      ))}
                    </ul>
                  )}
                  {project.skills.length > 0 && !theme.noRoleSkills && (
                    <p className={styles.entrySkills}>
                      <span className={styles.accent}>{`${labels.skills} · `}</span>
                      {project.skills.join(", ")}
                    </p>
                  )}
                </>
              ),
            })}
          </Fragment>
        ))}
      </DocumentSection>
    ),
    content.education.length > 0 && (
      <DocumentSection key="education" title={labels.education}>
        <div className={cn(educationOnOneRow(content.education) && styles.educationRow)}>
        {content.education.map((school) => (
          <Fragment key={school.id}>
            {renderUnit({
              id: `education:${school.id}`,
              className: cn(styles.entry, !school.notes && styles.bare),
              head: <EntryHead title={school.degree} at={school.school} dates={school.dates} timeline={resolved.timeline} nextToTitle={resolved.nextToTitle} lang={labels.locale} layout={entry} />,
              children: school.notes && <p className={styles.muted}>{school.notes}</p>,
            })}
          </Fragment>
        ))}
        </div>
      </DocumentSection>
    ),
    content.publications.length > 0 && (
      <DocumentSection key="publications" title={labels.publications}>
        {content.publications.map((entry) => (
          <Fragment key={entry.id}>
            {renderUnit({
              id: `publication:${entry.id}`,
              className: styles.publication,
              children: (
                <p>
                  <CitationText text={entry.citation} />
                  {entry.link && (
                    <>
                      {" "}
                      {entry.href ? (
                        <a href={entry.href} target="_blank" rel="noreferrer" className={styles.link}>
                          <Contact>{entry.link}</Contact>
                        </a>
                      ) : (
                        <span className={styles.link}>
                          <Contact>{entry.link}</Contact>
                        </span>
                      )}
                    </>
                  )}
                </p>
              ),
            })}
          </Fragment>
        ))}
      </DocumentSection>
    ),
    content.references.length > 0 && (
      <DocumentSection key="references" title={labels.references}>
        <div className={styles.references}>
          {content.references.map((reference) => (
            <div key={reference.id}>
              <p className={styles.entryTitle}>{reference.name}</p>
              {reference.role && <p className={styles.muted}>{reference.role}</p>}
              {reference.contact && <p>{reference.contact}</p>}
            </div>
          ))}
        </div>
      </DocumentSection>
    ),
  ].filter(Boolean);

  // Education sits near the end: right before Certifications in one column,
  // at the foot of the main column (before References) beside a sidebar.
  const keyOf = (section: unknown) => (section as ReactElement).key;
  const educationAt = main.findIndex((section) => keyOf(section) === "education");
  if (!template && educationAt >= 0) {
    const [education] = main.splice(educationAt, 1);
    const [list, before] = resolved.split ? [main, "references"] : [sidebar, "certifications"];
    const at = list.findIndex((section) => keyOf(section) === before);
    list.splice(at < 0 ? list.length : at, 0, education);
  }

  // Reading order matches what you see: the sidebar comes first in sidebar
  // layouts (and keeps its column even when empty) unless it's at the end of
  // the line, and its sections follow the main ones in a single column.
  const inOrder = template && sectionOrder(template).flatMap((id) => [...main, ...sidebar].filter((section) => (section as ReactElement).key === id));
  const columns = inOrder
    ? [inOrder]
    : !resolved.split
    ? [main, sidebar].filter((sections) => sections.length > 0)
    : resolved.sidebarEnd
      ? [main, sidebar]
      : [sidebar, main];
  // A tinted sidebar is drawn as a panel, unless there's nothing in it.
  const panel = resolved.tintedSidebar && sidebar.length > 0 ? sidebar : null;

  // The job title and contact details, large enough to read at a glance, and the contacts on one row.
  const textWidth = PAGE_WIDTH - 2 * resolved.density.paddingX;
  const pointsWide = (textWidth * (PAPER_SIZES[paper].widthMm / PAGE_WIDTH) * 72) / 25.4;
  // "Name - Job title" on one row, the title as large as the name but not bold.
  const namePoints = (resolved.name.size * (PAPER_SIZES[paper].widthMm / PAGE_WIDTH) * 72) / 25.4;
  const titleLine = content.headline ? `${content.name}${TITLE_SEPARATOR}${content.headline}` : "";
  const headerStyle = {
    "--header-text": pointsToUnits(HEADER_POINTS, paper),
    ...(titleLine ? { "--title-line-text": pointsToUnits(titleLinePoints(titleLine, theme.headFont, pointsWide, namePoints), paper) } : {}),
    "--contact-text": pointsToUnits(onOneLine(content.contacts.join(CONTACT_SEPARATOR), theme.bodyFont, pointsWide), paper),
  } as CSSProperties;

  const title = (
    <>
      {/* The job's title sits beside the name, so the header stays at two lines. */}
      <div className={cn(styles.titleLine, content.headline && styles.withTitle)}>
        <h1 className={styles.name}>{content.name}</h1>
        {content.headline && <span aria-hidden="true" className={styles.titleBar}>-</span>}
        {content.headline &&
          (options.units?.some((unit) => unit.id === "headline") ? (
            renderUnit({ id: "headline", children: <p className={styles.headline}>{content.headline}</p> })
          ) : (
            <p className={styles.headline}>{content.headline}</p>
          ))}
      </div>
      {!resolved.split && content.contacts.length > 0 && <ContactLine items={content.contacts} />}
    </>
  );

  return (
    <DocumentPage theme={resolved} paper={paper} lang={lang} dir={dir} label="Resume">
      <header className={styles.header} style={headerStyle}>
        {title}
      </header>
      <div className={styles.columns}>
        {columns.map((sections, index) => (
          <div key={index} className={cn(styles.column, sections === panel && styles.sidebarPanel)}>
            {sections}
          </div>
        ))}
      </div>
    </DocumentPage>
  );
}

/** "Sep 2015 – May 2018" that, in a narrow column, only wraps after the dash. */
const breakAfterDash = (dates: string) =>
  dates
    .split(" – ")
    .map((part) => part.replaceAll(" ", " "))
    .join(" – ");

/**
 * "Senior Product Designer, Northwind Logistics" with the dates at the end of
 * the line, or before it in a timeline column (the dates come first then, so
 * they float into the column next to the title).
 */
function EntryHead({ title, at, dates, timeline, nextToTitle, lang, layout, emphasis = false }: { emphasis?: boolean; title: string; at: ReactNode; dates: string; timeline: boolean; nextToTitle: boolean; lang: string; layout: ResumeTemplate["entry"] }) {
  const datesSpan = dates && <span className={styles.dates}>{timeline ? breakAfterDash(dates) : dates}</span>;
  if (layout !== "inline") {
    // Your template's way: the title, then the company in a smaller font, then the dates.
    const beside = layout === "company-below-dates-right";
    return (
      <div className={styles.entryStack}>
        <div className={styles.entryHead}>
          <p className={cn(styles.entryTitle, emphasis && styles.roleLine)}>{title}</p>
          {beside && datesSpan}
        </div>
        {(at || (!beside && dates)) && (
          <p className={styles.entryCompany}>
            {at}
            {at && !beside && dates && " · "}
            {!beside && dates}
          </p>
        )}
      </div>
    );
  }
  if (nextToTitle) {
    return (
      <div className={styles.entryStack}>
        <p className={cn(emphasis && styles.roleLine)}>
          <span className={styles.entryTitle}>{title}</span>
          {dates && ` - ${datesInWords(dates, lang)}`}
        </p>
        {at && <p className={styles.entryCompany}>{at}</p>}
      </div>
    );
  }
  return (
    <div className={styles.entryHead}>
      {timeline && datesSpan}
      <p className={cn(emphasis && styles.roleLine)}>
        <span className={styles.entryTitle}>{title}</span>
        {at && (
          <>
            {title && ", "}
            {at}
          </>
        )}
      </p>
      {!timeline && datesSpan}
    </div>
  );
}

/**
 * The Skills (or Tools & platforms) section, as compact as Certifications:
 * the groups run across the line, each led by its name in bold, and each name
 * once. Tools & platforms leaves out what Skills already names.
 */
function SkillGroups({ text, skills }: { text: string; skills?: string }) {
  const shown = new Set<string>();
  if (skills) compactGroups(skills, shown);
  return (
    <ul className={cn(styles.inlineList, styles.skillGroups)}>
      {compactGroups(text, shown).map(({ label, names }, index) => (
        <li key={index}>
          {label && <strong className={styles.skillLabel}>{label}: </strong>}
          {names.join(", ")}
        </li>
      ))}
    </ul>
  );
}
