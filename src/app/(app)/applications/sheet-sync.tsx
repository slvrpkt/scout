"use client";

import Link from "next/link";
import { useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";

import { syncApplicationsSheet } from "./actions";

/** The log's Google Sheet as the page shows it. */
export type SheetState = { ready: boolean; url: string | null; syncedAt: string | null; problem: string | null };

/**
 * Sync To Google Sheets, on the Job application log: replaces the sheet in
 * the Drive folder with the table as it is now. It also syncs on its own
 * as soon as you apply or a status changes. Before Google Drive is allowed, it leads to Settings.
 */
export function SheetSync({ sheet }: { sheet: SheetState }) {
  const [pending, startTransition] = useTransition();
  if (!sheet.ready) {
    return (
      <Link
        href="/settings?section=google"
        title="Connect Google and allow Google Drive in Settings → Google to sync the log to a Google Sheet."
        className={buttonClassName("secondary")}
      >
        Sync To Google Sheets
      </Link>
    );
  }
  const status = sheet.problem ?? (sheet.syncedAt ? `Last synced ${sheet.syncedAt}. Updates on its own when you apply or a status changes.` : "Not synced yet. Updates on its own when you apply or a status changes.");
  return (
    <span className="flex items-center gap-2">
      <Button
        variant="secondary"
        disabled={pending}
        title={status}
        onClick={() => startTransition(async () => void toastResult(await syncApplicationsSheet({})))}
      >
        {pending ? "Syncing…" : "Sync To Google Sheets"}
      </Button>
      {sheet.url && (
        <a href={sheet.url} target="_blank" rel="noreferrer" title={status} className="text-control text-muted underline underline-offset-3 hover:text-ink">
          Open Sheet
        </a>
      )}
      {sheet.problem && (
        <span role="alert" className="max-w-56 text-meta text-error">
          {sheet.problem}
        </span>
      )}
    </span>
  );
}
