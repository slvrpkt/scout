import "server-only";

import { ApplicationStatus, NoteKind } from "@/generated/prisma/enums";
import { NOTE_KINDS, type SentCopy } from "@/lib/activity";
import { formatDay, formatTime } from "@/lib/dates";
import { DOCUMENT_LABELS } from "@/lib/file-name";
import { prisma } from "@/lib/prisma";
import { statusInfo } from "@/lib/status";

// Every application's history in one log, day by day (application history):
// where the user applied, what was sent, what changed and what they noted,
// newest first, in the user's time zone. The application page's History tab
// has the same entries for one application.

/** Days on one page of the log. */
export const HISTORY_DAYS = 14;

export type HistoryEntry = {
  id: string;
  /** "14:05" */
  time: string;
  type: "applied" | "status" | "sent" | "note" | "started";
  /** "Applied", "Moved to Interview", "Call", … */
  title: string;
  /** A note's text; empty otherwise. */
  body: string;
  application: { id: string; company: string; role: string; postingUrl: string };
  sent: SentCopy[];
};

export type HistoryDay = {
  /** "2026-11-03" */
  key: string;
  /** "Tue 3 Nov" */
  label: string;
  /** "4 applied · 2 calls" */
  summary: string;
  entries: HistoryEntry[];
};

export type HistoryLog = {
  days: HistoryDay[];
  /** Totals over the page's days. */
  totals: { applied: number; responses: number; entries: number };
  /** The day before the page's first, for "Older", when anything is older. */
  older: string | null;
  /** The day after the page's last, for "Newer", unless it ends today. */
  newer: string | null;
};

/** "2026-11-03" for a moment in a time zone. */
export function dayKey(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(date);
}

