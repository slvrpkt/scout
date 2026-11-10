"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { DownloadPdfButton } from "@/components/documents/download-pdf-button";
import { toast } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusDot } from "@/components/ui/status-dot";
import { NoteKind } from "@/generated/prisma/enums";
import { NOTE_KINDS, type ActivityEntry, type SentCopy } from "@/lib/activity";
import { cn } from "@/lib/cn";
import { statusInfo } from "@/lib/status";

import { deleteNote, restoreNote, retryDriveBackup, updateNote } from "./actions";
import { EventComposer, fromLocalInput, KindOptions, problem, textAreaClass, type Draft } from "./event-composer";

/** An ISO moment as a datetime-local input's value, in the browser's zone. */
const toLocalInput = (iso: string) => {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/**
 * The Activity tab (E8-9, APP-14): everything about one application, newest
 * first. What was sent and when, with the exact resume and cover letter to
 * download again; status changes; and the entries the user adds: calls,
 * interviews, emails, meetings, updates and notes, each at the time it
 * happened. Entries never go to the AI.
 */
/** Where what was sent is in Google Drive: the folder once made, why the last save failed, and whether one is running. */
export type DriveState = { folderUrl: string | null; problem: string | null; saving: boolean };

export function NotesTab({ applicationId, activity, drive = null }: { applicationId: string; activity: ActivityEntry[]; drive?: DriveState | null }) {
  const [editing, setEditing] = useState<({ id: string } & Draft) | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (!editing || pending) return;
    startTransition(async () => {
      const result = await updateNote({ id: applicationId, noteId: editing.id, body: editing.body, kind: editing.kind, at: fromLocalInput(editing.when) });
      if (!result.ok) return toast(problem(result));
      setEditing(null);
    });
  };

  // Gone at once, with Undo on the toast (as in the profile).
  const remove = (noteId: string) =>
    startTransition(async () => {
      const result = await deleteNote({ id: applicationId, noteId });
      if (!result.ok) return toast(result.error);
      toast("Entry deleted.", {
        action: {
          label: "Undo",
          onClick: () => void restoreNote({ id: applicationId, ...result.data }).then((restored) => !restored.ok && toast(restored.error)),
        },
      });
    });

  return (
    <div className="@container flex flex-1 flex-col items-center gap-4 overflow-auto bg-canvas px-10 pt-11 pb-16">
      <div className="flex w-full max-w-[1100px] flex-wrap justify-between gap-x-3 gap-y-1 text-meta text-muted">
        <span>Events / Notes</span>
        <span>Private and never sent to the AI</span>
      </div>
      {drive && <DriveLine applicationId={applicationId} drive={drive} />}
      <div className="flex w-full max-w-[1100px] flex-col gap-5 rounded-panel border border-line-card bg-card px-[30px] py-7">
        <EventComposer applicationId={applicationId} />

        <ol aria-label="Events and notes" className="flex flex-col">
          {activity.map((entry) => (
            <li key={`${entry.kind}:${entry.id}`} className="flex items-start gap-3 border-t border-line py-3.5">
              <span className="flex h-[1.4em] w-3 flex-none items-center justify-center" aria-hidden="true">
                {entry.kind === "status" ? (
                  <StatusDot status={entry.status} />
                ) : entry.kind === "created" ? (
                  <span className="size-2 rounded-full border border-faint" />
                ) : entry.kind === "sent" ? (
                  <span className="size-2 rounded-full bg-primary" />
                ) : (
                  <span className="size-2 rounded-full bg-ink" />
                )}
              </span>
              {entry.kind === "note" ? (
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {editing?.id === entry.id ? (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Select label="Reason" value={editing.kind} onChange={(event) => setEditing({ ...editing, kind: event.target.value as NoteKind })}>
                          <KindOptions />
                        </Select>
                        <Input label="When" type="datetime-local" value={editing.when} onChange={(event) => setEditing({ ...editing, when: event.target.value })} />
                      </div>
                      <textarea
                        aria-label="Edit entry"
                        // Opened on request, so the text box takes focus.
                        autoFocus
                        rows={Math.max(3, editing.body.split("\n").length + 1)}
                        value={editing.body}
                        onChange={(event) => setEditing({ ...editing, body: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setEditing(null);
                          else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                            event.preventDefault();
                            save();
                          }
                        }}
                        className={textAreaClass}
                      />
                      <div className="flex justify-end gap-1.5">
                        <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                        <Button size="sm" aria-disabled={pending || undefined} onClick={save}>
                          Save
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      {entry.noteKind !== NoteKind.NOTE && (
                        <span className="self-start rounded-full bg-selected px-2 py-0.5 text-label font-medium">{NOTE_KINDS[entry.noteKind]}</span>
                      )}
                      <EntryBody text={entry.body} />
                      <p className="flex flex-wrap items-baseline gap-x-3 text-label text-muted">
                        <span>
                          {entry.date}
                          {entry.edited && " · edited"}
                        </span>
                        <button
                          type="button"
                          aria-label={`Edit the entry from ${entry.date}`}
                          className="hover:text-ink"
                          onClick={() => setEditing({ id: entry.id, body: entry.body, kind: entry.noteKind, when: toLocalInput(entry.at) })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete the entry from ${entry.date}`}
                          className="text-danger hover:text-error-strong"
                          onClick={() => remove(entry.id)}
                        >
                          Delete
                        </button>
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <p className="flex flex-wrap justify-between gap-x-3 text-sm">
                    <span>{entry.kind === "status" ? `Moved to ${statusInfo(entry.status).label}` : entry.kind === "sent" ? "Applied again" : "Created"}</span>
                    <span className="text-label text-muted">{entry.date}</span>
                  </p>
                  {(entry.kind === "status" || entry.kind === "sent") && entry.sent.length > 0 && <SentCopies copies={entry.sent} />}
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** An entry's text: lines starting with "-", "*" or "•" are bullet points, the rest paragraphs. */
export function EntryBody({ text }: { text: string }) {
  const blocks: { bullets: boolean; lines: string[] }[] = [];
  for (const line of text.split("\n")) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const last = blocks.at(-1);
    if (bullet) {
      if (last?.bullets) last.lines.push(bullet[1]);
      else blocks.push({ bullets: true, lines: [bullet[1]] });
    } else if (last && !last.bullets) last.lines.push(line);
    else blocks.push({ bullets: false, lines: [line] });
  }
  return (
    <div className="flex flex-col gap-1.5 text-sm leading-[1.6]">
      {blocks.map((block, index) =>
        block.bullets ? (
          <ul key={index} className="list-disc pl-5">
            {block.lines.map((line, at) => (
              <li key={at}>{line}</li>
            ))}
          </ul>
        ) : (
          block.lines.join("\n").trim() && (
            <p key={index} className="whitespace-pre-wrap">
              {block.lines.join("\n").trim()}
            </p>
          )
        ),
      )}
    </div>
  );
}

/** Where what was sent is in Google Drive, or why saving it there didn't work, with Try Again. */
function DriveLine({ applicationId, drive }: { applicationId: string; drive: DriveState }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // While a save runs, look again every few seconds to show how it went.
  useEffect(() => {
    if (!drive.saving) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [drive.saving, router]);
  const retry = () =>
    startTransition(async () => {
      const result = await retryDriveBackup({ id: applicationId });
      if (!result.ok) toast(result.error);
    });
  return (
    <div
      role="status"
      className={cn(
        "flex w-full max-w-[1100px] flex-wrap items-center justify-between gap-3 rounded-panel border px-[30px] py-3.5 text-control",
        drive.problem && !drive.saving ? "border-danger-line bg-danger-surface text-error" : "border-line-card bg-card text-muted",
      )}
    >
      <span>
        {drive.saving ? "Saving To Google Drive…" : drive.problem ? drive.problem : "Saved To Google Drive"}
      </span>
      <span className="flex items-center gap-2">
        {drive.problem && !drive.saving && (
          <Button variant="secondary" size="sm" onClick={retry} disabled={pending}>
            {pending ? "Starting…" : "Try Again"}
          </Button>
        )}
        {drive.folderUrl && (
          <a href={drive.folderUrl} target="_blank" rel="noreferrer" className={buttonClassName("secondary", "sm")}>
            Open In Google Drive
          </a>
        )}
      </span>
    </div>
  );
}

/** The resume and cover letter as they were sent, each to download as PDF or Word. */
export function SentCopies({ copies }: { copies: SentCopy[] }) {
  return (
    <ul aria-label="What you applied with" className="flex flex-col gap-1.5">
      {copies.map((copy) => (
        <li key={copy.id} className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line-card bg-input py-1.5 pr-1.5 pl-3">
          <span className="text-control">{copy.label} you applied with</span>
          <span className="flex gap-1.5">
            <DownloadPdfButton variant="secondary" size="sm" href={`/api/pdf?doc=sent&sent=${copy.id}`} progress={`Rendering the ${copy.label.toLowerCase()} as it was sent…`}>
              PDF <span className="sr-only">of the {copy.label.toLowerCase()} you applied with</span>
            </DownloadPdfButton>
            <DownloadPdfButton
              variant="secondary"
              size="sm"
              href={`/api/docx?doc=sent&sent=${copy.id}`}
              progress={`Building the ${copy.label.toLowerCase()} as it was sent…`}
              busyLabel="Building…"
            >
              Word <span className="sr-only">file of the {copy.label.toLowerCase()} you applied with</span>
            </DownloadPdfButton>
          </span>
        </li>
      ))}
    </ul>
  );
}
