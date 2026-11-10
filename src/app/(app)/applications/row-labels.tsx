import { ExternalLink } from "lucide-react";

import { EmployerType } from "@/generated/prisma/enums";
import type { ApplicationRow } from "@/lib/applications-data";
import { EMPLOYER_LABELS } from "@/lib/employer-type";

/**
 * The original job listing, in a new tab, from beside the role on the table
 * and the board; nothing without a link. It can stop working once the
 * listing is taken down.
 */
export function PostingLink({ row, className }: { row: Pick<ApplicationRow, "postingUrl" | "role" | "company">; className?: string }) {
  if (!row.postingUrl) return null;
  return (
    <a
      href={row.postingUrl}
      target="_blank"
      rel="noopener noreferrer"
      title="Open the original job listing"
      onClick={(event) => event.stopPropagation()}
      className={`mt-0.5 flex-none rounded-control text-muted hover:text-primary ${className ?? ""}`}
    >
      <ExternalLink className="size-3.5" aria-hidden="true" />
      <span className="sr-only">Open the original job listing for {[row.role, row.company].filter(Boolean).join(" at ")} (new tab)</span>
    </a>
  );
}

const capsule = "rounded-full px-2 py-[2px] text-xs font-medium whitespace-nowrap";
const EMPLOYER_STYLES: Partial<Record<EmployerType, string>> = {
  [EmployerType.GOVERNMENT]: "bg-status-sent/15 text-ink",
  [EmployerType.STARTUP]: "bg-warning-surface text-warning",
};

/**
 * What a row and a card show at a glance: Manual when you started it yourself, who the employer is (Government
 * or Startup; nothing for a private company), when the job opened, in green
 * (when it was posted or, when that isn't known, when the application was
 * created), and when it closes, in red.
 */
export function RowLabels({ row }: { row: Pick<ApplicationRow, "posted" | "created" | "deadline" | "employer"> & Partial<Pick<ApplicationRow, "manual">> }) {
  const { type, auto } = row.employer;
  return (
    <span className="flex flex-wrap gap-1.5">
      {row.manual && (
        <span className={`${capsule} bg-selected text-primary-text`} title="You started this one yourself, not the job agent">
          Manual
        </span>
      )}
      {type && (
        <span className={`${capsule} ${EMPLOYER_STYLES[type]}`} title={auto ? "Scout's guess: change it in the ⋯ menu" : undefined}>
          {EMPLOYER_LABELS[type]}
        </span>
      )}
      <span className={`${capsule} bg-success-surface text-success`}>{row.posted ? `Posted ${row.posted}` : `Created ${row.created}`}</span>
      {/* On a line of its own, so the labels don't widen the column. */}
      {row.deadline && (
        <span className="basis-full">
          <span className={`${capsule} bg-danger-surface text-danger`}>Apply by {row.deadline}</span>
        </span>
      )}
    </span>
  );
}
