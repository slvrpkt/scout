import { z } from "zod";

import type { Tone } from "@/generated/prisma/enums";
import { SIGN_OFF_UNIT, unitsSchema, type Extracted, type Match, type Unit } from "@/lib/application-data";
import { stripTraps, trapsForPrompt } from "@/lib/screening-traps";
import type { ProfileData } from "@/lib/profile";
import { FRAME_LABELS, isFrameUnit } from "@/lib/letter-frame";
import { TONES } from "@/lib/tones";

import { guardSources, guardUnits } from "../fact-guard";

import {
  applicationFacts,
  candidateFacts,
  COVER_LETTER_APPROACH,
  CREATIVITY,
  jobForPrompt,
  languageRule,
  NO_EM_DASHES,
  humanizeRules,
  profileForPrompt,
  system,
  truthfulness,
  UNTRUSTED_POSTING,
  READ_THE_POSTING,
  postingForPrompt,
  type Task,
} from "./prompt-parts";

export const WRITE_COVER_LETTER_VERSION = "write-cover-letter@9";

const answerSchema = z.object({
  recipient: z.string(),
  greeting: z.string(),
  paragraphs: z.array(z.object({ label: z.string(), text: z.string() })),
  signOff: z.string(),
});

const INSTRUCTIONS = `You write a candidate's cover letter for one job, as JSON.

- recipient: the address block, one item per line, as a business letter has it: the contact person's name and then their title when the posting names them, otherwise "Hiring Manager" (in the letter's language); then the company's name; then its street address and its city, state and zip code, only as far as the posting gives them (often just the city and state). Never make up an address. E.g. "Hiring Manager\\nLedgerly\\nAmsterdam".
- greeting: the salutation before the first paragraph, to a particular person when the posting names one, else the hiring manager. In English it ends with a colon, as a business letter does: "Dear Ms. Patel:" or "Dear Hiring Manager:". In other languages, as usual there.
- paragraphs: exactly 3 paragraphs, 130–170 words together and never over 180, so the whole letter takes no more than half a page. Brief, but specific:
  1. Opening: clearly say why the candidate is writing, name the position, and, where the posting or the candidate's notes say so, how they heard about it or the company (never invent a referral or a source).
  2. Middle: why this employer and this kind of work, and one or two key examples from the candidate's experience that show the skills this job needs most. Don't retell the resume: pick the examples, in a confident voice, so the reader wants to read the resume.
  3. Closing: say again how interested they are and how they'd use their skills for the organization's work, thank the reader for considering the application, and end by saying they look forward to discussing the position.
  No greeting, sign-off or name in them: those are separate.
- label: a short English name for each paragraph's purpose: "Opening", "Why me", "Closing".
- Write only about what the candidate has. Never mention, apologise for or explain away anything the job asks for that the profile doesn't show: a missing certification, skill, degree, clearance or number of years. Leave it out entirely, without claiming it either, and make the case with the strengths they do have.
- signOff: the closing line before the name, matching the tone, with its punctuation (e.g. "Warm regards,").
- The sender's name, contact details and the date are added from the profile; don't write them.`;

export type CoverLetterInput = {
  profile: ProfileData;
  extracted: Extracted;
  match: Match | null;
  tone: Tone;
  /** What the candidate tells the AI for this application (APP-15). */
  facts: string[];
  /** The posting as pasted, for the fact guard. */
  posting: string;
  /** A firm limit on the paragraphs' words, when the letter has to come out shorter. */
  maxWords?: number;
  /** The tailored resume as it is now, edits and all, when the letter is written again to go with it. */
  resume?: Unit[];
};

/**
 * APP-10: the letter's recipient and greeting (units "recipient" and
 * "greeting", E8-11), its paragraphs as units, then its sign-off (unit
 * "sign-off"), which matches the tone. The sender, date and signature come
 * from the profile when the application is created (src/lib/letter-frame.ts).
 */
