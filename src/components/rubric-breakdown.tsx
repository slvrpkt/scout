import type { RubricLine } from "@/lib/scoring/rubric";

const VERDICT_WORDS: Record<RubricLine["verdict"], string> = {
  yes: "Met",
  partly: "Partly met",
  no: "Not met",
  unknown: "Posting doesn't say",
  score: "Scout's score",
  yours: "Your settings",
};

const points = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/**
 * How your own scoring rubric made a score (#42): each criterion, how it was
 * judged, and the points it earned of its points, then the total and the
 * score out of 100 it comes to.
 */
export function RubricBreakdown({ breakdown, score }: { breakdown: readonly RubricLine[]; score: number }) {
  const earned = breakdown.reduce((sum, line) => sum + line.earned, 0);
  const total = breakdown.reduce((sum, line) => sum + line.points, 0);
  return (
    <table className="w-full text-left text-sm">
      <caption className="sr-only">Your scoring rubric</caption>
      <thead className="text-meta text-muted">
        <tr>
          <th scope="col" className="pb-1 font-medium">
            Criterion
          </th>
          <th scope="col" className="pb-1 font-medium">
            Judged
          </th>
          <th scope="col" className="pb-1 text-right font-medium">
            Points
          </th>
        </tr>
      </thead>
      <tbody>
        {breakdown.map((line, index) => (
          <tr key={index} className="border-t border-line align-top">
            <th scope="row" className="py-1.5 pr-3 font-normal">
              {line.label}
              {line.note && <span className="block text-meta text-muted">{line.note}</span>}
            </th>
            <td className="py-1.5 pr-3 whitespace-nowrap text-muted">{VERDICT_WORDS[line.verdict]}</td>
            <td className="py-1.5 text-right font-mono whitespace-nowrap tabular-nums">
              {points(line.earned)} / {line.points}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-line-strong font-medium">
          <th scope="row" colSpan={2} className="py-1.5">
            Total: {score} of 100
          </th>
          <td className="py-1.5 text-right font-mono whitespace-nowrap tabular-nums">
            {points(earned)} / {total}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
