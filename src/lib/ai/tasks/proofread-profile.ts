import { z } from "zod";

import type { ProfilePiece } from "@/lib/profile-pieces";

import { system, type Task } from "./prompt-parts";

export const PROOFREAD_PROFILE_VERSION = "proofread-profile@2";

const answerSchema = z.object({ issues: z.array(z.object({ where: z.string(), wrong: z.string(), right: z.string() })) });

export type ProofreadIssue = z.infer<typeof answerSchema>["issues"][number];

const INSTRUCTIONS = `You proofread pieces of a candidate's profile, which every resume they send is written from. Each piece is given with where it is.

- issues: each spelling mistake, typo, wrong capital letter, doubled word or clear grammar slip, one per entry:
  - where: the piece's "where", as given.
  - wrong: the words as written, a few words around the mistake, copied exactly.
  - right: the same words corrected.
- Leave style, tone, word choice, abbreviations, product names and people's names alone: only real mistakes. An empty list when there are none.`;

/** Mistakes in the pieces of the profile that changed, for the candidate to fix; nothing is changed. */
export const proofreadProfile: Task<{ pieces: readonly ProfilePiece[] }, ProofreadIssue[]> = async (provider, { pieces }, { signal }) => {
  if (pieces.length === 0) return { data: [], promptVersion: PROOFREAD_PROFILE_VERSION };
  const answer = await provider.complete({
    system: system(INSTRUCTIONS),
    messages: [{ role: "user", content: pieces.map((piece) => `[${piece.where}]\n${piece.text}`).join("\n\n") }],
    schema: answerSchema,
    schemaName: "proofread_profile",
    effort: "low",
    signal,
  });
  const texts = pieces.map((piece) => piece.text).join("\n");
  return {
    data: answer.issues
      .filter((issue) => issue.wrong.trim() && issue.wrong.trim() !== issue.right.trim() && texts.includes(issue.wrong.trim()))
      .slice(0, 50),
    promptVersion: PROOFREAD_PROFILE_VERSION,
  };
};
