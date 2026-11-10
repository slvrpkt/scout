/**
 * The profile's sections, in order, for the Profile page only: nothing the AI
 * reads or a resume shows follows it. Optional ones don't count towards Profile strength (#216).
 */
export const SECTIONS = [
  {
    id: "basics",
    optional: false,
    label: "Basics",
    title: "The basics",
    hint: "How employers can reach you. Only what you choose to show ends up on a resume.",
  },
  {
    id: "experience",
    optional: true,
    label: "Experience",
    title: "Work experience",
    hint: "Add the roles you're proud of. Rough bullet points are totally fine: each application gets its own polished version.",
  },
  {
    id: "education",
    optional: true,
    label: "Education",
    title: "Education",
    hint: "Degrees, courses, certificates: anything that helps tell your story.",
  },
  {
    id: "certifications",
    optional: true,
    label: "Certifications",
    title: "Certifications",
    hint: "Licenses and certifications, as on LinkedIn. Every field is optional; they go on resumes word for word, in the order you set here.",
  },
  {
    id: "skills",
    optional: true,
    label: "Skills & languages",
    title: "Skills & languages",
    hint: "Type one and press Enter. Attach them to each role under Experience so the AI knows where you used them.",
  },
  {
    id: "tools",
    optional: true,
    label: "Tools & platforms",
    title: "Tools & platforms",
    hint: "The tools, platforms and services you've worked with. Just add them: Scout sorts them into categories on your Full resume.",
  },
  {
    id: "projects",
    optional: true,
    label: "Projects",
    title: "Projects",
    hint: "Side projects, open source, coursework or a thesis: things you built that show what you can do, especially when your roles don't say it yet.",
  },
  {
    id: "publications",
    optional: true,
    label: "Publications",
    title: "Publications",
    hint: "Papers, articles, books or chapters, cited your way. They go on resumes word for word, in the order you set here.",
  },
  {
    id: "references",
    optional: true,
    label: "References",
    title: "References",
    hint: "People who'll vouch for you. They stay private unless you include them.",
  },
  {
    id: "facts",
    optional: true,
    label: "Facts about me",
    title: "Facts about me",
    hint: "What the AI should know about you that the rest of your profile doesn't say. It reads these when it writes your resumes and cover letters, and never copies them onto a resume as a list.",
  },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

/** The section in `?section=`, or Basics when it's missing or unknown. */
export function sectionFromParam(value: string | string[] | undefined): SectionId {
  return SECTIONS.find((section) => section.id === value)?.id ?? "basics";
}

export const sectionHref = (id: SectionId) => `/profile?section=${id}`;
