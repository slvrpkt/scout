"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { toast, toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ARCHIVE_REASONS } from "@/lib/agent/archive-reasons";
import type { ArchiveRow } from "@/lib/archive-data";
import { DEFAULT_ARCHIVE_SORT, filterArchive, NO_ARCHIVE_FILTERS, sortArchive, type ArchiveFilters, type ArchiveSort, type ArchiveSortKey } from "@/lib/archive-view";
import { setArchived } from "@/lib/application-actions";
import { cn } from "@/lib/cn";

import { restoreAgentCandidate } from "../agent/actions";

/** Rows on a page of the table. */
export const ARCHIVE_PAGE = 50;

const WHY = Object.fromEntries(ARCHIVE_REASONS.map((reason) => [reason.id, reason.label])) as Record<ArchiveRow["why"], string>;

const COLUMNS: { key: ArchiveSortKey; label: string; numeric?: boolean }[] = [
  { key: "archivedAt", label: "Archived" },
  { key: "title", label: "Title" },
  { key: "company", label: "Company" },
  { key: "location", label: "Location" },
  { key: "pay", label: "Salary", numeric: true },
  { key: "score", label: "Score", numeric: true },
  { key: "why", label: "Why" },
  { key: "kind", label: "Type" },
  { key: "foundBy", label: "Found by" },
];

const control = "rounded-control border border-line-input bg-input px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:border-primary";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const money = (pay: number) => `$${Math.round(pay / 1000)}k`;
const numberOf = (text: string) => {
  const digits = text.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
};

/**
 * The Archive: everything set aside, postings and applications, in one table
 * to sort by any column and filter, 50 rows a page. Put back returns a row
 * where it came from, with a link there, and it carries a "Was archived" label.
 */
