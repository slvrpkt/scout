"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";

import { changeStatus } from "@/components/change-status";

import { PageHeader } from "@/components/page-header";
import { buttonClassName } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { ApplicationStatus } from "@/generated/prisma/enums";
import type { ApplicationRow } from "@/lib/applications-data";
import { FILTERS, listHref, statusesIn, type Filter, type ListParams, type View } from "@/lib/applications-list";
import { cn } from "@/lib/cn";

import { rememberListView } from "./actions";
import { Board } from "./board";
import { SheetSync, type SheetState } from "./sheet-sync";
import { Table } from "./table";

export type ApplicationsScreenProps = {
  params: ListParams;
  /** The applications in view: filtered, searched and sorted. */
  rows: ApplicationRow[];
  /** How many each filter holds, before searching. */
  counts: Record<Filter, number>;
  summary: string;
  /** No applications at all yet. */
  empty: boolean;
  /** Archived applications, hidden unless shown (E9-5). */
  archivedCount: number;
  /** The log's Google Sheet: whether it can be synced, its link once made, and the last sync. */
  sheet?: SheetState;
};

const NO_SHEET: SheetState = { ready: false, url: null, syncedAt: null, problem: null };

const HINTS: Record<View, string> = {
  board: "Drag a card to change its status",
  table: "Click a row to open it",
};

/** Applications on a page of the table; the board's columns scroll instead. */
export const PAGE_SIZE = 25;

/** How long typing pauses before the search runs. */
const SEARCH_DELAY_MS = 250;

/**
 * The Applications screen (LST-1, LST-2): the summary, Board / Table, search
 * and filters. Every change goes into the URL and the server answers with
 * the matching applications.
 */
export function ApplicationsScreen({ params, rows, counts, summary, empty, sheet = NO_SHEET }: ApplicationsScreenProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(params.q);
  // Back and forward change the URL's search; the box follows.
  const [urlQuery, setUrlQuery] = useState(params.q);
  if (params.q !== urlQuery) {
    setUrlQuery(params.q);
    if (params.q !== query.trim()) setQuery(params.q);
  }
  const typing = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The table's page, back to the first when what's in view changes.
  const [page, setPage] = useState(0);
  const [pagedFor, setPagedFor] = useState(rows);
  if (pagedFor !== rows) {
    setPagedFor(rows);
    setPage(0);
  }

  // A moved card shows in its new column at once; if the move fails, it goes back (LST-4).
  const [shown, showMove] = useOptimistic(rows, (current, { id, to }: { id: string; to: ApplicationStatus }) =>
    current.map((row) => (row.id === id ? { ...row, status: to, updated: "Today", updatedAt: Date.now() } : row)),
  );
  const [, startMove] = useTransition();
  const move = (row: ApplicationRow, to: ApplicationStatus) =>
    startMove(async () => {
      showMove({ id: row.id, to });
      await changeStatus(row.id, to);
    });

  // Each view, filter or sort gets its own history entry, so Back returns to
  // it, and is remembered for the next visit (LST-7) before the page asks
  // for it. Typing a search only updates the current entry.
  const go = (next: Partial<ListParams>, { replace = false } = {}) => {
    clearTimeout(typing.current);
    const state = { ...params, q: query.trim(), ...next };
    const href = listHref(state);
    const remember = "view" in next || "filter" in next || "sort" in next;
    startTransition(async () => {
      if (remember) await rememberListView({ view: state.view, filter: state.filter, sort: state.sort });
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });
  };

  const search = (value: string) => {
    setQuery(value);
    clearTimeout(typing.current);
    typing.current = setTimeout(() => go({ q: value.trim() }, { replace: true }), SEARCH_DELAY_MS);
  };

  // On the board the screen keeps to the window and each column scrolls on
  // its own; the table scrolls with the page.
  const board = !empty && rows.length > 0 && params.view === "board";

  return (
    <div className={cn("flex flex-col", board ? "h-panel min-h-[520px]" : "flex-1")}>
      <PageHeader
        title="Job application log"
        description={summary}
        actions={
          <>
            <SegmentedControl<View>
              aria-label="View"
              size="sm"
              options={[
                { value: "board", label: "Board" },
                { value: "table", label: "Table" },
              ]}
              value={params.view}
              onValueChange={(view) => go({ view })}
            />
            <Link href="/applications/history" className={buttonClassName("secondary")}>
              Activity log
            </Link>
          </>
        }
      />

      {/* Where the other archive is, and what Activity log is. */}
      <p className="px-10 pb-3 text-meta text-muted">
        <span className="font-medium text-ink">Activity log</span>: what happened, day by day. Applications you set aside, and job postings the agent skipped, are in the{" "}
        <Link href="/archive">Archive</Link>.
      </p>
      {empty ? (
        <FirstApplication />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 px-10 pb-[18px]">
            <input
              type="search"
              aria-label="Search applications"
              placeholder="Search company or role"
              value={query}
              onChange={(event) => search(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && go({ q: query.trim() }, { replace: true })}
              className="min-w-[180px] flex-[0_1_300px] rounded-control border border-line-input bg-input px-3 py-2.5 text-sm placeholder:text-muted focus-visible:border-primary focus-visible:outline-offset-0"
            />
            <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
              {FILTERS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={params.filter === value}
                  onClick={() => go({ filter: value })}
                  className={cn(
                    "flex items-baseline gap-1.5 rounded-control border px-3 py-2 text-control",
                    params.filter === value ? "border-primary bg-selected font-medium text-primary-text" : "border-line-field bg-card hover:border-line-strong hover:bg-hover",
                  )}
                >
                  {label}{" "}
                  <span className="text-xs opacity-65">{counts[value]}</span>
                </button>
              ))}
            </div>
            <span className="ml-auto text-meta text-muted">{HINTS[params.view]}</span>
          </div>

          <div className={cn("flex min-h-0 flex-1 flex-col motion-safe:transition-opacity", pending && "opacity-60")} aria-busy={pending || undefined}>
            {rows.length === 0 ? (
              <Nothing>{params.q ? `No applications match “${params.q}”.` : "Nothing in this view yet."}</Nothing>
            ) : board ? (
              <Board rows={shown} statuses={statusesIn(params.filter)} onMove={move} />
            ) : (
              <>
                <Table rows={shown.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)} sort={params.sort} onSort={(sort) => go({ sort })} onMove={move} />
                <Pager page={page} total={shown.length} onPage={setPage} />
              </>
            )}
          </div>
        </>
      )}

      {/* Down here on purpose, away from the view switch, so it isn't clicked by accident. */}
      <div className="mx-10 mt-auto mb-10 flex flex-none flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-control font-medium">
            Google Sheet
          </h2>
          <p className="text-meta text-muted">A copy of this log in your Google Drive folder, replaced on each sync and every weekday at 7 PM.</p>
        </div>
        <SheetSync sheet={sheet} />
      </div>
    </div>
  );
}

