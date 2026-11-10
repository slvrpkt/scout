"use client";

import { Dialog } from "radix-ui";
import { useRef, useState, useTransition, type SyntheticEvent } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { ApplicationRow } from "@/lib/applications-data";

import { textAreaClass } from "./[id]/event-composer";
import { saveThingsToNote } from "./actions";

const MAX = 2000;

/** Whether a note is longer than the cell's three lines show. */
const isLong = (text: string) => text.length > 120 || text.split("\n").length > 3;

/**
 * Things To Note: the role's lasting notes (salary, visa, tech stack…), apart
 * from the dated Activity entries. Up to three lines show; Edit, or More when
 * there's more, opens the whole text to change.
 */
export function ThingsToNoteCell({ row }: { row: Pick<ApplicationRow, "id" | "role" | "company" | "thingsToNote"> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(row.thingsToNote);
  const [draft, setDraft] = useState(row.thingsToNote);
  const [saving, startSaving] = useTransition();
  const opener = useRef<HTMLButtonElement>(null);
  const what = [row.role, row.company].filter(Boolean).join(" at ");
  // The pop-up opens in a portal, but React still passes its events up to the row.
  const stop = (event: SyntheticEvent) => event.stopPropagation();

  const save = () =>
    startSaving(async () => {
      const result = await saveThingsToNote({ id: row.id, text: draft });
      if (!toastResult(result).ok) return;
      setText(draft.trim());
      setOpen(false);
    });

  return (
    <div className="flex flex-col items-start gap-1">
      {text && <p className="line-clamp-3 text-meta whitespace-pre-line text-ink">{text}</p>}
      <button
        ref={opener}
        type="button"
        onClick={() => {
          setDraft(text);
          setOpen(true);
        }}
        className="text-meta text-muted underline underline-offset-2 hover:text-ink"
      >
        {text ? (isLong(text) ? "More" : "Edit") : "Add a note"}
        <span className="sr-only"> about {what}</span>
      </button>
      <div className="contents" onClick={stop} onMouseDown={stop} onPointerDown={stop} onKeyDown={stop}>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
            <Dialog.Content
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                opener.current?.focus();
              }}
              className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-dialog border border-line-popover bg-card p-6 shadow-menu"
            >
              <div className="flex flex-col gap-1">
                <Dialog.Title className="font-serif text-[22px] leading-tight">Things to note</Dialog.Title>
                <Dialog.Description className="text-sm text-muted">{what}</Dialog.Description>
              </div>
              <textarea
                aria-label="Things to note"
                autoFocus
                rows={8}
                maxLength={MAX}
                value={draft}
                placeholder="Salary range, visa, tech stack, who referred you…"
                onChange={(event) => setDraft(event.target.value)}
                className={textAreaClass}
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-meta text-muted">
                  {draft.length} / {MAX}
                </span>
                <span className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" aria-disabled={saving || undefined} onClick={save}>
                    Save
                  </Button>
                </span>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </div>
  );
}
