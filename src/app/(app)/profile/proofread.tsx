"use client";

import { Dialog } from "radix-ui";
import { useEffect, useRef, useState } from "react";

import type { ProofreadIssue } from "@/lib/ai/tasks/proofread-profile";
import type { ProfileData } from "@/lib/profile";
import { changedPieces, profilePieces } from "@/lib/profile-pieces";

import { proofreadProfileNow } from "./actions";

/** How long after the last save it waits, so a burst of typing is checked once. */
export const PROOFREAD_AFTER_MS = 4000;

/**
 * Proofreads on its own after you save: a few seconds after the last save, the
 * text that changed since the last check is sent, never the whole profile
 * again. Mistakes stay listed until the words are gone or you dismiss them;
 * nothing is changed for you.
 */
export function Proofread({ profile, savedAt }: { profile: ProfileData; savedAt: Date | null }) {
  const latest = useRef(profile);
  useEffect(() => {
    latest.current = profile;
  }, [profile]);
  // What was on the page when it opened counts as checked: only edits are proofread.
  const [checked] = useState(() => new Set(profilePieces(profile).map((piece) => piece.text)));
  const [checking, setChecking] = useState(false);
  const [issues, setIssues] = useState<ProofreadIssue[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!savedAt) return;
    const timer = setTimeout(async () => {
      const pieces = changedPieces(profilePieces(latest.current), checked).slice(0, 40);
      if (pieces.length === 0) return;
      setChecking(true);
      try {
        const result = await proofreadProfileNow({ pieces: pieces.map((piece) => ({ where: piece.where, text: piece.text.slice(0, 4000) })) });
        if (!result.ok) return; // No AI set up, or a limit reached: proofreading quietly waits.
        for (const piece of pieces) checked.add(piece.text);
        setIssues((current) => [...current.filter((issue) => !pieces.some((piece) => piece.where === issue.where)), ...result.data]);
      } finally {
        setChecking(false);
      }
    }, PROOFREAD_AFTER_MS);
    return () => clearTimeout(timer);
  }, [savedAt, checked]);

  // A mistake you've fixed drops off once its words are no longer in the profile.
  const allText = profilePieces(profile).map((piece) => piece.text).join("\n");
  const open_ = issues.filter((issue) => allText.includes(issue.wrong.trim()));
  const dismiss = (issue: ProofreadIssue) => setIssues((current) => current.filter((entry) => entry !== issue));

  if (checking) return <span className="text-meta text-muted" role="status">Proofreading…</span>;
  if (open_.length === 0) return null;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="rounded-control px-2 py-1 text-meta font-medium text-warning underline-offset-2 hover:underline">
        {open_.length === 1 ? "1 typo to fix" : `${open_.length} typos to fix`}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[min(600px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-dialog border border-line-popover bg-card p-6 shadow-menu">
          <Dialog.Title className="font-serif text-[22px] leading-tight">{open_.length === 1 ? "1 to fix" : `${open_.length} to fix`}</Dialog.Title>
          <Dialog.Description className="text-sm text-muted">
            Found when you saved. Every resume is written from your profile, so a typo here shows up in all of them. Fix these where they are; nothing has been changed for you.
          </Dialog.Description>
          <ul className="flex flex-col gap-2.5 text-sm">
            {open_.map((issue, index) => (
              <li key={index} className="flex items-start justify-between gap-3 border-t border-line pt-2.5">
                <span className="flex flex-col gap-0.5">
                  <span className="text-meta text-muted">{issue.where}</span>
                  <span>
                    <s className="text-muted">{issue.wrong}</s> → <span className="font-medium">{issue.right}</span>
                  </span>
                </span>
                <button type="button" onClick={() => dismiss(issue)} className="shrink-0 rounded-control px-2 py-1 text-meta text-muted hover:bg-hover hover:text-ink">
                  It&apos;s right
                </button>
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Dialog.Close className="rounded-control px-3 py-1.5 text-sm font-medium text-ink hover:bg-hover">Close</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
