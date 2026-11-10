import { z } from "zod";

import type { ProfileData } from "@/lib/profile";
import { bulletBudgets, byRecency } from "@/lib/resume-fit";

import { CANDIDATE_VOICE, NO_EM_DASHES, outcomeWriting, profileForPrompt, system, type Task } from "./prompt-parts";

export const BASE_BULLETS_VERSION = "base-bullets@5";

// The base resume's versions, for sending when there's no job to tailor to:
// every point polished (Full), or the strongest chosen for the candidate's
// usual title to fit two or three pages. Code keeps each role to its budget
// and falls back to what the candidate wrote for a role left out.

const answerSchema = z.object({ roles: z.array(z.object({ id: z.string(), bullets: z.array(z.string()) })) });

/** Each role's bullets for the version, most important first, by experience id. */
export type BaseBullets = Record<string, string[]>;

const FULL = `You polish the experience on a candidate's resume, as JSON. Nothing is chosen or left out: this is their complete version.

- roles: every role from the profile, by id, with every one of its points as its own bullet, in the same order.
- Fix spelling, grammar and capital letters; past tense for roles that have ended and present tense for a current one; start each bullet with a strong verb.
- Keep every fact as it is: numbers, tools, names, results. Never merge, split, drop or add a point. Reword a point so it reads as an accomplishment (what was led or done, its scope, and its result) where its own words support that; otherwise only tidy it.`;

const CHOSEN = (title: string, pages: number) => `You choose and polish the experience for a candidate's ${pages}-page resume, as JSON. There's no particular job: it's the version they send when someone asks for a resume, so it shows them at their best as a ${title}.

- roles: every role from the profile, by id, with as many bullets as "Bullets per role" gives it, chosen from its points: the strongest for a ${title}, with results and numbers first. Two closely related points may become one bullet.
- Put each role's bullets in order of importance, the most important first: if the resume still runs long, bullets go from the end.
- Each bullet is one line, starts with a strong verb, and keeps the facts as written: numbers, tools, names, results. Fix spelling and grammar; past tense for roles that have ended, present for a current one.
- Add nothing: no number, tool, result or duty the role's points don't state.`;

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.replace(/^\s*[-*•·]\s*/, "").trim())
    .filter(Boolean);

const MAX_LENGTH = 400;

export type BaseBulletsInput = {
  profile: ProfileData;
  /** The candidate's usual title, e.g. "Technical Project Manager". */
  title: string;
  /** 2 or 3 to choose for that many pages; null for Full, every point polished. */
  maxPages: number | null;
};

/** A version of the base resume's experience: each role's bullets, kept to its budget. */
export const writeBaseBullets: Task<BaseBulletsInput, BaseBullets> = async (provider, { profile, title, maxPages }, { signal }) => {
  const roles = profile.experience.filter((role) => lines(role.bullets).length > 0);
  if (roles.length === 0) return { data: {}, promptVersion: BASE_BULLETS_VERSION };
  const budgets = bulletBudgets(
    roles.map((role) => ({ ...role, bullets: lines(role.bullets).length })),
    maxPages,
  );
  const perRole = byRecency(roles)
    .map((id) => {
      const role = roles.find((entry) => entry.id === id)!;
      const name = [role.role.trim(), role.company.trim()].filter(Boolean).join(" at ") || "Untitled role";
      const budget = budgets?.get(id);
      const has = lines(role.bullets).length;
      return `- ${id} (${name}): ${budget ? `${budget.min === budget.max ? budget.max : `${budget.min} to ${budget.max}`}, chosen from its ${has} points` : `all ${has} of its points`}`;
    })
    .join("\n");
  const answer = await provider.complete({
    system: system(budgets ? CHOSEN(title.trim() || "professional in their field", maxPages ?? 2) : FULL, outcomeWriting("base"), CANDIDATE_VOICE, NO_EM_DASHES),
    messages: [{ role: "user", cached: `The candidate's profile:\n${profileForPrompt(profile)}`, content: `Bullets per role:\n${perRole}` }],
    schema: answerSchema,
    schemaName: "base_bullets",
    creativity: "FAITHFUL",
    effort: "low",
    signal,
  });
  // Trusting nothing: known roles only, each within its budget; a role left out, or emptied, keeps what was written.
  const given = new Map(answer.roles.map((role) => [role.id, role.bullets.map((bullet) => bullet.replace(/^\s*[-*•·]\s*/, "").trim().slice(0, MAX_LENGTH)).filter(Boolean)]));
  const data: BaseBullets = {};
  for (const role of roles) {
    const written = lines(role.bullets);
    const budget = budgets?.get(role.id);
    const chosen = given.get(role.id) ?? [];
    // Full keeps every point: an answer that dropped some keeps what was written instead.
    if (!budget) data[role.id] = chosen.length === written.length ? chosen : written;
    else data[role.id] = (chosen.length > 0 ? chosen : written).slice(0, budget.max);
  }
  return { data, promptVersion: BASE_BULLETS_VERSION };
};