export function ArchiveScreen({ rows: initial }: { rows: ArchiveRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [filters, setFilters] = useState<ArchiveFilters>(NO_ARCHIVE_FILTERS);
  const [sort, setSort] = useState<ArchiveSort>(DEFAULT_ARCHIVE_SORT);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  const set = (patch: Partial<ArchiveFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(0);
  };
  const shown = sortArchive(filterArchive(rows, filters, now), sort);
  const pages = Math.max(1, Math.ceil(shown.length / ARCHIVE_PAGE));
  const onPage = shown.slice(page * ARCHIVE_PAGE, (page + 1) * ARCHIVE_PAGE);
  const finders = [...new Set(rows.map((row) => row.foundBy).filter((name): name is string => Boolean(name)))].sort();
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_ARCHIVE_FILTERS);

  const sortBy = (key: ArchiveSortKey) => {
    setSort((current) => (current.key === key ? { key, reversed: !current.reversed } : { key, reversed: false }));
    setPage(0);
  };

  const putBack = async (row: ArchiveRow) => {
    if (busy) return;
    setBusy(row.id);
    const result = row.kind === "posting" ? await restoreAgentCandidate({ id: row.id }) : await setArchived({ id: row.id, archived: false });
    setBusy(null);
    if (!toastResult(result).ok) return;
    setRows((current) => current.filter((entry) => !(entry.id === row.id && entry.kind === row.kind)));
    const where = row.kind === "posting" ? { text: "Put back in Agentic job search.", href: `/agent?select=${row.id}` } : { text: "Put back in your Job application log.", href: `/applications/${row.id}` };
    toast(where.text, { action: { label: "Open", onClick: () => router.push(where.href) } });
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Archive"
        description="Jobs set aside so they stay out of your way. Most are postings the agentic job search filtered out because they didn't meet the criteria you set: job titles to skip, words that rule a job out, distance, your minimum score or a search's own skip rules. The rest are jobs and applications you archived yourself, for example after looking one up and deciding not to apply. Put back returns any of them to where it came from."
      />
      <div className="flex flex-col gap-4 px-10 pb-16">
        <Card padding="none" className="flex flex-wrap items-end gap-4 px-6 py-4">
          <Field label="When archived">
            <select aria-label="When archived" value={filters.when} onChange={(event) => set({ when: event.target.value as ArchiveFilters["when"] })} className={control}>
              <option value="all">Any time</option>
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
              <option value="range">Between dates…</option>
            </select>
          </Field>
          {filters.when === "range" && (
            <>
              <Field label="From">
                <input type="date" aria-label="From" value={filters.from} onChange={(event) => set({ from: event.target.value })} className={control} />
              </Field>
              <Field label="To">
                <input type="date" aria-label="To" value={filters.to} onChange={(event) => set({ to: event.target.value })} className={control} />
              </Field>
            </>
          )}
          <Field label="Why">
            <select aria-label="Why" value={filters.why} onChange={(event) => set({ why: event.target.value as ArchiveFilters["why"] })} className={control}>
              <option value="all">Any reason</option>
              {ARCHIVE_REASONS.map((reason) => (
                <option key={reason.id} value={reason.id}>
                  {reason.label} ({rows.filter((row) => row.why === reason.id).length})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select aria-label="Type" value={filters.kind} onChange={(event) => set({ kind: event.target.value as ArchiveFilters["kind"] })} className={control}>
              <option value="all">Postings and applications</option>
              <option value="posting">Postings</option>
              <option value="application">Applications</option>
            </select>
          </Field>
          <Field label="Title" grow>
            <input type="search" aria-label="Title" placeholder="Title, or the word that archived it" value={filters.title} onChange={(event) => set({ title: event.target.value })} className={control} />
          </Field>
          <Field label="Company" grow>
            <input type="search" aria-label="Company" value={filters.company} onChange={(event) => set({ company: event.target.value })} className={control} />
          </Field>
          <Field label="Location" grow>
            <input type="search" aria-label="Location" placeholder="City, state or Remote" value={filters.location} onChange={(event) => set({ location: event.target.value })} className={control} />
          </Field>
          <Field label="Salary at least">
            <input inputMode="numeric" aria-label="Salary at least" placeholder="$110,000" value={filters.minPay?.toLocaleString("en-US") ?? ""} onChange={(event) => set({ minPay: numberOf(event.target.value) })} className={cn(control, "w-32")} />
          </Field>
          <Field label="Score at least">
            <input inputMode="numeric" aria-label="Score at least" placeholder="60" value={filters.minScore ?? ""} onChange={(event) => set({ minScore: numberOf(event.target.value) })} className={cn(control, "w-24")} />
          </Field>
          {finders.length > 0 && (
            <Field label="Found by">
              <select aria-label="Found by" value={filters.foundBy} onChange={(event) => set({ foundBy: event.target.value })} className={control}>
                <option value="all">Any search</option>
                {finders.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {filtered && (
            <Button variant="text" size="sm" onClick={() => set(NO_ARCHIVE_FILTERS)}>
              Clear filters
            </Button>
          )}
          <p className="basis-full text-meta text-muted">
            {shown.length === rows.length ? `${rows.length} archived.` : `${shown.length} of ${rows.length} match.`} Click a column&apos;s name to sort by it; click again to reverse.
          </p>
        </Card>

        {shown.length === 0 ? (
          <p className="rounded-panel border border-line-card bg-card px-5 py-9 text-center text-sm text-muted">{rows.length === 0 ? "Nothing archived yet." : "Nothing matches these filters."}</p>
        ) : (
          <div className="overflow-x-auto rounded-panel border border-line-card bg-card">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="text-meta text-muted">
                <tr>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={sort.key === column.key ? ((column.key === "archivedAt" || column.numeric) !== sort.reversed ? "descending" : "ascending") : undefined}
                      className={cn("px-3 py-2.5 font-medium", column.numeric && "text-right")}
                    >
                      <button type="button" onClick={() => sortBy(column.key)} className="inline-flex items-center gap-1 hover:text-ink">
                        {column.label}
                        {sort.key === column.key && <span aria-hidden="true">{(column.key === "archivedAt" || column.numeric) !== sort.reversed ? "↓" : "↑"}</span>}
                      </button>
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2.5">
                    <span className="sr-only">Put back</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {onPage.map((row) => (
                  <tr key={`${row.kind}:${row.id}`} className="border-t border-line align-top">
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted">{day(row.archivedAt)}</td>
                    <td className="px-3 py-2.5">
                      {row.href ? (
                        <a href={row.href} {...(row.kind === "posting" ? { target: "_blank", rel: "noreferrer" } : {})} className="font-medium text-ink hover:underline">
                          {row.title}
                        </a>
                      ) : (
                        <span className="font-medium">{row.title}</span>
                      )}
                      {row.note && <span className="block text-meta text-muted">{row.note}</span>}
                    </td>
                    <td className="px-3 py-2.5">{row.company || "—"}</td>
                    <td className="px-3 py-2.5">{row.location || "—"}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums" title={row.salary || undefined}>
                      {row.pay !== null ? money(row.pay) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.score ?? <span className="text-muted">not scored</span>}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{WHY[row.why]}</td>
                    <td className="px-3 py-2.5">{row.kind === "posting" ? "Posting" : "Application"}</td>
                    <td className="px-3 py-2.5">{row.foundBy ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button type="button" aria-disabled={busy !== null || undefined} onClick={() => putBack(row)} className={buttonClassName("secondary", "sm")} aria-label={`Put back ${row.title}`}>
                        {busy === row.id ? "Putting back…" : "Put back"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <nav aria-label="Pages" className="flex items-center justify-end gap-3 text-control text-muted">
            <span>
              {page * ARCHIVE_PAGE + 1}–{Math.min(shown.length, (page + 1) * ARCHIVE_PAGE)} of {shown.length}
            </span>
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className={buttonClassName("secondary", "sm")}>
              Previous
            </button>
            <span>
              Page {page + 1} of {pages}
            </span>
            <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className={buttonClassName("secondary", "sm")}>
              Next
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}

function Field({ label, grow, children }: { label: string; grow?: boolean; children: ReactNode }) {
  return <div className={cn("flex flex-col gap-1.5 text-label text-muted", grow ? "min-w-[160px] flex-[1_1_180px]" : "min-w-[120px]")}>{label}{children}</div>;
}
