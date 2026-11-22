"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { PageHeader } from "@/components/page-header";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Stepper } from "@/components/ui/stepper";
import { Textarea } from "@/components/ui/textarea";
import { useJob } from "@/hooks/use-job";
import { retry } from "@/lib/jobs/actions";
import { READ_POSTING_STEPS, WRITE_DOCUMENTS_STEPS } from "@/lib/jobs/application-steps";

import { openPendingTab, sendPendingTab } from "@/lib/claude-tab";

import { fetchPostingText, handOffToClaude, startPreparingDraft } from "./actions";
import { createDraftStore } from "./draft-store";
import { JobProgress, jobStep } from "./job-progress";

const STEPS = ["Paste the posting", "Prepare the draft"] as const;
/** What preparing the draft reports, in order (prepare-draft.ts). */
const PREPARE_STEPS = [...READ_POSTING_STEPS, ...WRITE_DOCUMENTS_STEPS];

/** Where the flow is: the posting being pasted, or its draft being prepared. */
export type Draft = {
  step: "paste" | "preparing";
  posting: string;
  postingUrl: string;
  /** The job preparing the draft, once started. */
  jobId: string | null;
  /** The posting it's kept as in Manual job search: from Start application there, or kept when the draft was started. */
  postingId?: string | null;
  /** The startup it was started from with "Write to them" (#222). */
  startupId?: string | null;
};

/** A posting handed over by "Start application" on Manual job search (E14-8), or by "Write to them" on Startups (#222). */
export type FromPosting = {
  /** The Manual job search posting; null for a startup. */
  id: string | null;
  /** The startup and its name, from Startups. */
  startup?: { id: string; company: string };
  text: string;
  url: string;
  /** False when only the start of the posting came through. */
  complete: boolean;
};

// One draft per tab, in sessionStorage (E7-7); none while rendering on the server.
const draftStore = typeof window === "undefined" ? null : createDraftStore<Draft>();
const noStore = () => () => {};

export type NewApplicationProps = {
  /** Whether an AI provider is set up; without one, the page points to Settings. */
  aiReady: boolean;
  /** The AI runs on this computer (a local model), which may be slower. */
  localModel?: boolean;
  /** The Claude connector is on and Scout has no usable AI model: a Claude chat writes it instead (#221). */
  writeInClaude?: boolean;
  /** Offered through "Use a sample posting" before the first application. */
  samplePosting: string | null;
  /** "+ New application": start over, whatever the tab kept. */
  fresh?: boolean;
  /** "Start application" on Manual job search: start over from this posting. */
  fromPosting?: FromPosting | null;
};

/**
 * New application (E7), the same way the job agent drafts: paste the posting
 * or fetch it from its link, then Prepare draft reads it, writes the tailored
 * resume and saves the Draft application in the background, and opens it,
 * where everything else happens (cover letter, chat, Quick Apply). The
 * posting is kept in Manual job search's Saved for later as soon as the draft
 * is started, so it can be picked up there later.
 */
