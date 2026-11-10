import type { ApplicationStatus, DocumentKind, NoteKind } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/dates";
import { DOCUMENT_LABELS } from "@/lib/file-name";

// An application's history (E8-9, APP-14): private notes, calls, interviews
// and other entries merged with its status changes, what was sent, and when
// it was created, newest first. Dates and times are formatted here, on the
// server, in the user's time zone.

/** A resume or cover letter as it was sent, to download again. */
export type SentCopy = { id: string; kind: DocumentKind; label: string };

export type ActivityEntry =
  | { kind: "note"; id: string; noteKind: NoteKind; body: string; date: string; at: string; edited: boolean }
  /** `sent` lists what was kept when this change sent the application. */
  | { kind: "status"; id: string; status: ApplicationStatus; date: string; at: string; sent: SentCopy[] }
  /** A send recorded by hand, after the first. */
  | { kind: "sent"; id: string; date: string; at: string; sent: SentCopy[] }
  | { kind: "created"; id: "created"; date: string; at: string };

/** What each kind of entry is called, in the order the picker lists them. */
export const NOTE_KINDS: Record<NoteKind, string> = {
  NOTE: "Note",
  CALL: "Call",
  EMAIL: "Email",
  INTERVIEW: "Interview",
  MEETING: "Meeting",
  UPDATE: "Update",
};

/** Saving a new note sets both times a moment apart; only a later save counts as an edit. */
const EDIT_AFTER_MS = 2000;

type SentRow = { id: string; kind: DocumentKind; eventId: string | null; sentAt: Date };

const copies = (rows: SentRow[]): SentCopy[] =>
  [...rows].sort((a, b) => Number(a.kind !== "RESUME") - Number(b.kind !== "RESUME")).map((row) => ({ id: row.id, kind: row.kind, label: DOCUMENT_LABELS[row.kind] }));

export function activityTimeline({
  notes,
  events,
  sentDocuments = [],
  createdAt,
  timeZone,
  now = new Date(),
}: {
  notes: { id: string; body: string; kind?: NoteKind; at?: Date; createdAt: Date; updatedAt: Date }[];
  events: { id: string; to: ApplicationStatus; at: Date }[];
  sentDocuments?: SentRow[];
  createdAt: Date;
  /** The user's; the server's without one. */
  timeZone?: string;
  now?: Date;
}): ActivityEntry[] {
  const when = (date: Date) => formatDateTime(date, timeZone, now);
  // Sends recorded by hand, one entry per moment.
  const byHand = new Map<number, SentRow[]>();
  for (const row of sentDocuments) if (!row.eventId) byHand.set(row.sentAt.getTime(), [...(byHand.get(row.sentAt.getTime()) ?? []), row]);

  const dated: { at: Date; entry: ActivityEntry }[] = [
    ...notes.map((note) => {
      const at = note.at ?? note.createdAt;
      return {
        at,
        entry: {
          kind: "note" as const,
          id: note.id,
          noteKind: note.kind ?? "NOTE",
          body: note.body,
          date: when(at),
          at: at.toISOString(),
          edited: note.updatedAt.getTime() - note.createdAt.getTime() > EDIT_AFTER_MS,
        },
      };
    }),
    ...events.map((event) => ({
      at: event.at,
      entry: {
        kind: "status" as const,
        id: event.id,
        status: event.to,
        date: when(event.at),
        at: event.at.toISOString(),
        sent: copies(sentDocuments.filter((row) => row.eventId === event.id)),
      },
    })),
    ...[...byHand.values()].map((rows) => ({
      at: rows[0].sentAt,
      entry: { kind: "sent" as const, id: rows[0].id, date: when(rows[0].sentAt), at: rows[0].sentAt.toISOString(), sent: copies(rows) },
    })),
    { at: createdAt, entry: { kind: "created" as const, id: "created" as const, date: when(createdAt), at: createdAt.toISOString() } },
  ];
  // Newest first; the creation always last, even when a status changed the same moment.
  return dated
    .sort((a, b) => (a.entry.kind === "created" ? 1 : b.entry.kind === "created" ? -1 : b.at.getTime() - a.at.getTime()))
    .map(({ entry }) => entry);
}
