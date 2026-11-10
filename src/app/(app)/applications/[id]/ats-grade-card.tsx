"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import { Dialog } from "radix-ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ScoreBadge } from "@/components/score-badge";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { ATS_GOAL, type AtsGrade } from "@/lib/ats-grade";

import { rewriteToA } from "./actions";

/**
 * A tailored resume's ATS score, in the same circle as a posting's fit score:
 * click it for why it got that score and, below an A, what would bring it up.
 * You decide what applies to you; nothing is rewritten until you ask.
 */
export function AtsScore({ id, grade, draft }: { id: string; grade: AtsGrade; draft: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const rewrite = () =>
    !pending &&
    startTransition(async () => {
      if (toastResult(await rewriteToA({ id })).ok) router.refresh();
    });
  const reached = grade.score >= ATS_GOAL;
  const toFix = grade.missing.length + grade.fixes.length;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="inline-flex flex-none items-center gap-2 rounded-full whitespace-nowrap hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" title="Why this ATS score">
        <span aria-hidden="true">ATS score</span>
        <ScoreBadge score={grade.score} letter={grade.letter} />
        <span className="sr-only">: ATS score {grade.letter}, why it got this score</span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[min(600px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-dialog border border-line-popover bg-card p-6 shadow-menu">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <ScoreBadge score={grade.score} letter={grade.letter} />
              <div className="flex flex-col gap-0.5">
                <Dialog.Title className="font-serif text-[22px] leading-tight">ATS grade: {grade.letter}</Dialog.Title>
                <Dialog.Description className="text-sm text-muted">
                  {grade.score} of 100 · Format {grade.format}
                  {grade.match !== null && ` · Job match ${grade.match}%`}
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close aria-label="Close" className="grid size-8 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink">
              <span aria-hidden="true" className="text-lg leading-none">
                ×
              </span>
            </Dialog.Close>
          </div>

          <p className="text-sm text-muted">
            {grade.match === null
              ? "This posting lists no requirements to match, so the score is Format alone."
              : "Half is Format, whether an ATS can read the resume. Half is Job match, how much of what the posting asks for appears in it, with hard skills, years and degrees counting double, and a skill counted under any of its names, such as PMP or Project Management Professional."}{" "}
            It&apos;s Scout&apos;s own measure, not a score from any ATS.
          </p>

          <section aria-label="Why it got this score" className="flex flex-col gap-1.5">
            <h3 className="text-[15px] font-medium">Why it got this score</h3>
            <ul className="flex flex-col gap-1.5">
              {grade.checks.map((check) => (
                <li key={check.label} className="flex items-start gap-2 text-sm">
                  {check.earned >= check.points ? (
                    <CircleCheck size={15} aria-hidden="true" className="mt-0.5 flex-none text-success" />
                  ) : (
                    <CircleAlert size={15} aria-hidden="true" className="mt-0.5 flex-none text-warning" />
                  )}
                  <span className="flex-1">{check.label}</span>
                  <span className="flex-none text-meta text-muted">
                    {Math.round(check.earned)} of {check.points}
                  </span>
                </li>
              ))}
              {grade.covered.length > 0 && (
                <li className="flex items-start gap-2 text-sm">
                  <CircleCheck size={15} aria-hidden="true" className="mt-0.5 flex-none text-success" />
                  <span>On the resume from the posting: {grade.covered.join(", ")}</span>
                </li>
              )}
            </ul>
          </section>

          {grade.beforeApplying.length > 0 && (
            <section aria-label="Before you apply" className="flex flex-col gap-1.5">
              <h3 className="text-[15px] font-medium">Before you apply</h3>
              <p className="text-meta text-muted">The posting asks for these, which no resume can show. Check them first.</p>
              <ul className="flex flex-col gap-1.5">
                {grade.beforeApplying.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <CircleAlert size={15} aria-hidden="true" className="mt-0.5 flex-none text-warning" />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!reached && toFix > 0 && (
            <section aria-label="What would bring it up to an A" className="flex flex-col gap-1.5">
              <h3 className="text-[15px] font-medium">What would bring it up to an A</h3>
              <ul className="flex flex-col gap-1.5">
                {grade.missing.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <CircleAlert size={15} aria-hidden="true" className="mt-0.5 flex-none text-warning" />
                    Not on the resume yet: {item}
                  </li>
                ))}
                {grade.fixes.map((fix) => (
                  <li key={fix} className="flex items-start gap-2 text-sm">
                    <CircleAlert size={15} aria-hidden="true" className="mt-0.5 flex-none text-warning" />
                    {fix}
                  </li>
                ))}
              </ul>
              {grade.missing.length > 0 && (
                <p className="text-meta text-muted">
                  Only keep what&apos;s true for you. If you have one of these, add it to your Profile or tell the AI in the chat, then rewrite. A rewrite adds only what your profile backs, so it won&apos;t invent the rest.
                </p>
              )}
            </section>
          )}

          {grade.tips.length > 0 && (
            <section aria-label="Worth a look" className="flex flex-col gap-1.5">
              <h3 className="text-[15px] font-medium">Worth a look</h3>
              <p className="text-meta text-muted">These don&apos;t change the score, but recruiters notice them.</p>
              <ul className="flex flex-col gap-1.5">
                {grade.tips.map((tip) => (
                  <li key={tip} className="flex items-start gap-2 text-sm">
                    <CircleAlert size={15} aria-hidden="true" className="mt-0.5 flex-none text-muted" />
                    {tip}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {draft && !reached && (
            <div className="flex justify-end">
              <Button aria-disabled={pending || undefined} onClick={rewrite}>
                {pending ? "Rewriting, up to 3 tries…" : "Rewrite to Reach A"}
              </Button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
