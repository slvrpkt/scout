import type { Unit } from "@/lib/application-data";
import { formatDateRange, type ProfileData } from "@/lib/profile";

// A tailored resume's own headings: each job's title, company, place and dates, and
// where you live in the header, changed for this resume alone (say the next
// town over, or a company's new name). The profile never changes. A resume
// stores them only once you change one, by clicking it or through the chat;
// until then they're drawn from the profile, so these units are added to
// what the page and the chat see (withHeadingUnits), as the letter's frame is.

/** A job's heading: four lines, its title, the company, its place and its dates. */
export const ROLE_HEAD = "role-head:";
/** Where you live, as the header's contact line shows it. */
export const LOCATION_UNIT = "location";

export const isHeadingUnit = (id: string) => id === LOCATION_UNIT || id.startsWith(ROLE_HEAD);

/**
 * "Senior PM\nAcme\nArlington, VA\nJun 2010 – Jul 2017" as its parts; a line
 * left empty is left out, except the dates: empty (or a heading stored before
 * it had them), the profile's are shown.
 */
export function parseRoleHead(text: string): { role: string; company: string; location: string; dates: string } {
  const [role = "", company = "", location = "", dates = ""] = text.split("\n").map((line) => line.trim());
  return { role, company, location, dates };
}

const roleHeadText = (entry: ProfileData["experience"][number]) =>
  [entry.role, entry.company, entry.location, formatDateRange(entry)].map((part) => part.trim()).join("\n");

/** "City, State", as the profile gives it. */
export const profileLocation = (basics: Pick<ProfileData["basics"], "city" | "state">) =>
  [basics.city, basics.state].map((part) => part.trim()).filter(Boolean).join(", ");

/** The heading units a resume doesn't store yet, as the profile has them, each where it's drawn. */
export function withHeadingUnits(units: readonly Unit[], profile: ProfileData): Unit[] {
  const result: Unit[] = [];
  const has = new Set(units.map((unit) => unit.id));
  const location = profileLocation(profile.basics);
  if (!has.has(LOCATION_UNIT) && location) result.push({ id: LOCATION_UNIT, label: "Your location", text: location });
  for (const unit of units) {
    if (unit.id.startsWith("experience:")) {
      const id = `${ROLE_HEAD}${unit.id.slice("experience:".length)}`;
      const entry = profile.experience.find((candidate) => `experience:${candidate.id}` === unit.id);
      if (entry && !has.has(id)) result.push({ id, label: `${unit.label || entry.company} heading`, text: roleHeadText(entry) });
    }
    // A heading stored before it had dates shows the profile's, to change like the rest.
    const entry = unit.id.startsWith(ROLE_HEAD) && profile.experience.find((candidate) => `${ROLE_HEAD}${candidate.id}` === unit.id);
    if (entry && !parseRoleHead(unit.text).dates) {
      const { role, company, location } = parseRoleHead(unit.text);
      result.push({ ...unit, text: [role, company, location, formatDateRange(entry)].join("\n") });
      continue;
    }
    result.push(unit);
  }
  return result;
}

/** Stores a heading unit the resume doesn't have yet, where it's drawn: before its job, or first for the location. */
export function addHeadingUnit(units: Unit[], unit: Unit): Unit[] {
  if (unit.id === LOCATION_UNIT) return [unit, ...units];
  const job = units.findIndex((entry) => entry.id === `experience:${unit.id.slice(ROLE_HEAD.length)}`);
  return job < 0 ? [...units, unit] : [...units.slice(0, job), unit, ...units.slice(job)];
}

/** A rewritten resume keeps the headings you changed on the one before. */
export function carryHeadings(before: readonly Unit[], after: Unit[]): Unit[] {
  const kept = (unit: Unit) =>
    unit.id === LOCATION_UNIT || (unit.id.startsWith(ROLE_HEAD) && after.some((entry) => entry.id === `experience:${unit.id.slice(ROLE_HEAD.length)}`));
  return before
    .filter((unit) => isHeadingUnit(unit.id) && kept(unit))
    .reduce((units, unit) => (units.some((entry) => entry.id === unit.id) ? units : addHeadingUnit(units, unit)), after);
}
