"use client";

import { ChevronDown, MessagesSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { RecurringQuestion } from "@/lib/recurring-questions";

import { answerRecurringQuestion, decideRecurringQuestion } from "./actions";

/**
 * Questions that keep coming up, above Drafts to review: a suggestion two or
 * more drafts raise, to answer once. Yes, it's true keeps the fact in your
 * profile and puts it on the drafts that asked (only those); Not true means
 * it's never suggested again; Later puts it away until tomorrow; Dismiss puts
 * it away for good.
 */
/** How many questions a page of the box shows. */
export const QUESTIONS_PAGE = 3;

export function RecurringQuestions({ questions, roles }: { questions: readonly RecurringQuestion[]; roles: readonly { id: string; label: string }[] }) {
  // Folded away by default: open it when you want to fix several drafts at once.
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const panel = useId();
  if (questions.length === 0) return null;
  const pages = Math.ceil(questions.length / QUESTIONS_PAGE);
  // Answering one takes it off the list, so the page can run past the end.
  const at = Math.min(page, pages - 1);
  const shown = questions.slice(at * QUESTIONS_PAGE, (at + 1) * QUESTIONS_PAGE);
  const count = `${questions.length} ${questions.length === 1 ? "item" : "items"}`;
  return (
    <section aria-label="Questions that keep coming up" className="flex flex-col rounded-card border border-line-card bg-card">
      <button title="Show or hide what several drafts are missing, to answer it once for all of them"
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 rounded-card px-4 py-2.5 text-left normal-case hover:bg-hover"
      >
        <MessagesSquare size={16} aria-hidden="true" className="flex-none text-primary-text" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-ink">
            {open ? "Review and fix what several drafts are missing, all at once" : "Click here to review and fix what several drafts are missing, all at once"}
            <span className="ml-2 rounded-full bg-selected px-2 py-0.5 text-xs font-medium text-primary-text">{count}</span>
          </span>
          <span className="text-meta text-muted">
            The same thing your resume doesn&apos;t say, asked for by two drafts or more. Answer it once: it&apos;s kept in your profile and added to the drafts you pick.
          </span>
        </span>
        <ChevronDown size={16} aria-hidden="true" className={`flex-none text-muted motion-safe:transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={panel} className="flex flex-col gap-2 border-t border-line px-4 pt-3 pb-3">
          {/* A box of its own: it scrolls inside rather than pushing the drafts down. */}
          <ul aria-label="Items to review" className="flex max-h-[320px] flex-col divide-y divide-line overflow-y-auto pr-1">
            {shown.map((question) => (
              <li key={question.topic} className="py-3 first:pt-0 last:pb-0">
                <Question question={question} roles={roles} />
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <nav aria-label="Pages of items" className="flex items-center justify-end gap-2 border-t border-line pt-2 text-meta text-muted">
              <span>
                {at * QUESTIONS_PAGE + 1}–{Math.min((at + 1) * QUESTIONS_PAGE, questions.length)} of {questions.length}
              </span>
              <Button title="Show the previous three items" variant="secondary" size="sm" disabled={at === 0} onClick={() => setPage(at - 1)}>
                Previous
              </Button>
              <Button title="Show the next three items" variant="secondary" size="sm" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>
                Next
              </Button>
            </nav>
          )}
        </div>
      )}
    </section>
  );
}

function Question({ question, roles }: { question: RecurringQuestion; roles: readonly { id: string; label: string }[] }) {
  const router = useRouter();
  const [answering, setAnswering] = useState(false);
  const [text, setText] = useState(question.guess);
  const [target, setTarget] = useState(question.roleId ?? "facts");
  const [picked, setPicked] = useState<string[]>(question.drafts.map((draft) => draft.applicationId));
  const [pending, startTransition] = useTransition();
  const ids = useId();
  const names = question.drafts.map((draft) => draft.company);

  const decide = (state: "not-true" | "dismissed" | "later") =>
    startTransition(async () => {
      if (!toastResult(await decideRecurringQuestion({ topic: question.topic, state })).ok) return;
      toast(state === "not-true" ? `Noted: never suggested again. Taken off ${names.length} drafts.` : state === "later" ? "Put away until tomorrow." : "Dismissed.");
      router.refresh();
    });

  const save = () =>
    startTransition(async () => {
      const result = await answerRecurringQuestion({ topic: question.topic, text, target, applicationIds: picked });
      if (!toastResult(result).ok || !result.ok) return;
      toast(`Kept in ${result.data.where}. Adding it to ${result.data.started} ${result.data.started === 1 ? "draft" : "drafts"} now: each takes a minute.`);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-ink">{question.topic}</span>
        <span className="text-meta text-muted">
          Asked by {names.length} drafts: {names.join(", ")}
        </span>
        {question.guess && !answering && <span className="text-meta text-muted">What points to it: {question.guess}</span>}
      </div>

      {answering ? (
        <div className="flex flex-col gap-2.5 rounded-control bg-surface p-3">
          <label htmlFor={`${ids}-text`} className="text-meta font-medium">
            What&apos;s true, in your words
          </label>
          <textarea
            id={`${ids}-text`}
            rows={2}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="w-full resize-y rounded-control border border-line-input bg-input px-3 py-2 text-sm focus-visible:border-primary focus-visible:outline-offset-0"
          />
          <label className="flex flex-col gap-1 text-meta font-medium">
            Add to
            <select value={target} onChange={(event) => setTarget(event.target.value)} className="h-8 rounded-control border border-line-field bg-input px-2 text-sm font-normal">
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.label} role
                </option>
              ))}
              <option value="facts">Facts about me</option>
            </select>
          </label>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-meta font-medium">Add it to these drafts now</legend>
            {question.drafts.map((draft) => (
              <label key={draft.applicationId} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={picked.includes(draft.applicationId)}
                  onChange={(event) => setPicked(event.target.checked ? [...picked, draft.applicationId] : picked.filter((id) => id !== draft.applicationId))}
                />
                {draft.company}
              </label>
            ))}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button title="Close without saving your answer" variant="secondary" size="sm" onClick={() => setAnswering(false)} disabled={pending}>
              Cancel
            </Button>
            <Button title="Save it to your profile and add it to the drafts you ticked" size="sm" aria-disabled={pending || !text.trim() || undefined} onClick={() => !pending && text.trim() && save()}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button title="It's true for you: write it in your words and choose which drafts get it" size="sm" onClick={() => setAnswering(true)} disabled={pending}>
            Yes, it&apos;s true
          </Button>
          <Button title="It's not true for you: it's taken off these drafts and never suggested again" variant="secondary" size="sm" onClick={() => decide("not-true")} disabled={pending}>
            Not true
          </Button>
          <Button title="Put it away until tomorrow" variant="text" size="sm" onClick={() => decide("later")} disabled={pending}>
            Later
          </Button>
          <Button title="Put it away for good, without changing your profile" variant="text" size="sm" onClick={() => decide("dismissed")} disabled={pending}>
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
