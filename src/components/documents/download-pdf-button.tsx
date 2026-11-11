"use client";

import { useCallback, useState, type ReactNode } from "react";

import { toast } from "@/components/toast";
import {
  buttonClassName,
  type ButtonSize,
  type ButtonVariant,
} from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { messages } from "@/lib/messages";
import { downloadFrom, saveFile } from "@/lib/save-file";

import { WaitNotice } from "./wait-notice";

/** The file name a download response asks for, preferring the UTF-8 one (RFC 6266). */
export function fileNameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Fall back to the plain name.
    }
  }
  return /filename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
}

/**
 * Fetches a file the server renders and holds (POST, then its link), saying
 * so while it renders and showing a failure as a toast; for a menu item.
 */
export async function downloadHeld(
  href: string,
  progress: string,
): Promise<void> {
  toast(progress);
  try {
    const response = await fetch(href, { method: "POST" });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      toast(body?.error ?? messages.unexpected);
      return;
    }
    const { url, note } = (await response.json()) as {
      url: string;
      note?: string | null;
    };
    downloadFrom(url);
    if (note) toast(note);
  } catch {
    toast(messages.offline);
  }
}

/**
 * Downloads a PDF from /api/pdf, or a Word file from /api/docx. Rendering takes a moment, so it says so,
 * and a failure shows up as a toast instead of an error page. Without
 * JavaScript it's a plain link to the same file.
 */
export function DownloadPdfButton({
  href,
  held = true,
  variant = "primary",
  size = "md",
  progress = "Rendering your PDF on the server. It'll download in a moment.",
  busyLabel = "Rendering…",
  className,
  onQuestion,
  notice,
  children,
}: {
  href: string;
  /**
   * Whether `href` answers a POST by holding the file on the server and
   * sending the link to download it from, as /api/pdf does. Browsers save
   * that reliably; otherwise the file is fetched and saved from the page.
   */
  held?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** The toast while it renders, e.g. "Rendering your cover letter as a PDF…". */
  progress?: string;
  /** The label while it renders. */
  busyLabel?: string;
  /** Extra classes, e.g. a smaller button on a board card. */
  className?: string;
  /** When the server needs an answer first (e.g. a third page for the base resume): ask it, then say whether to try again. */
  onQuestion?: (question: string) => Promise<boolean>;
  /** For a file that takes a minute or two: a notice at the top of the screen, instead of the toast, saying it's working. */
  notice?: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [noticeShown, setNoticeShown] = useState(false);
  const closeNotice = useCallback(() => setNoticeShown(false), []);

  const download = async () => {
    setBusy(true);
    if (notice) setNoticeShown(true);
    else toast(progress);
    try {
      const response = await fetch(href, held ? { method: "POST" } : undefined);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          question?: string;
        } | null;
        if (body?.question && onQuestion) {
          setBusy(false);
          if (await onQuestion(body.question)) await download();
          return;
        }
        toast(body?.error ?? messages.unexpected);
        return;
      }
      if (held) {
        const { url, note } = (await response.json()) as {
          url: string;
          note?: string | null;
        };
        downloadFrom(url);
        // Said plainly when the file couldn't be brought within its page limit, or its pages couldn't be counted.
        if (note) toast(note);
      } else {
        saveFile(
          await response.blob(),
          fileNameFrom(response.headers.get("content-disposition")) ??
            "document.pdf",
        );
      }
    } catch {
      toast(messages.offline);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {noticeShown && notice && (
        <WaitNotice message={notice} onClose={closeNotice} />
      )}
      <a
        href={href}
        aria-disabled={busy || undefined}
        onClick={(event) => {
          event.preventDefault();
          if (!busy) void download();
        }}
        className={buttonClassName(
          variant,
          size,
          cn(variant === "primary" && "hover:text-on-primary", className),
        )}
      >
        {busy ? busyLabel : children}
      </a>
    </>
  );
}
