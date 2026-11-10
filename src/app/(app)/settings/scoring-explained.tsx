"use client";

import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Card } from "@/components/ui/card";
import { fitBand } from "@/lib/fit";

import { saveAgentSettings } from "../agent/actions";

/**
 * How a score is made, as the code does it (score-posting.ts for the AI
 * model, jev.ts for Jev), and the score from which the job agent prepares a
 * draft on its own. Nothing here is a summary of our own: it follows the
 * scoring prompt's criteria and bands, and Jev's weights and penalties.
 */
export function ScoringExplained({
  initialMinScore,
  autoDraft,
  jevWeights,
}: {
  initialMinScore: number;
  autoDraft: boolean;
  /** Jev's weights as jev.ts has them (JEV_WEIGHTS). */
  jevWeights: { requirements: number; work: number; seniority: number };
}) {
  const track = useTrackSave();
  const [minScore, setMinScore] = useState(initialMinScore);
  const save = async (value: number) => {
    if (!toastResult(await track(saveAgentSettings({ minScore: value }))).ok) setMinScore(initialMinScore);
  };
  const percent = (weight: number) => `${Math.round(weight * 100)}%`;
  return (
    <>
      <Card className="flex flex-col gap-4">
        <h2 className="text-[15px] font-medium">How the AI model judges the fit</h2>
        <p className="text-sm text-muted">
          The model reads the posting and your profile and answers four questions, each on a short scale with every step spelled out. Scout turns the
          answers into the fit out of 100 with fixed weights, so the same posting gets much the same fit each time. Location, remote work and pay are
          left to your settings above.
        </p>
        <table className="w-full max-w-[560px] text-left text-sm">
          <caption className="sr-only">The four questions</caption>
          <tbody>
            <tr className="border-t border-line">
              <th scope="row" className="py-1.5 pr-3 font-medium">40%</th>
              <td className="py-1.5">How many of the posting&apos;s core requirements your profile shows (0–4).</td>
            </tr>
            <tr className="border-t border-line">
              <th scope="row" className="py-1.5 pr-3 font-medium">25%</th>
              <td className="py-1.5">How close your past work is to the job&apos;s day-to-day work (0–3).</td>
            </tr>
            <tr className="border-t border-line">
              <th scope="row" className="py-1.5 pr-3 font-medium">25%</th>
              <td className="py-1.5">How the job&apos;s seniority and scope match yours, both ways (0–3).</td>
            </tr>
            <tr className="border-t border-line">
              <th scope="row" className="py-1.5 pr-3 font-medium">10%</th>
              <td className="py-1.5">The industry or field (0–2).</td>
            </tr>
          </tbody>
        </table>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-meta text-muted">
          <li>A seniority far apart either way keeps the fit at 60 at most, however well the rest matches.</li>
          <li>It also reads whether the job is remote, hybrid or on-site, and its pay, when Scout can&apos;t tell from the job board.</li>
          <li>A posting too thin to judge is answered conservatively, and a reason says so.</li>
          <li>Age, gender, nationality, ethnicity, religion, disability, family status and other protected characteristics are never used.</li>
        </ul>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-[15px] font-medium">How Jev scores a posting</h2>
        <p className="text-sm text-muted">Jev answers set questions about the posting; Scout turns the answers into the score with fixed weights:</p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          <li>requirements met: {percent(jevWeights.requirements)} of the score;</li>
          <li>the kind of work: {percent(jevWeights.work)};</li>
          <li>seniority: {percent(jevWeights.seniority)};</li>
          <li>minus 15 points for a location or permit you can&apos;t meet, and 15 for a language you don&apos;t speak;</li>
          <li>at most 60 when the posting is too thin to judge.</li>
        </ul>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-[15px] font-medium">When a draft is prepared for you</h2>
        <p className="text-sm text-muted">
          {autoDraft
            ? "The job agent prepares a resume and cover letter on its own for postings scoring at or above this; below it, they wait for you to click Prepare draft."
            : "Postings at or above this are kept as Scored postings; below it, they're under Below. Turn on Prepare drafts on its own in Settings → Job agent to have drafts written for the ones above it."}
        </p>
        <label className="flex flex-wrap items-center gap-4 text-sm">
          <span className="font-medium">Draft from a score of</span>
          <input
            type="range"
            min={50}
            max={95}
            step={5}
            value={minScore}
            aria-label="Draft from a score of"
            onChange={(event) => setMinScore(Number(event.target.value))}
            onPointerUp={() => void save(minScore)}
            onKeyUp={() => void save(minScore)}
            className="w-64 accent-[var(--color-primary)]"
          />
          <span className="font-mono tabular-nums">{minScore}</span>
          <span className="text-muted">{fitBand(minScore)} and up</span>
        </label>
      </Card>
    </>
  );
}
