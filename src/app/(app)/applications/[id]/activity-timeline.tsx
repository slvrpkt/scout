"use client";

import {
  Ban,
  CalendarDays,
  CircleCheck,
  CircleX,
  FilePlus2,
  Gift,
  Hourglass,
  Mail,
  MessageSquareText,
  PhoneCall,
  RefreshCw,
  Send,
  StickyNote,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ApplicationStatus, NoteKind } from "@/generated/prisma/enums";
import { NOTE_KINDS, type ActivityEntry } from "@/lib/activity";
import { statusInfo } from "@/lib/status";

import { EntryBody, SentCopies, type DriveState } from "./notes-tab";

/** A status change's icon. */
const STATUS_ICONS: Record<ApplicationStatus, LucideIcon> = {
  DRAFT: FilePlus2,
  SENT: Send,
  SCREENING: PhoneCall,
  INTERVIEW: Users,
  OFFER: Gift,
  ACCEPTED: CircleCheck,
  REJECTED: CircleX,
  DECLINED: Ban,
};

/** An entry's icon by what happened. */
const NOTE_ICONS: Record<NoteKind, LucideIcon> = {
  NOTE: StickyNote,
  CALL: PhoneCall,
  EMAIL: Mail,
  INTERVIEW: Users,
  MEETING: CalendarDays,
  UPDATE: RefreshCw,
};

const DAY_MS = 86_400_000;
/** A quiet stretch this long or longer shows as its own step on the timeline. */
const GAP_DAYS = 2;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What an entry is called on the timeline. */
function title(entry: ActivityEntry): string {
  if (entry.kind === "created") return "Application created";
  if (entry.kind === "sent") return "Applied again";
  if (entry.kind === "status") return entry.status === ApplicationStatus.SENT ? "Applied" : `Moved to ${statusInfo(entry.status).label}`;
  return NOTE_KINDS[entry.noteKind];
}

/**
 * The Activity tab: everything that happened with this application, oldest
 * first, as a timeline down the page. Each step has an icon for what it was,
 * in the status's colour for status changes; quiet stretches between steps
 * show how long you waited, and the last step says how long it's been since.
 * Read-only: entries are added and changed on Events / Notes.
 */
export function ActivityTimeline({ activity, drive = null, now: nowAt }: { activity: ActivityEntry[]; drive?: DriveState | null; now?: number }) {
  // When the page opened, for "days since the last update".
  const [opened] = useState(() => Date.now());
  const now = nowAt ?? opened;
  const steps = [...activity].reverse();
  const last = steps.at(-1);
  const since = last ? Math.floor((now - Date.parse(last.at)) / DAY_MS) : 0;
  return (
    <div className="flex flex-1 flex-col overflow-auto bg-canvas px-10 pt-8 pb-16">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-serif text-section">The whole story, start to now</h2>
          <span className="text-meta text-muted">
            Add calls, interviews and notes on{" "}
            <Link href="?tab=notes" className="text-muted underline underline-offset-2 hover:text-ink">
              Events / Notes
            </Link>
          </span>
        </div>
        {drive?.folderUrl && (
          <p className="text-meta text-muted">
            What you applied with is saved in{" "}
            <a href={drive.folderUrl} target="_blank" rel="noreferrer" className="text-muted underline underline-offset-2 hover:text-ink">
              Google Drive
            </a>
            .
          </p>
        )}
        <ol aria-label="Timeline" className="relative flex flex-col rounded-panel border border-line-card bg-card px-8 py-7">
          {steps.map((entry, index) => {
            const previous = steps[index - 1];
            const gap = previous ? Math.floor((Date.parse(entry.at) - Date.parse(previous.at)) / DAY_MS) : 0;
            const Icon = entry.kind === "note" ? NOTE_ICONS[entry.noteKind] : entry.kind === "status" ? STATUS_ICONS[entry.status] : entry.kind === "sent" ? Send : FilePlus2;
            const color = entry.kind === "status" ? statusInfo(entry.status).color : entry.kind === "sent" ? statusInfo(ApplicationStatus.SENT).color : undefined;
            return (
              <li key={`${entry.kind}:${entry.id}`} className="flex flex-col">
                {gap >= GAP_DAYS && <Gap days={gap} />}
                <div className="flex gap-4">
                  <span className="flex flex-col items-center">
                    <span
                      className="grid size-9 flex-none place-items-center rounded-full border-2 bg-card"
                      style={{ borderColor: color ?? "var(--color-line-strong)", color: color ?? "var(--color-muted)" }}
                    >
                      <Icon size={16} aria-hidden="true" />
                    </span>
                    {index < steps.length - 1 && <span aria-hidden="true" className="w-0.5 flex-1 bg-line" />}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1.5 pb-6">
                    <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-field font-medium text-ink">{title(entry)}</span>
                      <span className="text-meta text-muted">{entry.date}</span>
                    </p>
                    {entry.kind === "note" && <EntryBody text={entry.body} />}
                    {(entry.kind === "status" || entry.kind === "sent") && entry.sent.length > 0 && <SentCopies copies={entry.sent} />}
                  </div>
                </div>
              </li>
            );
          })}
          {last && since >= 1 && (
            <li className="flex gap-4 text-meta text-muted">
              <span className="grid size-9 flex-none place-items-center">
                <Hourglass size={16} aria-hidden="true" />
              </span>
              <span className="pt-2">{plural(since, "day", "days")} since the last update</span>
            </li>
          )}
        </ol>
        {steps.length <= 1 && (
          <p className="flex items-center gap-2 text-meta text-muted">
            <MessageSquareText size={14} aria-hidden="true" />
            Nothing else has happened yet. Each call, interview and status change will show up here.
          </p>
        )}
      </div>
    </div>
  );
}

/** A quiet stretch between two steps: "Waited 15 days". */
function Gap({ days }: { days: number }) {
  return (
    <div className="flex gap-4">
      <span className="flex w-9 flex-none justify-center">
        <span aria-hidden="true" className="w-0.5 border-l-2 border-dashed border-line-strong" />
      </span>
      <span className="flex items-center gap-1.5 py-2 text-meta text-muted italic">
        <Hourglass size={12} aria-hidden="true" />
        Waited {plural(days, "day", "days")}
      </span>
    </div>
  );
}
