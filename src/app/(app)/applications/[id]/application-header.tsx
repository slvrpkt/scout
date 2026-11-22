"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { PageBar } from "@/components/page-header";
import { useBelongsTo } from "@/lib/section-override";

/** Where an application belongs: the Job application log once applied to, the search it came from before. */
export type ApplicationSection = { href: string; label: string };
export const LOG_SECTION: ApplicationSection = { href: "/applications", label: "Job application log" };

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
  section = LOG_SECTION,
  children,
}: {
  title: string;
  /** Location, work mode, salary, deadline, created: whichever are known. */
  meta: string[];
  actions: ReactNode;
  /** Previous and Next through the Job application log, under the actions. */
  pager?: ReactNode;
  /** The breadcrumb and the sidebar's section. */
  section?: ApplicationSection;
  /** The tab list, drawn on the header's bottom line. */
  children?: ReactNode;
}) {
  const name = title.trim() || "Untitled application";
  // The sidebar marks the section it belongs to, not the address's.
  useBelongsTo(section.href === LOG_SECTION.href ? null : section.href);
  return (
    <>
      {/* Kept short, so the resume has the room: the details under the title, beside the actions, and the tabs right after. */}
      <PageBar className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 rounded-t-panel border border-b-0 border-line-card bg-surface px-10 pt-4 pb-1">
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-1">
          <nav aria-label="Breadcrumb">
            <ol className="flex gap-1.5 text-meta text-muted">
              <li>
                <Link title={`Back to ${section.label}, where you left off`} href={section.href} className="text-muted hover:text-ink">
                  <span aria-hidden="true">← </span>
                  {section.label}
                </Link>
              </li>
              <li aria-hidden="true">/</li>
            </ol>
          </nav>
          <h1 className="font-serif text-[28px] leading-[1.15] tracking-[-0.015em] text-pretty">{name}</h1>
          {meta.length > 0 && (
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] text-muted">
              {meta.map((part) => (
                <span key={part}>{part}</span>
              ))}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 pt-1">
          <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
          {pager}
        </div>
      </PageBar>
      <div className="flex flex-col border-b border-line px-10 pt-2">{children}</div>
    </>
  );
}
