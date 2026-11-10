import Link from "next/link";
import type { ReactNode } from "react";

import { PageBar } from "@/components/page-header";

/**
 * The top of an application's page (APP-1): the page bar with the breadcrumb,
 * the title and the actions (status, downloads), then the meta line and the
 * tabs.
 */
export function ApplicationHeader({
  title,
  meta,
  actions,
  pager,
  children,
}: {
  title: string;
  /** Location, work mode, salary, deadline, created: whichever are known. */
  meta: string[];
  actions: ReactNode;
  /** Previous and Next through the Job application log, under the actions. */
  pager?: ReactNode;
  /** The tab list, drawn on the header's bottom line. */
  children?: ReactNode;
}) {
  const name = title.trim() || "Untitled application";
  return (
    <>
      <PageBar>
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-2">
          <nav aria-label="Breadcrumb">
            <ol className="flex gap-1.5 text-meta text-muted">
              <li>
                <Link href="/applications" className="text-muted hover:text-ink">
                  Job application log
                </Link>
              </li>
              <li aria-hidden="true">/</li>
            </ol>
          </nav>
          <h1 className="font-serif text-[34px] leading-[1.15] tracking-[-0.015em] text-pretty">{name}</h1>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      </PageBar>
      <div className="flex flex-col gap-[18px] border-b border-line px-10 pt-5">
        {(meta.length > 0 || pager) && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] text-muted">
              {meta.map((part) => (
                <span key={part}>{part}</span>
              ))}
            </p>
            {pager}
          </div>
        )}
        {children}
      </div>
    </>
  );
}
