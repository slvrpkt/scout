import { z } from "zod";

import { factSources, unverifiedFacts } from "../fact-guard";

import { CANDIDATE_VOICE, humanizeRules, languageRule, NO_EM_DASHES, outcomeWriting, postingForPrompt, system, UNTRUSTED_POSTING, type Task } from "./prompt-parts";

export const CONDENSE_BULLETS_VERSION = "condense-bullets@6";

// The two-page rule's rewrite (resume-fit.ts): one job's bullets said again
// in fewer bullets, keeping the facts, for each length the fit may need.
// Code checks each version: the right number of bullets, nothing the
// original doesn't say, and, from 4 bullets up, every number kept. A length
// that fails is asked for again, told what was wrong, up to ATTEMPTS times.

const answerSchema = z.object({
  versions: z.array(z.object({ count: z.number(), bullets: z.array(z.string()) })),
});

const INSTRUCTIONS = () => `You shorten one job's bullets on a resume to fit the page, as JSON. For each count asked for, write the same job as exactly that many bullets.

- Keep every fact: numbers, percentages, money, team and user sizes, tools, products, clients, results. Merge related points into one bullet and cut filler words, never facts.
- Add nothing: no number, name, tool or result that isn't in the original bullets.
- Each bullet is at most two lines: under ${MAX_BULLET} characters. It starts with a verb and reads as a resume bullet, without a bullet sign.
- Fewer bullets must take less room on the page: the whole version must be shorter than the original by about as much as it has fewer bullets. Merging two points means cutting words from both, not joining them whole. Drop filler, not facts; with very few bullets, keep the strongest facts and let the minor ones go.
- With very few bullets, keep the most important results and their numbers first.
- versions: one entry per count asked for, with that count and its bullets.`;

export type CondenseInput = {
  role: string;
  company: string;
  /** The job's bullets as they are now, one per line. */
  bullets: string[];
  /** The lengths wanted, each fewer than the bullets there are. */
  counts: number[];
  /** For a tailored resume: the posting, so what this job cares about stays first. */
  posting?: string;
};

/** Each count that came back right: the job in exactly that many bullets. */
export type Condensed = Record<number, string[]>;

const MAX_LENGTH = 400;
/** From this many bullets up there's room for every number, so a dropped one means asking again. */
const KEEP_EVERY_NUMBER_FROM = 4;

/** A bullet's most characters: about two lines on the page. */
export const MAX_BULLET = 220;
/** How much longer than its share of the original a shorter version may be: fewer bullets must save room. */
const SHARE_SLACK = 1.15;

/**
 * Why a shorter version doesn't save room, or null when it does: every bullet
 * under MAX_BULLET characters, and the whole no longer than its share of the
 * original's characters (count / original count), with a little slack.
 */
export function roomProblem(original: readonly string[], version: readonly string[]): string | null {
  const long = version.findIndex((bullet) => bullet.length > MAX_BULLET);
  if (long >= 0) return `had a bullet of ${version[long].length} characters, over ${MAX_BULLET}`;
  const total = (lines: readonly string[]) => lines.reduce((sum, line) => sum + line.length, 0);
  const share = (total(original) * version.length) / Math.max(original.length, 1);
  if (total(version) > Math.max(share * SHARE_SLACK, MAX_BULLET * 0.6 * version.length)) {
    return `took ${total(version)} characters, more than its share of the original's (about ${Math.round(share)}); cut words so fewer bullets take less room`;
  }
  return null;
}

/** How many times a length is asked for before it's given up on. */
const ATTEMPTS = 3;

/**
 * The versions that pass: the right length, nothing new, and every number
 * kept where there's room. Says what was wrong with each that didn't, and
 * whether any number was dropped.
 */
