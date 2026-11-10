"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { DownloadPdfButton } from "@/components/documents/download-pdf-button";
import { ResumeDownload } from "@/components/documents/resume-download";
import { StatusDot } from "@/components/ui/status-dot";
import type { ApplicationStatus } from "@/generated/prisma/enums";
import type { ApplicationRow } from "@/lib/applications-data";
import { NATURAL_ORDER, type Sort, type SortKey } from "@/lib/applications-list";
import { cn } from "@/lib/cn";
import { STATUSES } from "@/lib/status";

import { ActivityCell } from "./add-event-dialog";
import { AppliedViaSelect } from "./applied-via-select";
import { PostingLink, RowLabels } from "./row-labels";
import { RowMenu } from "./row-menu";
import { ThingsToNoteCell } from "./things-to-note";

/** The table's columns in order; the ones with a `sort` key sort when their header is clicked. */
const COLUMNS: { id: string; label: string; sort?: SortKey; className: string }[] = [
  { id: "company", label: "Company", sort: "company", className: "w-[11%]" },
  { id: "role", label: "Role", sort: "role", className: "w-[13%]" },
  { id: "salary", label: "Salary", className: "w-[104px]" },
  { id: "location", label: "Location", sort: "location", className: "w-[8%]" },
  { id: "notes", label: "Things To Note", className: "w-[14%]" },
  { id: "via", label: "Applied Using", className: "w-[120px]" },
  { id: "status", label: "Status", sort: "status", className: "w-[116px]" },
  { id: "match", label: "Match", sort: "match", className: "w-[64px]" },
  { id: "sent", label: "Applied", sort: "sent", className: "w-[84px]" },
  { id: "resume", label: "Resume & Cover Letter", className: "w-[104px]" },
  { id: "posting", label: "Job Description", className: "w-[104px]" },
  { id: "activity", label: "Activity", className: "w-[18%]" },
  { id: "updated", label: "Updated", sort: "updated", className: "w-[96px]" },
];

/** A column's direction as `aria-sort` names it. */
function direction({ key, reversed }: Sort): "ascending" | "descending" {
  const natural = NATURAL_ORDER[key];
  return reversed ? (natural === "ascending" ? "descending" : "ascending") : natural;
}

const cell = "py-3.5 pr-4 align-top break-words";

/**
 * The table (LST-5, LST-6): a navy header row, sortable columns, a status
 * select on each row, and a click anywhere on a row to open it. Every cell
 * wraps and long text is cut to a few lines with More, so nothing stretches
 * the table. The role is a link, so rows are reachable by keyboard.
 */
export function Table({
  rows,
  sort,
  onSort,
  onMove,
}: {
  /** Already sorted by the server. */
  rows: ApplicationRow[];
  sort: Sort;
  onSort: (sort: Sort) => void;
  onMove: (row: ApplicationRow, to: ApplicationStatus) => void;
}) {
  const router = useRouter();
  return (
    // Relative, so screen-reader-only text is clipped with the table.
    <div className="relative mx-10 mb-4 overflow-x-auto rounded-panel border border-line-card bg-card">
      <table className="w-full min-w-[1580px] table-fixed border-collapse text-left">
        <thead>
          <tr className="bg-[#162032] text-white">
            {COLUMNS.map((column) => {
              const active = column.sort !== undefined && sort.key === column.sort;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={active ? direction(sort) : undefined}
                  className={cn("py-3.5 pr-4 align-bottom text-[15px] leading-tight font-semibold first:pl-5", column.className)}
                >
                  {column.sort ? (
                    <button
                      type="button"
                      onClick={() => onSort({ key: column.sort!, reversed: active ? !sort.reversed : false })}
                      className={cn("text-left text-white hover:underline", active && "underline underline-offset-4")}
                    >
                      {column.label}
                      {active && <span aria-hidden="true">{direction(sort) === "descending" ? " ↓" : " ↑"}</span>}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
            <th scope="col" className="w-12 pr-3">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const what = [row.role, row.company].filter(Boolean).join(" at ");
            return (
              <tr
                key={row.id}
                onClick={(event) => {
                  // The selects, the menu, the links and the pop-ups handle their own clicks.
                  if (!(event.target instanceof Element) || event.target.closest("a, button, select, textarea, [role=menu], [role=dialog]")) return;
                  router.push(`/applications/${row.id}`);
                }}
                className="cursor-pointer border-b border-line last:border-b-0 hover:bg-hover"
              >
                <td className={cn(cell, "pl-5")}>
                  <span title={row.company} className="line-clamp-2 text-field font-semibold text-ink">
                    {row.company || "No company"}
                  </span>
                  {row.archived && <span className="mt-1 inline-block rounded-[6px] bg-track px-1.5 text-xs text-muted">Archived</span>}
                  {row.wasArchived && <span className="mt-1 inline-block rounded-[6px] bg-warning-surface px-1.5 text-xs text-warning">Was archived</span>}
                </td>
                <td className={cell}>
                  <span className="flex items-start gap-1.5">
                    <Link href={`/applications/${row.id}`} title={row.role} className="line-clamp-3 min-w-0 text-sm font-bold text-primary italic hover:text-primary">
                      {row.role}
                    </Link>
                    <PostingLink row={row} />
                  </span>
                  <span className="mt-1.5 block">
                    <RowLabels row={row} />
                  </span>
                </td>
                <td className={cn(cell, "text-sm")}>
                  {row.salary ? <span className="line-clamp-3 text-ink">{row.salary}</span> : <span className="text-muted">Not listed</span>}
                </td>
                <td className={cn(cell, "text-sm text-muted")}>
                  <span title={row.location} className="line-clamp-2">
                    {row.location || "Not given"}
                  </span>
                </td>
                <td className={cell}>
                  <ThingsToNoteCell row={row} />
                </td>
                <td className={cell}>
                  <AppliedViaSelect row={row} />
                </td>
                <td className={cell}>
                  <span className="flex items-center gap-2">
                    <StatusDot status={row.status} />
                    <select
                      aria-label={`Status of ${[row.role, row.company].filter(Boolean).join(", ")}`}
                      value={row.status}
                      onChange={(event) => onMove(row, event.target.value as ApplicationStatus)}
                      className="-ml-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-[6px] border border-transparent bg-transparent py-1 pr-2 pl-1.5 text-sm text-ink hover:border-line-field focus-visible:border-primary"
                    >
                      {STATUSES.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  </span>
                </td>
                <td className={cn(cell, "text-sm tabular-nums")}>{row.match ? `${row.match.hit}/${row.match.total}` : "Not matched"}</td>
                <td className={cn(cell, "text-sm text-muted")}>{row.sent ?? "Not applied"}</td>
                <td className={cell}>
                  <ResumeDownload row={row} />
                </td>
                <td className={cell}>
                  {row.hasPosting ? (
                    <DownloadPdfButton
                      variant="secondary"
                      size="sm"
                      href={`/api/application-files?application=${row.id}&file=posting`}
                      busyLabel="…"
                      progress="Building the job description…"
                    >
                      Download <span className="sr-only">the job description for {what}</span>
                    </DownloadPdfButton>
                  ) : (
                    <span className="text-sm text-muted" title="No job description was saved with this application">
                      –
                    </span>
                  )}
                </td>
                <td className={cell}>
                  <ActivityCell row={row} />
                </td>
                <td className={cn(cell, "text-sm text-muted")}>{row.updated}</td>
                <td className="py-3.5 pr-3 text-right align-top">
                  <RowMenu row={row} onMove={(to) => onMove(row, to)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
