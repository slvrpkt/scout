"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";

import { DuplicateBadge, DuplicateNote } from "@/components/duplicate-note";
import { ScoreBadge } from "@/components/score-badge";
import { ScoreExplainer } from "@/components/score-explainer";
import { HowToApply } from "@/components/how-to-apply";
import { linksAttribution, SourceAttribution } from "@/components/source-attribution";
import { toast, toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { useJob } from "@/hooks/use-job";
import { openPendingTab, sendPendingTab } from "@/lib/claude-tab";
import { cn } from "@/lib/cn";
import type { PostingFit } from "@/lib/fit";
import type { JobView } from "@/lib/jobs/runner";
import { postedAgo, postingKey, type FoundPosting, type PostingState, type ShownPosting, type StoredSearch } from "@/lib/job-search/search";
import { arbeitsagenturPage, SOURCE_INFO } from "@/lib/job-search/sources";

import { dismissFoundPosting, loadFullText, restorePosting, savePostingForLater, showMorePostings, startScoringPosting, unsavePosting } from "./actions";
import { useStartApplication } from "./use-start-application";

/** Narrow windows show the posting above the list. */
const NARROW = "(max-width: 1023px)";

export type PostingResultsProps = {
  today: string;
  /** Score opens a Claude chat, which scores through the connector: it's on, and Scout has no AI model of its own (#221). */
  scoreInClaude?: boolean;
} & (
  | {
      mode: "search";
      /** The kept search (E14-10). */
      search: StoredSearch;
      /** Runs the same search anew, as a new kept search. */
      onSearchAgain: () => void;
      searching: boolean;
    }
  | { mode: "saved" | "dismissed"; postings: ShownPosting[] }
);

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Postings in a list, and the selected one's whole text beside it, or above
 * it on narrow windows: what a kept search found (E14-6, E14-10), with
 * dismissed ones left out unless shown, or the Saved or Dismissed postings
 * (E14-7), which leave the list when they're no longer saved or dismissed.
 */
export function PostingResults(props: PostingResultsProps) {
  const { mode } = props;
  const [postings, setPostings] = useState(mode === "search" ? props.search.postings : props.postings);
  const [next, setNext] = useState(mode === "search" ? props.search.next : null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const inView = ({ state }: ShownPosting) => (mode === "saved" ? state.saved : mode === "dismissed" ? state.dismissed : showDismissed || !state.dismissed);
  // The same job from another board, already in the log, stays out of the list.
  const visible = postings.filter(inView).filter((posting) => mode !== "search" || posting.state.duplicate?.kind !== "duplicate");
  const hidden = mode === "search" ? postings.filter((posting) => posting.state.dismissed).length : 0;
  const [selectedKey, setSelectedKey] = useState(visible[0] ? postingKey(visible[0]) : null);
  const selected = visible.find((posting) => postingKey(posting) === selectedKey) ?? visible[0] ?? null;
  const detail = useRef<HTMLElement>(null);
  const now = new Date(props.today);
  const { starting, start } = useStartApplication();
  // Postings being scored (#208), with the step under way, by postingKey.
  const [scoring, setScoring] = useState<Record<string, { jobId: string; step: string | null }>>({});

  const updateState = (key: string, change: Partial<PostingState>) =>
    setPostings((list) => list.map((posting) => (postingKey(posting) === key ? { ...posting, state: { ...posting.state, ...change } } : posting)));

  const select = (key: string, { reveal = false } = {}) => {
    setSelectedKey(key);
    if (reveal && window.matchMedia?.(NARROW).matches) detail.current?.scrollIntoView({ block: "start" });
  };

  /** Changes a posting's state; when that takes it out of the list, the next one takes its place. */
  const change = (posting: ShownPosting, state: Partial<PostingState>) => {
    const key = postingKey(posting);
    const index = visible.findIndex((entry) => postingKey(entry) === key);
    const after = visible[index + 1] ?? visible[index - 1];
    updateState(key, state);
    if (!inView({ ...posting, state: { ...posting.state, ...state } }) && after) setSelectedKey(postingKey(after));
  };

  const save = async (posting: ShownPosting) => {
    const result = toastResult(await savePostingForLater({ posting: withoutState(posting) }));
    if (!result.ok) return;
    change(posting, { saved: true, dismissed: false, postingId: result.data.postingId });
    setSelectedKey(postingKey(posting));
  };

  const unsave = async (posting: ShownPosting) => {
    const result = await unsavePosting({ source: posting.source, externalId: posting.externalId });
    if (!result.ok) return void toast(result.error);
    change(posting, { saved: false });
    // In Saved, the posting leaves the list: Undo puts it back.
    if (mode === "saved") toast("Removed from Saved.", { action: { label: "Undo", onClick: () => void save(posting) } });
    else toastResult(result);
  };

  const restore = async (posting: ShownPosting, saved: boolean) => {
    const result = toastResult(await restorePosting({ source: posting.source, externalId: posting.externalId, saved }));
    if (!result.ok) return;
    change(posting, { dismissed: false, saved });
    if (mode === "dismissed") toast("Put back. It'll show in your searches again.");
  };

  const dismiss = async (posting: ShownPosting) => {
    const result = await dismissFoundPosting({ posting: withoutState(posting) });
    if (!result.ok) return void toast(result.error);
    change(posting, { dismissed: true, saved: false });
    toast("Archived. It won't show in your searches; find it under Archived.", {
      action: {
        label: "Undo",
        onClick: () => {
          void restore(posting, result.data.wasSaved);
          setSelectedKey(postingKey(posting));
        },
      },
    });
  };

  const score = async (posting: ShownPosting) => {
    const key = postingKey(posting);
    if (scoring[key]) return;
    setScoring((current) => ({ ...current, [key]: { jobId: "", step: null } }));
    // Opened now, while the click still counts: a tab opened after waiting is blocked as a pop-up (#221).
    const chat = props.scoreInClaude ? openPendingTab() : null;
    const result = toastResult(await startScoringPosting({ posting: withoutState(posting) }));
    if (result.ok && "handoff" in result.data) {
      sendPendingTab(chat, result.data.handoff);
      setScoring((current) => without(current, key));
      toast("Scoring it in Claude. Reload this page once Claude has saved the score.");
      return;
    }
    chat?.close();
    setScoring((current) => (result.ok && "jobId" in result.data ? { ...current, [key]: { jobId: result.data.jobId, step: null } } : without(current, key)));
  };

  const scoringChanged = (key: string, job: JobView<PostingFit>) => {
    if (job.status === "DONE" || job.status === "FAILED") {
      setScoring((current) => without(current, key));
      if (job.status === "DONE" && job.result) updateState(key, { score: job.result });
      else toast(job.error ?? "The posting couldn't be scored. Try again.");
      return;
    }
    setScoring((current) => (current[key] ? { ...current, [key]: { ...current[key], step: job.step } } : current));
  };

  const showMore = async () => {
    if (props.mode !== "search" || !next || loadingMore) return;
    setLoadingMore(true);
    const result = await showMorePostings({ searchId: props.search.id });
    setLoadingMore(false);
    if (!result.ok) return void toast(result.error);
    if (!result.data.ok) return void toast(result.data.message);
    const seen = new Set(postings.map(postingKey));
    setPostings([...postings, ...result.data.postings.filter((posting) => !seen.has(postingKey(posting)))]);
    setNext(result.data.next);
  };

  const searched = props.mode === "search" ? props.search.query : null;
  const radius = props.mode === "search" && SOURCE_INFO[props.search.source].radius;
  const empty =
    mode === "saved"
      ? "Nothing saved."
      : mode === "dismissed"
        ? "Nothing archived. Postings you archive stay out of your searches and wait here."
        : postings.length > 0 || !searched
          ? "You've dismissed every posting here."
          : radius
            ? `No postings for “${searched.keywords}”${searched.place ? ` within ${searched.radiusKm} km of ${searched.place}` : ""}. Try a bigger radius or fewer words.`
            : `No postings for “${searched.keywords}”${searched.place ? ` in ${searched.place}` : ""}. Try fewer words.`;

  return (
    <div className="flex flex-wrap items-start gap-6 px-10 pb-16">
      {Object.entries(scoring).map(([key, { jobId }]) =>
        jobId ? <ScoreWatcher key={jobId} jobId={jobId} onChange={(job) => scoringChanged(key, job)} /> : null,
      )}
      <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-3">
        <p className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1 text-meta text-muted", mode !== "search" && visible.length === 0 && "hidden")}>
          <span>
            {props.mode === "search"
              ? `${plural(postings.length, "posting", "postings")} from ${SOURCE_INFO[props.search.source].name}${next ? ", more to come" : ""} · searched ${props.search.ranAt}`
              : mode === "saved"
                ? plural(visible.length, "saved posting", "saved postings")
                : `${plural(visible.length, "archived posting", "archived postings")}, kept out of your searches`}
          </span>
          {props.mode === "search" && (
            <button
              type="button"
              onClick={props.searching ? undefined : props.onSearchAgain}
              aria-disabled={props.searching || undefined}
              className="underline underline-offset-3 hover:text-ink aria-disabled:text-faint"
            >
              Search again
            </button>
          )}
          {hidden > 0 && (
            <button
              type="button"
              aria-pressed={showDismissed}
              onClick={() => setShowDismissed(!showDismissed)}
              className="underline-offset-3 hover:text-ink aria-pressed:text-ink aria-pressed:underline"
            >
              {hidden === 1 ? "1 archived posting hidden" : `${hidden} archived postings hidden`} · {showDismissed ? "Hide" : "Show"}
            </button>
          )}
        </p>

        {visible.length === 0 ? (
          <div className="rounded-panel border border-line-card bg-card px-5 py-9 text-center text-sm text-muted">{empty}</div>
        ) : (
          <PostingList
            updated={mode === "search" ? props.search.ranAt : null}
            postings={visible}
            selectedKey={selected ? postingKey(selected) : null}
            now={now}
            onSelect={select}
            scoring={scoring}
            onScore={(posting) => void score(posting)}
          />
        )}

        {next && (
          <Button variant="secondary" className="self-start" onClick={() => void showMore()} aria-disabled={loadingMore || undefined}>
            {loadingMore ? "Loading more…" : "Show more"}
          </Button>
        )}
      </div>

      {selected && (
        <PostingDetail
          key={postingKey(selected)}
          ref={detail}
          posting={selected}
          now={now}
          onUnsave={() => void unsave(selected)}
          onDismiss={() => void dismiss(selected)}
          onRestore={() => void restore(selected, false)}
          scoring={scoring[postingKey(selected)] ?? null}
          onScore={() => void score(selected)}
          onOpen={selected.state.dismissed ? undefined : () => void start(withoutState(selected), postingKey(selected))}
          opening={starting === postingKey(selected)}
          foundOn={mode === "search" ? props.search.ranAt : null}
        >
          {!selected.state.dismissed && (
            <StartButton starting={starting === postingKey(selected)} onClick={() => void start(withoutState(selected), postingKey(selected))} />
          )}
        </PostingDetail>
      )}
    </div>
  );
}

/** A copy of `record` without `key`. */
function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

/** Follows a posting's scoring job (#208). */
function ScoreWatcher({ jobId, onChange }: { jobId: string; onChange: (job: JobView<PostingFit>) => void }) {
  useJob<PostingFit>(jobId, 0, onChange);
  return null;
}

/** Review Opportunity on a posting (E14-8), as on Agentic job search: New application, with the posting filled in. */
export function StartButton({ starting, onClick }: { starting: boolean; onClick: () => void }) {
  return (
    <Button size="sm" aria-disabled={starting || undefined} onClick={starting ? undefined : onClick}>
      {starting ? "Opening…" : "Review Opportunity"}
    </Button>
  );
}

/** The posting as the server takes it back: without where it stands. */
function withoutState(posting: ShownPosting): FoundPosting {
  const { state, ...found } = posting;
  void state;
  return found;
}

/** The Score pill on an unscored posting in the list, and the room the card keeps for it. */
const pill = "inline-flex h-6 items-center rounded-full border px-2 text-xs";

function PostingList({
  postings,
  selectedKey,
  now,
  onSelect,
  scoring,
  onScore,
  updated,
}: {
  /** When this search ran, for its cards. */
  updated?: string | null;
  postings: ShownPosting[];
  selectedKey: string | null;
  now: Date;
  onSelect: (key: string, options?: { reveal?: boolean }) => void;
  /** Postings being scored, by postingKey. */
  scoring: Record<string, unknown>;
  onScore: (posting: ShownPosting) => void;
}) {
  // Up and down move through the list, as in a mail inbox.
  const move = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-posting]")];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const target = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (!target) return;
    event.preventDefault();
    target.focus();
    onSelect(target.dataset.posting!);
  };

  return (
    <ul aria-label="Postings" className="flex flex-col gap-2" onKeyDown={move}>
      {postings.map((posting) => {
        const key = postingKey(posting);
        const current = key === selectedKey;
        const title = posting.title || "Untitled posting";
        const pillLabel = scoring[key] ? "Scoring…" : "Score";
        return (
          <li key={key} className={cn("group relative", posting.state.dismissed && "opacity-60")}>
            <button
              type="button"
              data-posting={key}
              aria-pressed={current}
              onClick={() => onSelect(key, { reveal: true })}
              className={cn(
                "flex w-full flex-col gap-1 rounded-card border bg-card px-4 py-3.5 text-left group-hover:border-line-strong",
                current ? "border-primary bg-selected shadow-[0_0_0_1px_var(--color-primary)]" : "border-line-card",
              )}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="text-field font-medium text-pretty">{title}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <StateBadges state={posting.state} />
                  {posting.state.score ? (
                    <ScoreBadge score={posting.state.score.score} size="sm" />
                  ) : (
                    <span aria-hidden className={cn(pill, "invisible")}>
                      {pillLabel}
                    </span>
                  )}
                </span>
              </span>
              <span className="text-meta text-muted">{[posting.company, posting.place, posting.remote ? "Remote" : ""].filter(Boolean).join(" · ")}</span>
              <span className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-xs text-muted">
                  {[postedAgo(posting.postedAt, now), posting.via && `via ${posting.via}`, posting.salary, updated && `Last updated ${updated}`].filter(Boolean).join(" · ")}
                </span>
                <SourceAttribution source={posting.source} url={posting.url} placeholder />
              </span>
            </button>
            {/* A button can't hold another, so the pill lies over the room the card keeps for it, with the card's border and padding. */}
            {!posting.state.score && (
              <span className="pointer-events-none absolute inset-0 flex items-start justify-end border border-transparent px-4 py-3.5">
                <button
                  type="button"
                  aria-label={`${pillLabel} “${title}”`}
                  aria-disabled={scoring[key] ? true : undefined}
                  onClick={scoring[key] ? undefined : () => onScore(posting)}
                  className={cn(
                    pill,
                    "pointer-events-auto border-dashed border-line-strong text-muted hover:border-muted hover:text-ink aria-disabled:cursor-default aria-disabled:hover:border-line-strong aria-disabled:hover:text-muted motion-safe:aria-disabled:animate-pulse",
                  )}
                >
                  {pillLabel}
                </button>
              </span>
            )}
            {/* Adzuna's label is a link, so it lies over room the card keeps too (E14-2). */}
            {linksAttribution(posting.source) && (
              <span className="pointer-events-none absolute inset-0 flex items-end justify-end border border-transparent px-4 py-3.5">
                <SourceAttribution source={posting.source} url={posting.url} className="pointer-events-auto" />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StateBadges({ state }: { state: PostingState }) {
  // A duplicate says it instead of Applied, with the application it matches (#43).
  const badges = [!state.duplicate && state.applicationId && "Applied", state.saved && "Saved", state.dismissed && "Archived"].filter(Boolean) as string[];
  if (badges.length === 0 && !state.duplicate) return null;
  return (
    <span className="flex shrink-0 gap-1.5">
      {state.duplicate && <DuplicateBadge match={state.duplicate} />}
      {badges.map((badge) => (
        <span key={badge} className="rounded-full bg-track px-2 py-0.5 text-xs text-ink">
          {badge}
        </span>
      ))}
    </span>
  );
}

/** The Agentic card's date capsules: posted in green, found in blue. */
const capsule = "rounded-full px-2 py-[2px] text-xs font-medium whitespace-nowrap";
// A posting's date has no time of day: read in UTC, it stays that day wherever you are.
const POSTED_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

type Text = { status: "ready"; text: string } | { status: "loading" } | { status: "partial"; text: string };

/** The selected posting: its facts, what to do with it, and its whole text. */
function PostingDetail({
  ref,
  posting,
  now,
  onUnsave,
  onDismiss,
  onRestore,
  scoring,
  onScore,
  onOpen,
  opening = false,
  foundOn = null,
  children,
}: {
  ref: Ref<HTMLElement>;
  posting: ShownPosting;
  now: Date;
  onUnsave: () => void;
  onDismiss: () => void;
  onRestore: () => void;
  /** While it's being scored (#208): the step under way. */
  scoring: { step: string | null } | null;
  onScore: () => void;
  /** The title's click: what Review Opportunity does; none for an archived posting. */
  onOpen?: () => void;
  opening?: boolean;
  /** When the search that found it ran, e.g. "today at 14:32". */
  foundOn?: string | null;
  /** More actions, first in the row (E14-8). */
  children?: ReactNode;
}) {
  const headingId = useId();
  const sourcePage = arbeitsagenturPage(posting);
  // The posting as first shown; the component is keyed by it.
  const [initial] = useState(posting);
  const [text, setText] = useState<Text>(initial.complete ? { status: "ready", text: initial.description } : { status: "loading" });

  // A source that only sent the start: ask for the rest (E14-2, E14-3).
  useEffect(() => {
    if (initial.complete) return;
    let current = true;
    void loadFullText({ posting: withoutState(initial) }).then((result) => {
      if (!current) return;
      const full = result.ok ? result.data.text : null;
      setText(full ? { status: "ready", text: full } : { status: "partial", text: initial.description });
    });
    return () => {
      current = false;
    };
  }, [initial]);

  const { state } = posting;
  const ago = postedAgo(posting.postedAt, now);
  const facts = [posting.place, posting.remote ? "Remote" : "", posting.salary].filter(Boolean).join(" · ");
  const posted = posting.postedAt ? POSTED_DATE.format(new Date(posting.postedAt)) : null;

  return (
    <section
      ref={ref}
      aria-labelledby={headingId}
      className="flex min-w-0 flex-[999_1_420px] scroll-mt-[121px] flex-col gap-4 rounded-panel border border-line-card bg-card p-7 max-lg:order-first max-lg:max-h-[75vh] lg:sticky lg:top-[121px] lg:max-h-[calc(100dvh-145px)]"
    >
      {/* As on Agentic job search: the facts, and the score in its circle at the top right. */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 id={headingId} className="font-serif text-section text-pretty">
            {onOpen ? (
              <button
                type="button"
                aria-disabled={opening || undefined}
                onClick={opening ? undefined : onOpen}
                className="text-left underline-offset-4 hover:underline aria-disabled:cursor-default"
              >
                {posting.title || "Untitled posting"}
              </button>
            ) : (
              posting.title || "Untitled posting"
            )}
          </h2>
          {/* As on Agentic job search: the company, the facts, where it's from, and when it was posted and found. */}
          {posting.company && <p className="text-sm text-ink">{posting.company}</p>}
          {facts && <p className="text-meta text-muted">{facts}</p>}
          <p className="text-xs text-muted">{(posting.pasted ? ["Pasted into New application"] : [posting.via && `via ${posting.via}`, `on ${SOURCE_INFO[posting.source].name}`]).filter(Boolean).join(" ")}</p>
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            <span className={`${capsule} bg-success-surface text-success`} title={ago || undefined}>
              {posted ? `Posted ${posted}` : "Posted date not given"}
            </span>
            {foundOn && <span className={`${capsule} bg-selected text-primary-text`}>Last updated {foundOn}</span>}
          </span>
          <span className="mt-1.5">
            <HowToApply url={posting.url} />
          </span>
        </div>
        {state.score && !scoring ? (
          <ScoreExplainer
            score={state.score.score}
            title={[posting.title, posting.company].filter(Boolean).join(" at ")}
            reasons={state.score.reasons}
            redFlags={state.score.redFlags}
            breakdown={state.score.breakdown}
            onRescore={onScore}
          />
        ) : (
          // Not scored yet: Manual job search scores on request, so the circle starts it.
          <button
            type="button"
            aria-disabled={scoring ? true : undefined}
            onClick={scoring ? undefined : onScore}
            className="grid size-11 flex-none place-items-center rounded-full border border-dashed border-line-strong text-xs text-muted hover:border-muted hover:text-ink aria-disabled:cursor-default aria-disabled:hover:border-line-strong aria-disabled:hover:text-muted motion-safe:aria-disabled:animate-pulse"
          >
            {scoring ? "Scoring…" : "Score"}
          </button>
        )}
      </div>

      {state.duplicate ? (
        <DuplicateNote match={state.duplicate} />
      ) : state.applicationId && (
        <p role="note" className="rounded-card bg-track px-4 py-3 text-meta">
          You&apos;ve applied for this.{" "}
          <Link href={`/applications/${state.applicationId}`} className="underline underline-offset-2">
            Open the application
          </Link>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {children}
        {state.dismissed && (
          <Button variant="secondary" size="sm" onClick={onRestore}>
            Put back
          </Button>
        )}
        {posting.url && (
          <a href={posting.url} target="_blank" rel="noopener noreferrer" className={buttonClassName("secondary", "sm")}>
            Open posting<span aria-hidden>↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
        {/* A BA posting with a link of its own still links to its ad on arbeitsagentur.de (#223). */}
        {sourcePage && sourcePage !== posting.url && (
          <a href={sourcePage} target="_blank" rel="noopener noreferrer" className={buttonClassName("secondary", "sm")}>
            On arbeitsagentur.de<span aria-hidden>↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
        {!state.dismissed && (
          <Button variant="danger-outline" size="sm" onClick={onDismiss}>
            Archive
          </Button>
        )}
        {/* Save is gone; what was saved before can still leave Saved, last in the row. */}
        {!state.dismissed && state.saved && (
          <Button variant="secondary" size="sm" onClick={onUnsave}>
            Remove from Saved
          </Button>
        )}
      </div>

      {scoring ? (
        <p role="status" className="text-meta text-muted">
          {scoring.step ?? "Starting…"}
        </p>
      ) : (
        state.score && (
          <>
            {state.score.reasons.length > 0 && (
              <ul aria-label="Why it fits" className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
                {state.score.reasons.map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            )}
            {state.score.redFlags.length > 0 && (
              <div className="rounded-card bg-warning-surface px-3.5 py-2.5 text-meta text-warning">
                <p className="font-medium">Worth knowing</p>
                <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
                  {state.score.redFlags.map((flag, index) => (
                    <li key={index}>{flag}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )
      )}

      {/* Only the text scrolls, so the title and actions stay in view; focusable, so it scrolls from the keyboard too. */}
      <div tabIndex={0} role="region" aria-label="Posting text" className="-mx-1 min-h-0 flex-1 overflow-y-auto border-t border-line px-1 pt-4">
        {text.status === "loading" ? (
          <p role="status" className="text-sm text-muted">
            Getting the whole posting…
          </p>
        ) : (
          <>
            {text.status === "partial" && (
              <p className="mb-3 rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
                This is only the start of the posting. When you start an application, you can paste the rest from the posting&apos;s page.
              </p>
            )}
            <div className="text-sm leading-relaxed whitespace-pre-line">{text.text || "The source didn't send a description."}</div>
          </>
        )}
      </div>
      {/* As the source's terms ask (E14-2, E14-3). */}
      <SourceAttribution source={posting.source} url={posting.url} className="self-start" />
    </section>
  );
}
