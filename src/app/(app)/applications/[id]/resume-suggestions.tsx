"use client";

import { CircleMinus, CirclePlus, Lightbulb } from "lucide-react";
import { useState } from "react";

import { toast } from "@/components/toast";

import { dismissSuggestion, markSuggestionNotTrue } from "./actions";

/**
 * Beside a draft's resume: what the AI thinks would make it a better match,
 * for you to vet. Nothing here is on the resume. If one is true for you, ask
 * for it in the chat on the right, or edit the resume yourself. Dismiss
 * folds one away under the rest ("2 dismissed · Show"), for this resume.
 */
/** How many suggestions show before "Show more". */
const SHOWN = 3;

export function ResumeSuggestions({
  items,
  beforeApplying = [],
  updating = false,
  id = null,
  dismissed: dismissedAtLoad = [],
  onAdd,
}: {
  items: readonly string[];
  beforeApplying?: readonly string[];
  /** Being worked out again after an edit. */
  updating?: boolean;
  /** The application, so a dismissal is remembered; without it there's no Dismiss. */
  id?: string | null;
  /** The ones dismissed before. */
  dismissed?: readonly string[];
  /** Yes, add it: the suggestion goes into the chat box, for you to complete and send. Without it there's no Yes. */
  onAdd?: (suggestion: string) => void;
}) {
  const [dismissed, setDismissed] = useState<readonly string[]>(dismissedAtLoad);
  const [showingDismissed, setShowingDismissed] = useState(false);
  // However many there are, three show; the rest open on request, in a box that scrolls.
  const [showingAll, setShowingAll] = useState(false);
  // Sent to the chat, or marked not true: gone from the list here.
  const [handled, setHandled] = useState<readonly string[]>([]);
  if (items.length === 0 && beforeApplying.length === 0 && !updating) return null;
  const open = items.filter((item) => !dismissed.includes(item) && !handled.includes(item));
  const folded = items.filter((item) => dismissed.includes(item));

  const mark = (text: string, on: boolean) => {
    if (!id) return;
    const before = dismissed;
    setDismissed(on ? [...dismissed, text] : dismissed.filter((entry) => entry !== text));
    void dismissSuggestion({ id, text, dismissed: on }).then((result) => {
      if (!result.ok) {
        setDismissed(before);
        toast(result.error);
      }
    });
  };

  const add = (text: string) => {
    onAdd?.(text);
    setHandled([...handled, text]);
  };
  const notTrue = (text: string) => {
    if (!id) return;
    setHandled([...handled, text]);
    void markSuggestionNotTrue({ id, text }).then((result) => {
      if (!result.ok) {
        setHandled((current) => current.filter((entry) => entry !== text));
        toast(result.error);
      } else toast(`Noted: "${result.data.topic}" won't be suggested again, on any job.`);
    });
  };

  return (
    <section aria-label="Suggestions for this job" className="flex flex-col gap-2.5 rounded-card border border-line bg-card p-4 text-sm">
      <h2 className="flex items-center gap-2 font-medium text-ink">
        <Lightbulb size={15} aria-hidden="true" className="text-warning" />
        Suggestions for this job
      </h2>
      {updating && (
        <p role="status" className="flex items-center gap-2 text-meta text-primary-text">
          <span aria-hidden="true" className="size-3 flex-none animate-spin rounded-full border-2 border-current border-t-transparent" />
          Updating for your latest change…
        </p>
      )}
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
      {open.length > 0 ? (
        <ul aria-label="Suggestions" className={`flex flex-col gap-2 text-ink ${showingAll && open.length > SHOWN ? "max-h-[420px] overflow-y-auto pr-1" : ""}`}>
          {(showingAll ? open : open.slice(0, SHOWN)).map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-[7px] size-1.5 flex-none rounded-full bg-current" />
              <span className="flex flex-1 flex-col gap-1.5">
                {item}
                {id && onAdd && (
                  <span className="flex flex-wrap gap-1.5">
                    <button title="Put this into the chat, to finish and send" type="button" onClick={() => add(item)} className="rounded-[6px] border border-line-field bg-input px-2 py-0.5 text-meta font-medium text-ink hover:border-line-strong">
                      Yes, add it
                    </button>
                    <button title="It's not true for you: it won't be suggested again, on any job" type="button" onClick={() => notTrue(item)} className="rounded-[6px] px-2 py-0.5 text-meta text-muted hover:bg-hover hover:text-ink">
                      Not true
                    </button>
                  </span>
                )}
              </span>
              {id && (
                <button
                  type="button"
                  aria-label={`Dismiss: ${item}`}
                  title="Dismiss"
                  onClick={() => mark(item, true)}
                  className="grid size-6 flex-none place-items-center rounded-[6px] text-muted hover:bg-hover hover:text-ink"
                >
                  <CircleMinus size={15} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        folded.length > 0 && <p className="text-meta text-muted">All dismissed.</p>
      )}
      {open.length > SHOWN && (
        <button
          type="button"
          aria-expanded={showingAll}
          title={showingAll ? "Show only the first three" : "Show every suggestion for this job"}
          onClick={() => setShowingAll(!showingAll)}
          className="self-start text-meta font-medium text-primary-text underline-offset-2 hover:underline"
        >
          {showingAll ? "Show fewer" : `Show ${open.length - SHOWN} more`}
        </button>
      )}
      {folded.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-2">
          <button title="Show or hide the suggestions you dismissed"
            type="button"
            aria-expanded={showingDismissed}
            onClick={() => setShowingDismissed(!showingDismissed)}
            className="self-end text-meta text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            {folded.length} dismissed · {showingDismissed ? "Hide" : "Show"}
          </button>
          {showingDismissed && (
            <ul className="flex max-h-[240px] flex-col gap-1.5 overflow-y-auto pr-1 text-meta text-muted">
              {folded.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="flex-1 line-through">{item}</span>
                  <button
                    type="button"
                    aria-label={`Restore: ${item}`}
                    title="Restore"
                    onClick={() => mark(item, false)}
                    className="grid size-6 flex-none place-items-center rounded-[6px] hover:bg-hover hover:text-ink"
                  >
                    <CirclePlus size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
