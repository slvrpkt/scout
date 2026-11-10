import "server-only";

import { prisma } from "@/lib/prisma";
import type { SkillKind } from "@/lib/profile";

// Helpers for adding to the profile's lists, shared by the profile editor
// and the application page ("+ Add to profile").

/** The next `sort` value, so new entries go last. */
export async function nextSort(model: {
  aggregate: (args: { _max: { sort: true } }) => Promise<{ _max: { sort: number | null } }>;
}) {
  const { _max } = await model.aggregate({ _max: { sort: true } });
  return (_max.sort ?? -1) + 1;
}

/** A `sort` value before all others, so a new entry goes first (E4-9). */
export async function firstSort(model: {
  aggregate: (args: { _min: { sort: true } }) => Promise<{ _min: { sort: number | null } }>;
}) {
  const { _min } = await model.aggregate({ _min: { sort: true } });
  return (_min.sort ?? 1) - 1;
}

/** Finds a skill by name, ignoring case (citext), or creates it. */
export async function findOrCreateSkill(name: string, group?: string, kind?: SkillKind) {
  const existing = await prisma.skill.findUnique({ where: { name } });
  const shown = (skill: { id: string; name: string; group: string; kind: string }) => ({ id: skill.id, name: skill.name, group: skill.group, kind: skill.kind === "TOOL" ? ("TOOL" as const) : ("SKILL" as const) });
  if (existing) {
    // Added under a group in Profile → Skills, it moves there (#280); added as a tool or a skill, it moves to that section.
    const data = { ...(group !== undefined && group !== existing.group ? { group } : {}), ...(kind && kind !== existing.kind ? { kind } : {}) };
    const skill = Object.keys(data).length > 0 ? await prisma.skill.update({ where: { id: existing.id }, data }) : existing;
    return { skill: shown(skill), added: false };
  }
  const created = await prisma.skill.create({ data: { name, group: group ?? "", kind: kind ?? "SKILL", sort: await nextSort(prisma.skill) } });
  return { skill: shown(created), added: true };
}
