/**
 * The score's reasons as a card of their own, set apart from the posting's
 * text: what the posting asks for and how the profile matches it.
 */
export function FitSummary({ reasons }: { reasons: readonly string[] }) {
  if (reasons.length === 0) return null;
  return (
    <section aria-label="Match summary" className="rounded-card border border-info-line bg-info-surface px-3.5 py-2.5 text-meta text-ink">
      <p className="font-medium text-info">Match summary: what the posting asks for, and how you fit</p>
      <ul aria-label="Why it fits" className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
        {reasons.map((reason, index) => (
          <li key={index}>{reason}</li>
        ))}
      </ul>
    </section>
  );
}
