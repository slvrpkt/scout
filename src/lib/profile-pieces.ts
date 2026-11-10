import type { ProfileData } from "./profile";

/** One piece of profile text worth proofreading, with where it is in plain words. */
export type ProfilePiece = { where: string; text: string };

const SECTION_NAMES: Record<string, string> = {
  basics: "Basics",
  skills: "Skills",
  languages: "Languages",
  experience: "Experience",
  projects: "Projects",
  education: "Education",
  publications: "Publications",
  certifications: "Certifications",
  references: "References",
  facts: "Facts about me",
};

// Fields that aren't prose: ids, contact details, links, dates and settings.
const SKIP = /^(id|email|phone|url|link|href|website|linkedin|github|portfolio|birthDate|dateOfBirth|start|end|startDate|endDate|from|to|dates|year|month|level|kind|group|current|onResumes|showAge)$/i;
const NOT_WORDS = /^(https?:\/\/|www\.)|@|^[\d\s/.\-–]+$/;

const entryName = (entry: Record<string, unknown>): string => {
  for (const key of ["company", "name", "title", "degree", "role", "school", "citation", "text"]) {
    const value = entry[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 40);
  }
  return "";
};

/** Every piece of prose in the profile, so only the ones that changed since the last check are sent. */
export function profilePieces(profile: ProfileData): ProfilePiece[] {
  const pieces: ProfilePiece[] = [];
  const add = (where: string, value: unknown) => {
    if (typeof value !== "string") return;
    const text = value.trim();
    if (text.length > 1 && !NOT_WORDS.test(text)) pieces.push({ where, text });
  };
  for (const [section, value] of Object.entries(profile)) {
    const name = SECTION_NAMES[section] ?? section;
    if (Array.isArray(value)) {
      for (const entry of value as Record<string, unknown>[]) {
        const label = `${name}: ${entryName(entry)}`.replace(/: $/, "");
        for (const [key, field] of Object.entries(entry)) {
          if (SKIP.test(key)) continue;
          if (Array.isArray(field)) field.forEach((line, index) => add(`${label}, ${key === "bullets" ? "bullet" : key} ${index + 1}`, line));
          else add(`${label}, ${key}`, field);
        }
      }
    } else if (value && typeof value === "object") {
      for (const [key, field] of Object.entries(value)) if (!SKIP.test(key)) add(`${name}: ${key}`, field);
    }
  }
  return pieces;
}

/** The pieces whose text wasn't in `checked`: new or edited since the last proofread. */
export function changedPieces(pieces: readonly ProfilePiece[], checked: ReadonlySet<string>): ProfilePiece[] {
  return pieces.filter((piece) => !checked.has(piece.text));
}
