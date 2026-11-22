"use client";

import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { useState, type ReactNode } from "react";

import { lookOnCompanySite } from "@/app/(app)/agent/actions";
import { noteLetterUsed } from "@/app/(app)/applications/[id]/actions";

import { changeStatus } from "@/components/change-status";
import { downloadHeld } from "@/components/documents/download-pdf-button";
import { toast } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { ApplicationStatus } from "@/generated/prisma/enums";
import { useJob } from "@/hooks/use-job";
import type { ApplyPage } from "@/lib/apply-steps";

/**
 * Quick Apply, while the application is a draft: download
 * the resume, copy the cover letter, open the page to apply on, fill in the
 * form there, then mark it applied. Nothing is
 * sent from here; you submit on the employer's site.
 */
export function ApplySteps({
  id,
  page,
  letter,
  lookFor = null,
  notFound = false,
  company = "",
  letterUnwritten = false,
}: {
  id: string;
  page: ApplyPage | null;
  /** The letter as text; null when there's none to send. */
  letter: string | null;
  /** A job agent find not looked for on the company's site yet: opening the steps looks for it, for the employer's own page. */
  lookFor?: string | null;
  /** Looked for on the company's site before, and not found. */
  notFound?: boolean;
  company?: string;
  /** The letter isn't written (yet): it's written on the Cover letter tab, when wanted. */
  letterUnwritten?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // The resume and letter download as soon as the steps open: you're applying, so you'll want them.
  const [downloads, setDownloads] = useState<Record<"resume" | "letter", Download>>({ resume: "idle", letter: "idle" });
  const download = (doc: "resume" | "letter") => {
    setDownloads((current) => ({ ...current, [doc]: "working" }));
    void downloadHeld(`/api/pdf?doc=${doc}&application=${id}`, null).then((ok) => setDownloads((current) => ({ ...current, [doc]: ok ? "done" : "failed" })));
  };
  const downloadAll = () => {
    if (downloads.resume === "idle") download("resume");
    if (letter && downloads.letter === "idle") download("letter");
  };
  const [lookJob, setLookJob] = useState<string | null>(null);
  const [looked, setLooked] = useState<"found" | "not found" | null>(null);
  useJob<{ found: boolean }>(lookJob, 0, (update) => {
    if (update.status !== "DONE" && update.status !== "FAILED") return;
    setLookJob(null);
    setLooked(update.result?.found ? "found" : "not found");
    // The employer's page, once found, comes first among the places to apply.
    if (update.result?.found) router.refresh();
  });
  const looking = Boolean(lookJob);

  // Opened on a draft never looked for on the company's site: look now, while the steps are read.
  const startLook = async () => {
    if (!lookFor || looked || lookJob) return;
    const result = await lookOnCompanySite({ candidateId: lookFor });
    if (result.ok) setLookJob(result.data.jobId);
    else setLooked("not found");
  };

  const copy = async () => {
    if (!letter) return;
    try {
      await navigator.clipboard.writeText(letter);
      setCopied(true);
      // Copied to paste into the form: the letter goes with this application.
      void noteLetterUsed({ id });
      toast("Cover letter copied. Paste it into the form's cover letter box.");
    } catch {
      toast("Couldn't copy the cover letter. Open its tab and copy it from there.");
    }
  };

  const applied = async () => {
    if (await changeStatus(id, ApplicationStatus.SENT)) setOpen(false);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          void startLook();
          downloadAll();
        }
        else setCopied(false);
      }}
    >
      <Dialog.Trigger title="Download your files, copy the cover letter and open the page to apply on" className={buttonClassName("secondary", "md")}>Quick Apply</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-dialog border border-line-popover bg-card p-6 shadow-menu">
          <Dialog.Title className="font-serif text-[22px] leading-tight">Quick Apply</Dialog.Title>
          <Dialog.Description className="text-sm text-muted">
            Your resume{letter ? " and cover letter are" : " is"} downloading now. You fill in the employer&apos;s form and submit it there.
          </Dialog.Description>

          <ol className="flex flex-col gap-3.5 text-sm">
            <Step n={1} title="Your resume and cover letter">
              <span className="flex flex-col gap-1.5">
                <DownloadStatus label="Resume (PDF)" state={downloads.resume} onRetry={() => download("resume")} />
                {letter ? (
                  <DownloadStatus label="Cover letter (PDF)" state={downloads.letter} onRetry={() => download("letter")} />
                ) : (
                  <span className="flex flex-wrap items-center gap-2">
                    <Button title="There's no cover letter for this application" variant="secondary" size="sm" disabled>
                      Cover letter (PDF)
                    </Button>
                    <span className="text-meta text-muted">No cover letter generated.</span>
                  </span>
                )}
              </span>
            </Step>
            <Step n={2} title="Copy your cover letter">
              {letter ? (
                <span className="flex flex-wrap gap-2">
                  <Button title="Copy the cover letter, to paste into the application form" variant="secondary" size="sm" onClick={() => void copy()}>
                    {copied ? "Copied ✓" : "Copy cover letter"}
                  </Button>
                </span>
              ) : (
                <span className="text-meta text-muted">
                  {letterUnwritten ? "No cover letter written yet. Want one? Write it on the Cover letter tab (1 to 2 minutes); otherwise only the resume goes." : "No cover letter for this one: only the resume goes."}
                </span>
              )}
            </Step>
            <Step n={3} title="Open the page to apply on">
              {looking ? (
                <span role="status" className="flex items-center gap-2 text-meta text-muted">
                  <span aria-hidden="true" className="size-3.5 flex-none animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Looking for this job on {company || "the company"}&apos;s own site…
                </span>
              ) : page ? (
                <span className="flex flex-col gap-1.5">
                  <a title="Open the page to apply on, in a new tab" href={page.url} target="_blank" rel="noreferrer" className={buttonClassName("primary", "lg", "self-start")}>
                    {page.direct ? "Click here to apply" : "Click here to go to the job posting"} ↗<span className="sr-only"> (opens {page.label} in a new tab)</span>
                  </a>
                  <span className="text-meta text-muted">On {page.label}.</span>
                  {page.direct && looked === "found" && <span className="text-meta text-success">✓ Found on {company || "the company"}&apos;s own site.</span>}
                  {!page.direct && (
                    <span role="note" className="text-meta text-warning">
                      {looked === "not found" || notFound ? `Couldn't find it on ${company || "the company"}'s own site. ` : ""}
                      This is where the job was listed, not the employer&apos;s own page: look for its Apply button, which usually leads to the employer&apos;s form.
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-meta text-muted">No link to apply on: search for the job on the company&apos;s careers page.</span>
              )}
            </Step>
            <Step n={4} title="Fill in the form">
              <span className="text-meta text-muted">
                Attach the resume you downloaded{letter ? " and paste the cover letter" : ""}, check every field, then submit.
              </span>
            </Step>
            <Step n={5} title="Mark it applied">
              <Button title="Mark this application as applied, once you've submitted it" size="sm" onClick={() => void applied()}>
                I applied
              </Button>
            </Step>
          </ol>

          <div className="flex justify-end">
            <Dialog.Close title="Close this window" className={buttonClassName("secondary", "sm")}>Close</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type Download = "idle" | "working" | "done" | "failed";

/** One file's download: under way, done (with Download again), or failed (with Try again). */
function DownloadStatus({ label, state, onRetry }: { label: string; state: Download; onRetry: () => void }) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      {state === "working" || state === "idle" ? (
        <span role="status" className="flex items-center gap-2 text-muted">
          <span aria-hidden="true" className="size-3.5 flex-none animate-spin rounded-full border-2 border-current border-t-transparent" />
          Downloading {label}…
        </span>
      ) : state === "done" ? (
        <>
          <span role="status" className="font-medium text-success">
            ✓ {label} downloaded
          </span>
          <Button title="Download this file again" variant="text" size="sm" onClick={onRetry}>
            Download again
          </Button>
        </>
      ) : (
        <>
          <span role="status" className="text-warning">
            {label} didn&apos;t download.
          </span>
          <Button title="Try the download again" variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </>
      )}
    </span>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="flex size-6 flex-none items-center justify-center rounded-full bg-selected text-meta font-medium text-primary-text">
        {n}
      </span>
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="font-medium">{title}</span>
        {children}
      </span>
    </li>
  );
}
