import { isHeadingUnit } from "@/lib/resume-heading";
import { z } from "zod";

import { DocumentKind, Tone } from "@/generated/prisma/enums";
import { SIGN_OFF_UNIT, type Extracted, type Unit, type UnitEdit } from "@/lib/application-data";
import { emailParts } from "@/lib/application-email";
import { isFrameUnit } from "@/lib/letter-frame";
import type { ProfileData } from "@/lib/profile";
import { TONES } from "@/lib/tones";
import { isPublicationUnit } from "@/lib/unit-text";

import { guardSources, unverifiedFacts } from "../fact-guard";

import {
  bulletStory,
  applicationFacts,
  candidateFacts,
  CREATIVITY,
  jobForPrompt,
  languageRule,
  NO_EM_DASHES,
  CANDIDATE_VOICE,
  humanizeRules,
  profileForPrompt,
  system,
  truthfulness,
  UNTRUSTED_POSTING,
  type Task,
} from "./prompt-parts";

export const REFINE_CHAT_VERSION = "refine-chat@13";

const answerSchema = z.object({
  reply: z.string(),
  edits: z.array(z.object({ document: z.enum(DocumentKind), unitId: z.string(), text: z.string() })),
  /** A different cover letter tone, only when asked for one. */
  tone: z.enum(Tone).nullable(),
  declined: z.boolean(),
  /** Facts to keep in the candidate's Profile, for every job: only once they've said so. */
  profileFacts: z.preprocess((value) => value ?? [], z.array(z.string())),
});

const INSTRUCTIONS = `You help a candidate refine their tailored resume, cover letter and application email for one job, and answer as JSON.

- Change only what the request asks for, with one exception: a request that adds to or changes a role's bullets (unitId starting with "experience:") rewrites that role's whole list of bullets in the order of the bullet story below, so the change lands where it belongs in the story rather than tacked on at the end. Keep every other bullet's facts and meaning, and about the same number of bullets plus what was added; reword only to make the story flow. Leave the other roles alone.
- Each edit replaces one unit's whole text: give its document (RESUME, COVER_LETTER or EMAIL), its unitId and the new text. For a role or project, write bullets one per line without bullet characters.
- Never edit a publication (a resume unit whose unitId starts with "publication:"): it's the candidate's citation, as they wrote it. If asked to, say they can edit it or leave it out themselves.
- A resume unit whose unitId starts with "role-head:" is a job's heading, four lines: the job title, the company, its place, and its dates as the resume prints them (e.g. "Jun 2010 – Jul 2017", or "Jun 2010 – Present"). The "location" unit is where the candidate lives, as the resume's header shows it. Change them only when the candidate asks (another town, a company's new name, other dates), keeping the four lines in that order and the dates in the same style; it's for this resume alone. Never refuse a change to a job's dates: edit its heading.
- The email goes out with the resume and cover letter attached. Its "to" unit is the recipient ("Name <address>"), "subject" its subject line and "body" the whole message, from the greeting to the sign-off and the candidate's name.
- tone: set it (WARM, DIRECT or FORMAL) only when the request asks for a different tone for the letter; otherwise null. When you change the tone, rewrite the letter's paragraphs to match. A different tone for the email is an edit to the email, not a new tone.
- What the candidate tells you about themselves in this conversation is true and theirs to say: a clearance they held, a client or agency they served, a number, a duty. When they ask you to add it, add it to this application's documents in their words, where they ask. Never refuse, never make the edit depend on their profile first, and don't lecture: these edits are for this application only, and their profile stays as it is. Only invent nothing they didn't give you.
- The resume's summary (unitId "summary") leads with what the resume shows most. When a resume edit changes that emphasis (a new duty, client, clearance or strength that this job cares about), also edit the summary lightly to match: keep its wording, change or add a phrase, never rewrite it. When the edit doesn't change the emphasis, leave the summary as it is. Say so in the reply when you touch it.
- In the cover letter, write only about what the candidate has: never mention or explain away a certification, skill or requirement they lack.
- Ask before you guess. When a request is unclear in a way that changes what you'd write (which role a new bullet belongs under, which number, date, tool or client they mean, whether it replaces something or is added, which document), make no edits and ask instead: up to three short, specific questions in the reply, numbered, each answerable in a few words. Don't ask about what you can sensibly decide yourself, and don't ask again about something they've answered: once they answer, make the change.
- Most edits are for this one job. When the candidate tells you something new about themselves (a duty, a tool, a client, a number, a clearance) and hasn't said whether it's for this job only, make the change here and ask, in one short question at the end of the reply, whether it's just for this job or true for every job, so it can go in their Profile.
- profileFacts: only when the candidate has said something is true for every job (e.g. "all of them", "add it to my profile"): that fact in one plain sentence, in their words, to keep in their Profile's facts. Otherwise empty. Never their contact details.
- declined: false, unless the request can't be done at all (such as editing a publication); then true with no edits. A question back isn't a decline.
- reply: one or two friendly sentences saying what you changed, including the summary if you touched it, or your questions when you're asking first. When you saved something to their Profile, say so.`;

export type ChatTurn = { role: "user" | "assistant"; text: string };