export function NewApplication({ aiReady, localModel = false, writeInClaude = false, samplePosting, fresh = false, fromPosting = null }: NewApplicationProps) {
  const [initial] = useState<Draft>(() => ({ step: "paste", posting: "", postingUrl: "", jobId: null, postingId: null }));
  // The server renders a fresh draft; the tab's own draft takes over once the page is live.
  const stored = useSyncExternalStore(draftStore?.subscribe ?? noStore, () => draftStore?.get() ?? null, () => null);
  const draft = stored ?? initial;
  const setDraft = (next: (current: Draft) => Draft) => draftStore?.set(next(draftStore?.get() ?? initial));
  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const router = useRouter();
  useEffect(() => {
    if (!fresh) return;
    draftStore?.clear();
    router.replace("/new");
  }, [fresh, router]);
  // E14-8: a posting from Manual job search replaces the tab's draft, as "+ New
  // application" would, at the paste step, to check before preparing its draft.
  useEffect(() => {
    if (!fromPosting) return;
    draftStore?.set({ ...initial, posting: fromPosting.text, postingUrl: fromPosting.url, postingId: fromPosting.id, startupId: fromPosting.startup?.id ?? null });
    toast(
      fromPosting.startup
        ? `Here's what Startups knows about ${fromPosting.startup.company}, without its addresses. Add the role you're after if it doesn't say, then prepare the draft.`
        : fromPosting.complete
          ? "Here's the posting from Manual job search. Check it, then prepare the draft."
          : "Only the start of this posting came through. Paste the rest from the posting's page, then prepare the draft.",
    );
    router.replace("/new");
  }, [fromPosting, initial, router]);
  const [starting, setStarting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [revision, setRevision] = useState(0);

  // E11-3: the next step replaces the controls of this one, so focus moves to it.
  const stepArea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stepArea.current?.querySelector<HTMLElement>("h2[tabindex]")?.focus();
  }, [draft.step]);

  // Done: the draft opens, as an agent draft's Review does.
  const job = useJob<{ applicationId: string }>(draft.step === "preparing" ? draft.jobId : null, revision, (update) => {
    if (update.status !== "DONE" || !update.result) return;
    toast("Your draft is ready. Nothing gets sent until you say so.");
    draftStore?.clear();
    router.push(`/applications/${update.result.applicationId}`);
  });

  const prepare = async () => {
    if (!draft.posting.trim()) {
      toast(samplePosting ? "Paste a job posting first, or try the sample." : "Paste a job posting first.");
      return;
    }
    setStarting(true);
    const result = toastResult(await startPreparingDraft({ posting: draft.posting, postingUrl: draft.postingUrl, postingId: draft.postingId ?? null, startupId: draft.startupId ?? null }));
    setStarting(false);
    // Kept in Saved for later from now on, to pick up there later.
    if (result.ok) update({ step: "preparing", jobId: result.data.jobId, postingId: result.data.postingId });
  };

  const retryPreparing = async () => {
    if (!draft.jobId) return;
    if (toastResult(await retry({ id: draft.jobId })).ok) setRevision((count) => count + 1);
  };

  // #221: Claude chat writes it on the user's own Claude plan, through the
  // connector, and saves it here as a Draft application.
  const writeWithClaude = async () => {
    if (!draft.posting.trim()) return toast("Paste a job posting first.");
    // Opened now, while the click still counts: a tab opened after waiting is blocked as a pop-up.
    const chat = openPendingTab();
    setStarting(true);
    const result = toastResult(await handOffToClaude({ posting: draft.posting, postingUrl: draft.postingUrl }));
    setStarting(false);
    if (!result.ok) return void chat?.close();
    sendPendingTab(chat, result.data.url);
    toast("Writing it in Claude. It shows up under Applications as a Draft once Claude has saved it.");
  };

  // E7-8: the posting's text from its link, to check before preparing the draft.
  const fetchFromLink = async () => {
    if (!draft.postingUrl.trim()) return toast("Enter the link to the posting first.");
    setFetching(true);
    const result = toastResult(await fetchPostingText({ link: draft.postingUrl }));
    setFetching(false);
    if (!result.ok) return;
    const previous = draft.posting;
    update({ posting: result.data.text });
    const site = new URL(result.data.url).hostname.replace(/^www\./, "");
    toast(
      `Fetched the posting from ${site}. Check it before preparing the draft.`,
      previous.trim() ? { action: { label: "Undo", onClick: () => update({ posting: previous }) } } : {},
    );
  };

  return (
    <>
      <PageHeader
        title="New manual application"
        description="For a job you found yourself, or one someone emailed you. Paste its description or fetch it from its link, and Scout drafts a tailored resume from it, the same way the job agent does."
      />
      <div className="mx-auto flex w-full max-w-[816px] flex-col gap-6 px-10 pb-20">
        <Stepper steps={STEPS} current={draft.step === "preparing" ? 1 : 0} aria-label="New application steps" />

        <div ref={stepArea} className="contents">
          {draft.step === "paste" && (
            <>
              {writeInClaude ? (
                <p role="note" className="rounded-card border border-line-card bg-card px-4 py-3 text-meta text-muted">
                  Scout has no AI model of its own, so Claude writes this one: <strong className="text-ink">Write it with Claude</strong> opens a
                  chat in Claude that uses your Claude plan and the Scout connector, and saves the resume and cover letter here as a Draft. To
                  have Scout write it instead,{" "}
                  <Link title="Choose an AI model in Settings" href="/settings?section=ai" className="font-medium text-ink underline underline-offset-2">
                    choose a model in Settings → AI provider
                  </Link>
                  .
                </p>
              ) : (
                !aiReady && (
                  <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
                    No AI provider is set up yet, so nothing can read the posting.{" "}
                    <Link title="Choose an AI model in Settings" href="/settings?section=ai" className="font-medium text-warning underline underline-offset-2">
                      Choose one in Settings → AI provider
                    </Link>
                  </p>
                )
              )}
              <Card className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <div className="flex items-end gap-3">
                    <Input
                      className="flex-1"
                      label="Link to the posting (optional)"
                      type="url"
                      inputMode="url"
                      placeholder="https://"
                      value={draft.postingUrl}
                      onChange={(event) => update({ postingUrl: event.target.value })}
                    />
                    <Button title="Read the job description from its link" variant="secondary" className="mb-px" aria-disabled={fetching || undefined} onClick={() => void (fetching ? undefined : fetchFromLink())}>
                      {fetching ? "Fetching…" : "Fetch"}
                    </Button>
                  </div>
                  <p className="text-meta text-muted">
                    Paste the job&apos;s link and press Fetch: Scout fills in the posting below for you, and keeps the link with the application. No link,
                    say for a posting you were emailed? Just paste its text below.
                  </p>
                </div>
                <Textarea
                  label="Job posting"
                  rows={14}
                  hint="Filled in by Fetch, or paste the full posting yourself when a site can't be fetched."
                  placeholder="Paste the full posting here: title, company, requirements, the lot."
                  value={draft.posting}
                  onChange={(event) => update({ posting: event.target.value })}
                />
              </Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                {samplePosting ? (
                  <Button title="Fill in a made-up posting, to try Scout out" variant="text" className="underline underline-offset-[3px]" onClick={() => update({ posting: samplePosting })}>
                    Use a sample posting
                  </Button>
                ) : (
                  <span />
                )}
                <Button title="Write a tailored resume for this job" aria-disabled={!draft.posting.trim() || starting || undefined} onClick={() => void (starting ? undefined : writeInClaude ? writeWithClaude() : prepare())}>
                  {writeInClaude ? "Write it with Claude →" : "Prepare draft →"}
                </Button>
              </div>
              {!writeInClaude && (
                <p className="-mt-3 text-right text-meta text-muted">
                  Scout reads the posting, checks it against your profile and writes your tailored resume, then opens the draft. The posting is kept in
                  Saved for later, so you can come back to it from there.
                </p>
              )}
            </>
          )}

          {draft.step === "preparing" && (
            <>
              <JobProgress
                localModel={localModel}
                title="Preparing your draft…"
                steps={PREPARE_STEPS}
                current={jobStep(PREPARE_STEPS, job)}
                error={job?.status === "FAILED" ? job.error : null}
                onRetry={() => void retryPreparing()}
                onBack={() => update({ step: "paste", jobId: null })}
              />
              {job?.status !== "FAILED" && (
                <p className="text-meta text-muted">
                  You can leave this page: the draft keeps being prepared, and shows up in your{" "}
                  <Link title="Open your job application log" href="/applications" className="font-medium text-ink underline underline-offset-2">
                    Job application log
                  </Link>{" "}
                  when it&apos;s ready.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
