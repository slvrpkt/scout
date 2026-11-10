"use client";

import { useId, useState, useTransition } from "react";

import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { NoteKind } from "@/generated/prisma/enums";
import { NOTE_KINDS } from "@/lib/activity";

import { addNote } from "./actions";

/** A datetime-local input's value as an ISO moment, or undefined when empty (now). */
export const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : undefined);

export const textAreaClass =
  "w-full resize-y rounded-control border border-line-input bg-input px-3 py-2.5 text-sm leading-normal placeholder:text-muted focus-visible:border-primary focus-visible:outline-offset-0";

/** What's wrong, in the field's own words when it's one field. */
export const problem = (result: { error: string; fieldErrors?: Partial<Record<string, string[]>> }) =>
  Object.values(result.fieldErrors ?? {}).flat().find(Boolean) ?? result.error;

export type Draft = { body: string; kind: NoteKind; when: string };
const EMPTY: Draft = { body: "", kind: NoteKind.NOTE, when: "" };

export function KindOptions() {
  return Object.entries(NOTE_KINDS).map(([kind, label]) => (
    <option key={kind} value={kind}>
      {label}
    </option>
  ));
}

/**
 * Adding an event to an application's activity: a call, interview, email,
 * meeting, update or note, dated the moment it's added. On the Activity tab,
 * and in the pop-up the applications list opens.
 */
export function EventComposer({ applicationId, onAdded, autoFocus = false }: { applicationId: string; onAdded?: () => void; autoFocus?: boolean }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [pending, startTransition] = useTransition();
  const draftId = useId();

  const add = () => {
    if (!draft.body.trim() || pending) return;
    startTransition(async () => {
      const result = await addNote({ id: applicationId, body: draft.body, kind: draft.kind });
      if (!result.ok) return toast(problem(result));
      setDraft(EMPTY);
      toast(`${NOTE_KINDS[draft.kind]} added.`);
      onAdded?.();
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2.5">
        <label htmlFor={draftId} className="text-[15px] font-medium">
          Add an event
        </label>
        <Select label="Reason" className="sm:w-1/2" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as NoteKind })}>
          <KindOptions />
        </Select>
        <textarea
          id={draftId}
          rows={4}
          // Opened on request in the pop-up, so the text box takes focus there.
          autoFocus={autoFocus}
          value={draft.body}
          placeholder={"Who you talked to, what they said, what's next…\n- Start a line with - for a bullet point"}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              add();
            }
          }}
          className={textAreaClass}
        />
        <div className="flex justify-end">
          <Button size="sm" aria-disabled={!draft.body.trim() || pending || undefined} onClick={add}>
            Add event
          </Button>
        </div>
      </div>
    </div>
  );
}