export type RefineInput = {
  request: string;
  /** Earlier messages, oldest first. */
  history: ChatTurn[];
  /** The unit the request is about, if the user picked one ("About: Summary"). */
  target: string | null;
  /** The document on screen, which a request without a target is most likely about. */
  viewing?: DocumentKind | null;
  resume: Unit[];
  letter: Unit[];
  /** The application's email, when it has one. */
  email?: Unit[];
  profile: ProfileData;
  extracted: Extracted;
  tone: Tone;
  /** What the candidate tells the AI for this application (APP-15). */
  facts: string[];
  /** The posting as pasted, for the fact guard. */
  posting: string;
};

export type Refinement = { reply: string; edits: UnitEdit[]; tone: Tone | null; declined: boolean; profileFacts: string[] };

/** How the request says which document is on screen. */
const LOOKING_AT: Record<DocumentKind, string> = {
  [DocumentKind.RESUME]: "the resume",
  [DocumentKind.COVER_LETTER]: "the cover letter",
  [DocumentKind.EMAIL]: "the email",
};

/** Only the last messages go along; older ones rarely matter and cost context. */
const HISTORY = 10;

/** APP-7, APP-9: a reply plus unit edits (with what they replace, for Undo), or a decline with guidance. */
export const refineChat: Task<RefineInput, Refinement> = async (provider, input, options) => {
  const { request, history, target, viewing, resume, letter, email = [], profile, extracted, tone, facts, posting } = input;
  const looking = viewing ? LOOKING_AT[viewing] : null;
  const answer = await provider.complete({
    system: system(INSTRUCTIONS, bulletStory("the posting's top 5 to 10 requirements"), `Current letter tone: ${TONES[tone].label}.`, truthfulness(options.strict), candidateFacts(profile, facts), CREATIVITY[options.creativity], languageRule(options.language), UNTRUSTED_POSTING, NO_EM_DASHES, CANDIDATE_VOICE, humanizeRules(options.humanize)),
    messages: [
      {
        role: "user",
        content: [
          `The candidate's profile:\n${profileForPrompt(profile)}`,
          `The job:\n${jobForPrompt(extracted, null)}`,
          `The resume's units:\n${JSON.stringify(resume, null, 2)}`,
          `The cover letter's units:\n${JSON.stringify(letter, null, 2)}`,
          email.length > 0 && `The email's units:\n${JSON.stringify(email, null, 2)}`,
          applicationFacts(facts),
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
      { role: "assistant", content: "Understood. What would you like to change?" },
      ...history.slice(-HISTORY).map((turn) => ({ role: turn.role, content: turn.text })),
      { role: "user", content: target ? `About ${target}: ${request}` : looking ? `(I'm looking at ${looking}.) ${request}` : request },
    ],
    schema: answerSchema,
    schemaName: "refinement",
    creativity: options.creativity,
    signal: options.signal,
  });

  const newTone = answer.tone && answer.tone !== tone ? answer.tone : null;
  // The email's recipient counts too: its greeting names them, from the posting or typed in by the user.
  const sources = options.strict ? guardSources(profile, extracted, [posting, emailParts(email).to].join("\n"), facts) : null;
  const documents = { [DocumentKind.RESUME]: resume, [DocumentKind.COVER_LETTER]: letter, [DocumentKind.EMAIL]: email };
  // Only units that exist, each once; the text they replace is kept for Undo (APP-8).
  const edits = new Map<string, UnitEdit>();
  if (!answer.declined) {
    for (const edit of answer.edits) {
      const unit = documents[edit.document].find((entry) => entry.id === edit.unitId);
      const text = edit.text.trim();
      // A publication stays as the candidate wrote it (#218).
      if (unit && text && text !== unit.text && !isPublicationUnit(unit.id)) {
        // E6-6: in strict mode, note what the profile and posting don't back.
        // A heading or location the candidate asked to change is theirs to say.
        const checked = edit.document === DocumentKind.EMAIL ? unit.id !== "to" : unit.id !== SIGN_OFF_UNIT && !isFrameUnit(unit.id) && !isHeadingUnit(unit.id);
        const unverified = sources && checked ? unverifiedFacts(text, sources) : [];
        edits.set(`${edit.document} ${unit.id}`, {
          document: edit.document,
          unitId: unit.id,
          text,
          previousText: unit.text,
          ...(unverified.length > 0 ? { unverified } : {}),
          ...(unit.unverified?.length ? { previousUnverified: unit.unverified } : {}),
        });
      }
    }
    // A new tone brings its own sign-off in English letters (APP-10).
    const signOff = letter.find((unit) => unit.id === SIGN_OFF_UNIT);
    const english = /^english$/i.test(options.language ?? extracted.language ?? "English");
    if (newTone && signOff && english) {
      edits.set(`${DocumentKind.COVER_LETTER} ${SIGN_OFF_UNIT}`, {
        document: DocumentKind.COVER_LETTER,
        unitId: SIGN_OFF_UNIT,
        text: TONES[newTone].signOff,
        previousText: signOff.text,
      });
    }
  }
  return {
    data: { reply: answer.reply.trim(), edits: [...edits.values()], tone: answer.declined ? null : newTone,
      declined: answer.declined,
      profileFacts: answer.declined ? [] : answer.profileFacts.map((fact) => fact.trim().slice(0, 1000)).filter(Boolean).slice(0, 3),
    },
    promptVersion: REFINE_CHAT_VERSION,
  };
};