export function checkVersions(
  input: Pick<CondenseInput, "role" | "company" | "bullets" | "counts">,
  answer: z.infer<typeof answerSchema>,
): { condensed: Condensed; failed: Record<number, string>; droppedNumbers: boolean } {
  const sources = factSources([input.role, input.company, ...input.bullets]);
  const original = factSources(input.bullets).numbers;
  const condensed: Condensed = {};
  const failed: Record<number, string> = {};
  let droppedNumbers = false;
  for (const count of input.counts) {
    const version = answer.versions.find((entry) => entry.count === count);
    const bullets = version?.bullets.map((line) => line.replace(/^\s*[-*•·]\s*/, "").trim().slice(0, MAX_LENGTH)).filter(Boolean) ?? [];
    if (!version) {
      failed[count] = "was missing";
      continue;
    }
    if (bullets.length !== count) {
      failed[count] = `had ${bullets.length} bullets, not ${count}`;
      continue;
    }
    const room = roomProblem(input.bullets, bullets);
    if (room) {
      failed[count] = room;
      continue;
    }
    const added = unverifiedFacts(bullets.join("\n"), sources);
    if (added.length > 0) {
      failed[count] = `said things the original doesn't (${added.slice(0, 5).join(", ")})`;
      continue;
    }
    const kept = factSources(bullets).numbers;
    const lost = [...original].filter((number) => !kept.has(number));
    if (count >= KEEP_EVERY_NUMBER_FROM && lost.length > 0) {
      droppedNumbers = true;
      failed[count] = `left out numbers from the original (${lost.slice(0, 5).join(", ")})`;
      continue;
    }
    condensed[count] = bullets;
  }
  return { condensed, failed, droppedNumbers };
}

/** One job's bullets at each of `counts`, in one request; any length that comes back wrong is asked for again, saying what was wrong. */
export const condenseBullets: Task<CondenseInput, Condensed> = async (provider, input, options) => {
  const counts = [...new Set(input.counts)].filter((count) => count >= 1 && count < input.bullets.length).toSorted((a, b) => b - a);
  if (counts.length === 0) return { data: {}, promptVersion: CONDENSE_BULLETS_VERSION };
  const ask = (wanted: number[], failed: Record<number, string>) =>
    provider.complete({
      system: system(
        INSTRUCTIONS(),
        outcomeWriting("shorter"),
        Object.keys(failed).length > 0 &&
          `Last time these versions couldn't be used: ${Object.entries(failed)
            .map(([count, why]) => `the ${count}-bullet one ${why}`)
            .join("; ")}. Write exactly the number of bullets asked for, merge points instead of dropping them, and use only what the original says.`,
        Object.values(failed).some((why) => why.startsWith("left out numbers")) && "Keep every number this time.",
        input.posting &&
          "This resume is tailored to the posting below: keep every fact, and lead with what the posting asks for, in its own terms wherever the bullets back them.",
        input.posting && UNTRUSTED_POSTING,
        languageRule(options.language),
        NO_EM_DASHES,
        CANDIDATE_VOICE,
        humanizeRules(options.humanize),
      ),
      messages: [
        {
          role: "user",
          content: [
            `The job: ${[input.role, input.company].filter(Boolean).join(" at ")}`,
            `Its bullets:\n${input.bullets.map((line) => `- ${line}`).join("\n")}`,
            `Counts wanted: ${wanted.join(", ")}`,
            ...(input.posting ? [`The posting it's for:\n${postingForPrompt(input.posting)}`] : []),
          ].join("\n\n"),
        },
      ],
      schema: answerSchema,
      schemaName: "condensed_bullets",
      creativity: "FAITHFUL",
      effort: "low",
      signal: options.signal,
    });
  let condensed: Condensed = {};
  let failed: Record<number, string> = {};
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const wanted = counts.filter((count) => !condensed[count]);
    if (wanted.length === 0) break;
    const result = checkVersions({ ...input, counts: wanted }, await ask(wanted, failed));
    condensed = { ...condensed, ...result.condensed };
    failed = result.failed;
  }
  return { data: condensed, promptVersion: CONDENSE_BULLETS_VERSION };
};
