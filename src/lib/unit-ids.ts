import type { Unit } from "@/lib/application-data";
import { publicationLabel } from "@/lib/citation";
import type { ProfileData } from "@/lib/profile";

// A tailored resume finds each job, project, degree and publication by its id
// ("experience:<id>"). When an entry gets a new id, as a profile read from a
// file again used to give it, the resume would lose that whole part. Each unit
// also carries its label ("Northwind Logistics role"), so a unit whose id is gone is
// matched to the entry with that label that no unit has yet. The resume then
// shows what was written for it, whatever happened to the id.

type Labeled = { id: string; label: string };

/** Each kind of unit, with how its entries are labeled when a resume is written (tailor-resume.ts). */
function kinds(profile: ProfileData): { prefix: string; entries: Labeled[] }[] {
  const job = (entry: ProfileData["experience"][number]) => entry.company || entry.role;
  return [
    { prefix: "experience:", entries: profile.experience.map((entry) => ({ id: entry.id, label: `${job(entry)} role` })) },
    { prefix: "role-skills:", entries: profile.experience.map((entry) => ({ id: entry.id, label: `${job(entry)} skills` })) },
    { prefix: "project:", entries: profile.projects.map((entry) => ({ id: entry.id, label: `${entry.name || "Untitled"} project` })) },
    { prefix: "education:", entries: profile.education.map((entry) => ({ id: entry.id, label: entry.degree || entry.school })) },
    { prefix: "publication:", entries: profile.publications.map((entry) => ({ id: entry.id, label: publicationLabel(entry.citation) })) },
  ];
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The units with every id pointing at the profile as it is now: one whose entry is gone takes the id of the entry with its label, if there's one. */
export function withCurrentIds(units: readonly Unit[], profile: ProfileData): Unit[] {
  const result = units.map((unit) => ({ ...unit }));
  for (const { prefix, entries } of kinds(profile)) {
    const ids = new Set(entries.map((entry) => `${prefix}${entry.id}`));
    const taken = new Set(result.filter((unit) => ids.has(unit.id)).map((unit) => unit.id));
    for (const unit of result) {
      if (!unit.id.startsWith(prefix) || ids.has(unit.id)) continue;
      const entry = entries.find((candidate) => !taken.has(`${prefix}${candidate.id}`) && same(candidate.label, unit.label));
      if (!entry) continue;
      unit.id = `${prefix}${entry.id}`;
      taken.add(unit.id);
    }
  }
  return result;
}