const shiftDay = (key: string, days: number) => new Date(Date.parse(`${key}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** "4 applied · 2 calls · 1 interview" */
function summarize(entries: HistoryEntry[]): string {
  const applied = entries.filter((entry) => entry.type === "applied").length;
  const sent = entries.filter((entry) => entry.type === "sent").length;
  const changes = entries.filter((entry) => entry.type === "status").length;
  const notes = Object.values(NoteKind).flatMap((kind) => {
    const count = entries.filter((entry) => entry.type === "note" && entry.title === NOTE_KINDS[kind]).length;
    return count ? [plural(count, NOTE_KINDS[kind].toLowerCase())] : [];
  });
  return [applied && `${applied} applied`, sent && `${sent} sent again`, changes && plural(changes, "status change"), ...notes].filter(Boolean).join(" · ");
}

/**
 * The log's page ending on `until` ("YYYY-MM-DD", today by default): the
 * HISTORY_DAYS days up to it that have anything, newest first.
 */
export async function loadHistory({ until, timeZone, now = new Date() }: { until?: string; timeZone?: string; now?: Date }): Promise<HistoryLog> {
  const today = dayKey(now, timeZone);
  const last = until && /^\d{4}-\d{2}-\d{2}$/.test(until) && until < today ? until : today;
  const first = shiftDay(last, -(HISTORY_DAYS - 1));
  // A day wider on each side, so every time zone's days are in; the keys pick the page's.
  const range = { gte: new Date(Date.parse(`${first}T00:00:00Z`) - 86_400_000), lt: new Date(Date.parse(`${last}T00:00:00Z`) + 2 * 86_400_000) };
  const application = { select: { id: true, company: true, role: true, postingUrl: true } } as const;

  const [events, notes, sends, started, earlier] = await Promise.all([
    prisma.statusEvent.findMany({
      where: { at: range },
      select: { id: true, to: true, at: true, previousSentAt: true, application, sentDocuments: { select: { id: true, kind: true } } },
    }),
    prisma.note.findMany({ where: { at: range }, select: { id: true, kind: true, body: true, at: true, application } }),
    prisma.sentDocument.findMany({ where: { sentAt: range, eventId: null }, select: { id: true, kind: true, sentAt: true, application } }),
    // Agent drafts waiting for review aren't the user's yet.
    prisma.application.findMany({ where: { createdAt: range, awaitingReview: false }, select: { ...application.select, createdAt: true } }),
    prisma.statusEvent.count({ where: { at: { lt: range.gte } } }),
  ]);

  const copies = (rows: { id: string; kind: keyof typeof DOCUMENT_LABELS }[]): SentCopy[] =>
    [...rows].sort((a, b) => Number(a.kind !== "RESUME") - Number(b.kind !== "RESUME")).map((row) => ({ id: row.id, kind: row.kind, label: DOCUMENT_LABELS[row.kind] }));
  const withApp = (app: { id: string; company: string; role: string; postingUrl: string }) => ({
    ...app,
    postingUrl: /^https?:\/\//i.test(app.postingUrl) ? app.postingUrl : "",
  });

  const dated: { at: Date; entry: HistoryEntry }[] = [
    ...events.map((event) => {
      // The change that first sent it: where the user applied.
      const applied = event.previousSentAt === null && event.to !== ApplicationStatus.DRAFT && event.to !== ApplicationStatus.DECLINED;
      return {
        at: event.at,
        entry: {
          id: `status:${event.id}`,
          time: formatTime(event.at, timeZone),
          type: applied ? ("applied" as const) : ("status" as const),
          title: applied ? "Applied" : `Moved to ${statusInfo(event.to).label}`,
          body: "",
          application: withApp(event.application),
          sent: copies(event.sentDocuments),
        },
      };
    }),
    ...notes.map((note) => ({
      at: note.at,
      entry: {
        id: `note:${note.id}`,
        time: formatTime(note.at, timeZone),
        type: "note" as const,
        title: NOTE_KINDS[note.kind],
        body: note.body,
        application: withApp(note.application),
        sent: [],
      },
    })),
    // A send recorded by hand saves its copies at one moment: one entry for them.
    ...[...sends.reduce((groups, send) => groups.set(`${send.application.id}:${send.sentAt.getTime()}`, [...(groups.get(`${send.application.id}:${send.sentAt.getTime()}`) ?? []), send]), new Map<string, typeof sends>()).values()].map(
      (rows) => ({
        at: rows[0].sentAt,
        entry: {
          id: `sent:${rows[0].id}`,
          time: formatTime(rows[0].sentAt, timeZone),
          type: "sent" as const,
          title: "Applied again",
          body: "",
          application: withApp(rows[0].application),
          sent: copies(rows),
        },
      }),
    ),
    ...started.map(({ createdAt, ...app }) => ({
      at: createdAt,
      entry: { id: `started:${app.id}`, time: formatTime(createdAt, timeZone), type: "started" as const, title: "Started", body: "", application: withApp(app), sent: [] },
    })),
  ];

  const byDay = new Map<string, { at: Date; entry: HistoryEntry }[]>();
  for (const item of dated) {
    const key = dayKey(item.at, timeZone);
    if (key < first || key > last) continue;
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }
  const days = [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, items]) => {
      const entries = items.sort((a, b) => b.at.getTime() - a.at.getTime()).map((item) => item.entry);
      return { key, label: formatDay(items[0].at, timeZone, now), summary: summarize(entries), entries };
    });
  const all = days.flatMap((day) => day.entries);

  return {
    days,
    totals: {
      applied: all.filter((entry) => entry.type === "applied").length,
      responses: all.filter((entry) => entry.type === "status").length,
      entries: all.filter((entry) => entry.type === "note").length,
    },
    older: earlier > 0 || (await prisma.note.count({ where: { at: { lt: range.gte } } })) > 0 ? shiftDay(first, -1) : null,
    newer: last < today ? (shiftDay(last, HISTORY_DAYS) < today ? shiftDay(last, HISTORY_DAYS) : today) : null,
  };
}