/** The table's pages: Previous and Next, and which applications are in view. */
function Pager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return <div className="mb-6" />;
  const first = page * PAGE_SIZE + 1;
  const last = Math.min(total, (page + 1) * PAGE_SIZE);
  return (
    <nav aria-label="Pages" className="mx-10 mb-6 flex items-center justify-end gap-3 text-control text-muted">
      <span>
        {first}–{last} of {total}
      </span>
      <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)} className={buttonClassName("secondary", "sm")}>
        Previous
      </button>
      <span>
        Page {page + 1} of {pages}
      </span>
      <button type="button" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} className={buttonClassName("secondary", "sm")}>
        Next
      </button>
    </nav>
  );
}

/** When the search or filter leaves nothing to show. */
function Nothing({ children }: { children: ReactNode }) {
  return (
    <div className="mx-10 mb-16 rounded-panel border border-line-card bg-card px-5 py-9 text-center text-sm text-muted">{children}</div>
  );
}

/** Before the first application: where to start. */
function FirstApplication() {
  return (
    <div className="mx-10 mb-16 flex max-w-[640px] flex-col items-start gap-3 rounded-panel border border-line-card bg-card px-7 py-7">
      <h2 className="font-serif text-section">Your first application</h2>
      <p className="text-sm text-muted">
        Paste a job posting and I&apos;ll read it, check it against your profile and draft a tailored resume and cover letter. Your
        profile is what everything is built from, so it&apos;s worth filling in first.
      </p>
      <div className="flex flex-wrap items-center gap-4 pt-1">
        <Link href="/jobs" className={buttonClassName("primary", "md", "hover:text-on-primary")}>
          Go to Manual job search
        </Link>
        <Link href="/profile" className="text-sm text-muted underline underline-offset-2 hover:text-ink">
          Fill in your profile
        </Link>
      </div>
    </div>
  );
}
