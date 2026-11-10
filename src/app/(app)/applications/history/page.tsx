import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { buttonClassName } from "@/components/ui/button";
import { HISTORY_DAYS, loadHistory, type HistoryEntry } from "@/lib/application-history";
import { cn } from "@/lib/cn";
import { userTimeZone } from "@/lib/time-zone";

import { EntryBody, SentCopies } from "../[id]/notes-tab";

export const metadata: Metadata = { title: "Activity log" };

const DOTS: Record<HistoryEntry["type"], string> = {
  applied: "bg-primary",
  sent: "bg-primary",
  status: "bg-muted",
  note: "bg-ink",
  started: "border border-faint",
};

/**
 * The activity log: every day's applications, sends, status changes and
 * entries across all applications, newest first, HISTORY_DAYS days a page.
 */
export default async function ApplicationHistoryPage({ searchParams }: PageProps<"/applications/history">) {
  const until = (await searchParams).until;
  const log = await loadHistory({ until: typeof until === "string" ? until : undefined, timeZone: await userTimeZone() });
  const { applied, responses, entries } = log.totals;

  return (
    <>
      <PageHeader
        title="Activity log"
        description={`Where you applied, what you sent and what happened since, day by day. ${applied} applied, ${responses} status ${responses === 1 ? "change" : "changes"} and ${entries} ${entries === 1 ? "entry" : "entries"} in these ${HISTORY_DAYS} days.`}
        actions={
          <Link href="/applications" className={buttonClassName("secondary")}>
            All applications
          </Link>
        }
      />
      <div className="flex flex-col gap-6 px-10 pb-16">
        {log.days.length === 0 && (
          <p className="rounded-card border border-line-card bg-card px-6 py-5 text-sm text-muted">
            Nothing happened in these {HISTORY_DAYS} days. Applications you send, and calls and notes you add with Add event, show up here.
          </p>
        )}
        {log.days.map((day) => (
          <section key={day.key} aria-labelledby={`day-${day.key}`} className="flex max-w-[860px] flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <h2 id={`day-${day.key}`} className="font-serif text-[20px]">
                {day.label}
              </h2>
              <span className="text-meta text-muted">{day.summary}</span>
            </div>
            <ol className="flex flex-col rounded-panel border border-line-card bg-card px-6">
              {day.entries.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 border-t border-line py-3.5 first:border-t-0">
                  <span className="w-11 flex-none pt-px text-label text-muted tabular-nums">{entry.time}</span>
                  <span className="flex h-[1.4em] w-3 flex-none items-center justify-center" aria-hidden="true">
                    <span className={cn("size-2 rounded-full", DOTS[entry.type])} />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="font-medium">{entry.title}</span>
                      <Link href={`/applications/${entry.application.id}?tab=notes`} className="text-ink underline-offset-2 hover:underline">
                        {[entry.application.role, entry.application.company].filter(Boolean).join(" at ") || "Untitled application"}
                      </Link>
                      {entry.application.postingUrl && entry.type === "applied" && (
                        <a href={entry.application.postingUrl} target="_blank" rel="noreferrer" className="text-label text-muted underline underline-offset-2">
                          posting
                        </a>
                      )}
                    </p>
                    {entry.body && <EntryBody text={entry.body} />}
                    {entry.sent.length > 0 && <SentCopies copies={entry.sent} />}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
        <nav aria-label="More days" className="flex max-w-[860px] justify-between">
          {log.newer ? (
            <Link href={`/applications/history?until=${log.newer}`} className={buttonClassName("secondary", "sm")}>
              Newer
            </Link>
          ) : (
            <span />
          )}
          {log.older && (
            <Link href={`/applications/history?until=${log.older}`} className={buttonClassName("secondary", "sm")}>
              Older
            </Link>
          )}
        </nav>
      </div>
    </>
  );
}
