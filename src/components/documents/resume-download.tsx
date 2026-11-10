"use client";

import type { ApplicationRow } from "@/lib/applications-data";

import { DownloadPdfButton } from "./download-pdf-button";

/**
 * Resume & Cover Letter from the applications list, without opening the
 * application: one file, the cover letter first, as it went out (PDF or
 * Word), or the tailored documents before it's sent. A dash without a resume.
 */
export function ResumeDownload({ row, compact = false }: { row: Pick<ApplicationRow, "role" | "company" | "resume">; compact?: boolean }) {
  const what = [row.role, row.company].filter(Boolean).join(" at ");
  if (!row.resume) {
    return compact ? null : (
      <span className="text-sm text-muted" title="No tailored resume yet">
        –
      </span>
    );
  }
  const { href, sent } = row.resume;
  return (
    <DownloadPdfButton
      variant="secondary"
      size="sm"
      href={href}
      busyLabel="…"
      progress={sent ? "Getting the resume and cover letter you applied with…" : "Getting your tailored resume and cover letter…"}
      className={compact ? "min-h-6 px-2 py-0 text-xs" : undefined}
    >
      Download{" "}
      <span className="sr-only">
        {sent ? "the resume and cover letter you applied with, for " : "the tailored resume and cover letter for "}
        {what}
      </span>
    </DownloadPdfButton>
  );
}