export const writeCoverLetter: Task<CoverLetterInput, Unit[]> = async (provider, { profile, extracted, match, tone, facts, posting, maxWords, resume }, options) => {
  const answer = await provider.complete({
    system: system(
      INSTRUCTIONS,
      COVER_LETTER_APPROACH,
      `Tone: ${TONES[tone].label}. ${TONES[tone].description}`,
      maxWords ? `Firm limit: the paragraphs come to ${maxWords} words at most together, so the letter stays on one page. Keep what matters most for this job.` : "",
      truthfulness(options.strict),
      candidateFacts(profile, facts),
      CREATIVITY[options.creativity],
      languageRule(options.language),
      READ_THE_POSTING,
      UNTRUSTED_POSTING,
      NO_EM_DASHES,
      humanizeRules(options.humanize),
    ),
    messages: [
      {
        role: "user",
        cached: `The candidate's profile:\n${profileForPrompt(profile)}`,
        content: [
          `The job:\n${jobForPrompt(extracted, match)}`,
          posting.trim() && `The posting, in full:\n${postingForPrompt(posting)}`,
          resume?.length &&
            `The candidate's tailored resume for this job, as it is now (it may have been edited for this job). Build the letter on what it stresses, in your own words, without repeating it line for line:\n${resume.map((unit) => `${unit.label}: ${unit.text}`).join("\n")}`,
          applicationFacts(facts),
          trapsForPrompt(extracted.traps ?? []),
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "cover_letter",
    creativity: options.creativity,
    signal: options.signal,
  });

  // English letters get the tone's own sign-off; other languages keep the model's.
  const language = options.language ?? extracted.language ?? "English";
  const signOff = /^english$/i.test(language) || !answer.signOff.trim() ? TONES[tone].signOff : answer.signOff.trim();
  const units = unitsSchema.parse([
    // Left out when empty: the English ones fill in (src/lib/letter-frame.ts).
    ...(answer.recipient.trim() ? [{ id: "recipient", label: FRAME_LABELS.recipient, text: tidyLines(answer.recipient) }] : []),
    ...(answer.greeting.trim() ? [{ id: "greeting", label: FRAME_LABELS.greeting, text: answer.greeting.trim() }] : []),
    ...withoutFrame(answer.paragraphs, signOff)
      .filter((paragraph) => paragraph.text.trim())
      // A word the posting planted as a screening trap never makes it in.
      .map((paragraph, index) => ({ id: `paragraph:${index + 1}`, label: paragraph.label.trim() || `Paragraph ${index + 1}`, text: stripTraps(paragraph.text, extracted.traps ?? []).trim() })),
    { id: SIGN_OFF_UNIT, label: "Sign-off", text: signOff },
  ]);
  return {
    // The recipient and greeting aren't claims about the candidate: only the paragraphs are checked.
    data: options.strict ? guardUnits(units, guardSources(profile, extracted, posting, facts)).map((unit) => (isFrameUnit(unit.id) ? units.find((entry) => entry.id === unit.id)! : unit)) : units,
    promptVersion: WRITE_COVER_LETTER_VERSION,
  };
};

/** An address block's lines, trimmed, without empty ones. */
const tidyLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

const GREETING = /^\s*(?:dear|hi|hello|hey|good (?:morning|afternoon|day))\b[^\n]{0,60}[,!:]?\s*(?:\n|$)/i;

/**
 * The renderer adds the greeting, sign-off and name (APP-10); models add them
 * anyway sometimes. Takes a greeting line off the first paragraph and a
 * sign-off (with the name after it) off the last.
 */
export function withoutFrame<T extends { text: string }>(paragraphs: T[], signOff: string): T[] {
  if (paragraphs.length === 0) return paragraphs;
  const result = paragraphs.map((paragraph) => ({ ...paragraph }));
  result[0].text = result[0].text.replace(GREETING, "");
  const last = result.at(-1)!;
  const closings = [signOff, "Warm regards", "Kind regards", "Best regards", "Best", "Sincerely", "Yours sincerely", "Regards"];
  for (const closing of closings) {
    const escaped = closing.replace(/[,.]$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // On its own line, or right after the last sentence, maybe followed by a name.
    last.text = last.text.replace(new RegExp(`(?:\\n+|(?<=[.!?])[ \\t]+)\\s*${escaped}[,.]?(?:\\s*\\n[^\\n]{0,60})?\\s*$`, "i"), "").trim();
  }
  return result;
}
