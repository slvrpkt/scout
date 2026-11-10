"use client";

import Link from "next/link";
import { Dialog } from "radix-ui";
import { useEffect, useRef, useState, type RefObject, type SyntheticEvent } from "react";

import { buttonClassName } from "@/components/ui/button";
import { NoteKind } from "@/generated/prisma/enums";
import { NOTE_KINDS, type ActivityEntry } from "@/lib/activity";
import type { ApplicationRow } from "@/lib/applications-data";
import { statusInfo } from "@/lib/status";

import { EventComposer } from "./[id]/event-composer";
import { EntryBody } from "./[id]/notes-tab";
import { loadActivity } from "./actions";

/**
 * "Add event" from the applications list (table and board): the Activity
 * tab's form in a pop-up, so a call or an interview is logged without
 * opening the application. Closes once the event is added.
 */
export function AddEventDialog({
  row,
  open,
  onOpenChange,
  returnFocusTo,
}: {
  row: Pick<ApplicationRow, "id" | "role" | "company">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusTo?: RefObject<HTMLElement | null>;
}) {
  const stop = (event: SyntheticEvent) => event.stopPropagation();
  return (
    // The pop-up opens in a portal, but React still passes its events up to
    // the row or card: typing in it mustn't open the application or start a drag.
    <div className="contents" onClick={stop} onMouseDown={stop} onPointerDown={stop} onTouchStart={stop} onKeyDown={stop}>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content
            onCloseAutoFocus={(event) => {
              if (!returnFocusTo?.current?.isConnected) return;
              event.preventDefault();
              returnFocusTo.current.focus();
            }}
            className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-dialog border border-line-popover bg-card p-6 shadow-menu"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <Dialog.Title className="font-serif text-[22px] leading-tight">Add an event</Dialog.Title>
                <Dialog.Description className="text-sm text-muted">{[row.role, row.company].filter(Boolean).join(" at ")}</Dialog.Description>
              </div>
              <Dialog.Close aria-label="Close" className="grid size-8 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink">
                <span aria-hidden="true" className="text-lg leading-none">
                  ×
                </span>
              </Dialog.Close>
            </div>
            <EventComposer applicationId={row.id} autoFocus onAdded={() => onOpenChange(false)} />
            <Link href={`/applications/${row.id}?tab=notes`} className="self-start text-meta text-muted underline underline-offset-2 hover:text-ink">
              See all of its activity
            </Link>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

/**
 * The table's Activity column: the latest event's text, a few lines
 * of it (three lines), with More for everything that happened (as on the Activity tab), and
 * Add Event, which is always there for the next one.
 */
export function ActivityCell({ row }: { row: Pick<ApplicationRow, "id" | "role" | "company" | "latestEvent"> }) {
  const [showing, setShowing] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  return (
    <div className="flex flex-col items-start gap-1.5">
      {row.latestEvent && (
        <p className="line-clamp-3 text-meta text-ink">
          <span className="font-medium">{NOTE_KINDS[row.latestEvent.kind]}:</span> {row.latestEvent.body}
        </p>
      )}
      <span className="flex items-center gap-2">
        <AddEventButton row={row} />
        {row.latestEvent && (
          <button ref={more} type="button" onClick={() => setShowing(true)} className="text-meta text-muted underline underline-offset-2 hover:text-ink">
            More{" "}
            <span className="sr-only">about {[row.role, row.company].filter(Boolean).join(" at ")}</span>
          </button>
        )}
      </span>
      {showing && <ActivityDialog row={row} onClose={() => setShowing(false)} returnFocusTo={more} />}
    </div>
  );
}

/** Everything that happened to an application, newest first, in a pop-up: what its Activity tab lists. */
function ActivityDialog({ row, onClose, returnFocusTo }: { row: Pick<ApplicationRow, "id" | "role" | "company">; onClose: () => void; returnFocusTo: RefObject<HTMLElement | null> }) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    void loadActivity({ id: row.id }).then((result) => (result.ok ? setEntries(result.data) : setProblem(result.error)));
  }, [row.id]);
  const stop = (event: SyntheticEvent) => event.stopPropagation();
  return (
    <div className="contents" onClick={stop} onMouseDown={stop} onPointerDown={stop} onTouchStart={stop} onKeyDown={stop}>
      <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content
            onCloseAutoFocus={(event) => {
              if (!returnFocusTo.current?.isConnected) return;
              event.preventDefault();
              returnFocusTo.current.focus();
            }}
            className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[min(600px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-dialog border border-line-popover bg-card p-6 shadow-menu"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <Dialog.Title className="font-serif text-[22px] leading-tight">Activity</Dialog.Title>
                <Dialog.Description className="text-sm text-muted">{[row.role, row.company].filter(Boolean).join(" at ")}</Dialog.Description>
              </div>
              <Dialog.Close aria-label="Close" className="grid size-8 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink">
                <span aria-hidden="true" className="text-lg leading-none">
                  ×
                </span>
              </Dialog.Close>
            </div>
            {problem ? (
              <p role="alert" className="text-sm text-error">
                {problem}
              </p>
            ) : !entries ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : (
              <ol aria-label="Activity" className="flex flex-col">
                {entries.map((entry) => (
                  <li key={`${entry.kind}:${entry.id}`} className="flex flex-col gap-1.5 border-t border-line py-3 first:border-t-0">
                    {entry.kind === "note" ? (
                      <>
                        {entry.noteKind !== NoteKind.NOTE && (
                          <span className="self-start rounded-full bg-selected px-2 py-0.5 text-label font-medium">{NOTE_KINDS[entry.noteKind]}</span>
                        )}
                        <EntryBody text={entry.body} />
                        <span className="text-label text-muted">{entry.date}</span>
                      </>
                    ) : (
                      <p className="flex flex-wrap justify-between gap-x-3 text-sm">
                        <span>{entry.kind === "status" ? `Moved to ${statusInfo(entry.status).label}` : entry.kind === "sent" ? "Applied again" : "Created"}</span>
                        <span className="text-label text-muted">{entry.date}</span>
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
            <Link href={`/applications/${row.id}?tab=notes`} className="self-start text-meta text-muted underline underline-offset-2 hover:text-ink">
              Open its Activity tab
            </Link>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

/** The table's "Add event" button, with its pop-up. */
export function AddEventButton({ row }: { row: Pick<ApplicationRow, "id" | "role" | "company"> }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={button} type="button" onClick={() => setOpen(true)} className={buttonClassName("secondary", "sm")}>
        Add event{" "}
        <span className="sr-only">for {[row.role, row.company].filter(Boolean).join(" at ")}</span>
      </button>
      <AddEventDialog row={row} open={open} onOpenChange={setOpen} returnFocusTo={button} />
    </>
  );
}
