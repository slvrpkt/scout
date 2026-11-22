import "server-only";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { AgentCandidateStatus } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai/provider";
import { ActionError } from "@/lib/action";
import { defineJob } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { loadPostingScorer } from "@/lib/scoring";
import { skipRuleList } from "@/lib/scoring/rubric";

import { applyLinksOf } from "./candidates";
import { findAtSource } from "./source-finder";

// Looks for a posting on the company's own site (source-finder.ts) and keeps
// what it finds: the company's text in place of the job board's (which is
// kept), its page first among the places to apply, and a score from the
// company's text, the search's "What to skip" rules read again. Run before
// a draft is written, and from Look on company website.

/** What the look found: whether it's there, and the score from its text when that changed. */
export type SourceResult = { found: boolean; score: number | null; skipped: boolean };

const SOURCE_FOUND = "found";
const SOURCE_MISSING = "not found";

/** The provider, when there is one to search the web and score with. */
async function providerOrNull(): Promise<AIProvider | null> {
  try {
    return await getAiProvider();
  } catch {
    return null;
  }
}

export async function checkSource(candidateId: string, signal: AbortSignal, now = new Date()): Promise<SourceResult> {
  const candidate = await prisma.agentCandidate.findUnique({ where: { id: candidateId }, include: { search: { select: { skipRules: true } } } });
  if (!candidate) throw new ActionError("That posting is no longer in the agent's queue.");
  const provider = await providerOrNull();
  const links = applyLinksOf(candidate.applyLinks);
  const hit = await findAtSource({ title: candidate.title, company: candidate.company, place: candidate.place, employerSite: candidate.employerSite, applyLinks: links }, provider, signal);
  if (!hit) {
    await prisma.agentCandidate.update({ where: { id: candidateId }, data: { sourceCheck: SOURCE_MISSING, sourceCheckedAt: now } });
    return { found: false, score: null, skipped: false };
  }

  // The company's page first among the places to apply; the job board's text kept.
  const applyLinks = [{ kind: "direct" as const, url: hit.url.slice(0, 2000), publisher: candidate.company.slice(0, 100) }, ...links.filter((link) => link.kind !== "direct" && link.url !== hit.url)].slice(0, 3);
  await prisma.agentCandidate.update({
    where: { id: candidateId },
    data: {
      description: hit.description.slice(0, 100_000),
      boardDescription: candidate.boardDescription ?? candidate.description,
      complete: true,
      applyLinks,
      sourceUrl: hit.url,
      sourceCheck: SOURCE_FOUND,
      sourceCheckedAt: now,
    },
  });

  // Scored again from the company's own text; a failed score keeps the one it had.
  try {
    const score = await loadPostingScorer(provider ?? undefined);
    const { data, skip } = await score(
      { title: candidate.title, company: candidate.company, place: candidate.place, remote: candidate.remote, salary: candidate.salary, description: hit.description, postedAt: candidate.postedAt?.toISOString() ?? null },
      await loadProfile(),
      signal,
      skipRuleList(candidate.search?.skipRules ?? ""),
    );
    const redFlags = skip ? [`Skipped by your rule “${skip.rule}”${skip.note ? `: ${skip.note}` : ""}`, ...data.redFlags] : data.redFlags;
    await prisma.agentCandidate.update({
      where: { id: candidateId },
      data: {
        score: data.score,
        reasons: data.reasons,
        redFlags,
        breakdown: data.breakdown ?? Prisma.DbNull,
        // A rule the company's text matches archives it, as at the first score; a draft under way is left to finish.
        ...(skip && candidate.status === AgentCandidateStatus.SCORED ? { status: AgentCandidateStatus.DISMISSED } : {}),
      },
    });
    return { found: true, score: data.score, skipped: Boolean(skip) };
  } catch (error) {
    if (signal.aborted) throw error;
    logServerError("job agent source score", error);
    return { found: true, score: null, skipped: false };
  }
}

/** Finds Look on company website's job again, e.g. after a reload. */
export const sourceJobKey = (candidateId: string) => `agent-source:${candidateId}`;

/** Look on company website, from a posting's card. */
export const agentSourceJob = defineJob({
  type: "agent-source",
  input: z.object({ candidateId: z.string().min(1) }),
  result: z.object({ found: z.boolean(), score: z.number().nullable(), skipped: z.boolean() }),
  run: async ({ candidateId }, context) => {
    await context.step("Looking on the company's website");
    return checkSource(candidateId, context.signal);
  },
});
