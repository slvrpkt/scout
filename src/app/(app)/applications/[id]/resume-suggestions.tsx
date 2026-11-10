import { Lightbulb } from "lucide-react";

/**
 * Beside a draft's resume: what the AI thinks would make it a better match,
 * for you to vet. Nothing here is on the resume. If one is true for you, ask
 * for it in the chat on the right, or edit the resume yourself.
 */
export function ResumeSuggestions({ items, beforeApplying = [] }: { items: readonly string[]; beforeApplying?: readonly string[] }) {
  if (items.length === 0 && beforeApplying.length === 0) return null;
  return (
    <section aria-label="Suggestions for this job" className="flex flex-col gap-2.5 rounded-card border border-line bg-card p-4 text-sm">
      <h2 className="flex items-center gap-2 font-medium text-ink">
        <Lightbulb size={15} aria-hidden="true" className="text-warning" />
        Suggestions for this job
      </h2>
      <p className="text-meta text-muted">Nothing here is on your resume. Keep only what&apos;s true for you, then ask for it in the chat, or add it yourself.</p>
      {beforeApplying.length > 0 && (
        <div className="flex flex-col gap-1 rounded-control bg-warning-surface px-3 py-2 text-meta text-warning">
          <span className="font-medium">Before you apply, check:</span>
          <ul className="flex list-disc flex-col gap-0.5 pl-4">
            {beforeApplying.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      <ul className="flex list-disc flex-col gap-2 pl-4 text-ink">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
