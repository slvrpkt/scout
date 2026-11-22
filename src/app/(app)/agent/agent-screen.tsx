"use client";

import { looksCutShort, shortPostingWarning } from "@/lib/posting-length";
import { ScoreNow } from "./score-now";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";

import { DuplicateBadge, DuplicateNote } from "@/components/duplicate-note";
import { FitSummary } from "@/components/fit-summary";
import { WorkModeBadge } from "@/components/work-mode-badge";
import { SaveForLaterButton } from "@/components/save-for-later-button";
import { PageHeader } from "@/components/page-header";
import { ScoreBadge } from "@/components/score-badge";
import { ScoreExplainer } from "@/components/score-explainer";
import { HowToApply } from "@/components/how-to-apply";
import { TrapWarning } from "@/components/trap-warning";
import {
  linksAttribution,
  SourceAttribution,
} from "@/components/source-attribution";
import { toast, toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useJob } from "@/hooks/use-job";
import type { Period, PeriodResults, RunResults } from "@/lib/agent/budget";
import type { AgentCandidateView, AgentView } from "@/lib/agent/view";
import { cn } from "@/lib/cn";

import { RecurringQuestions } from "./recurring-questions";
import {
  atPlace,
  countsOf,
  inScoreRange,
  placeChoices,
  SCORE_RANGES,
} from "@/lib/place-filter";

import {
  agentToday,
  dismissAgentCandidate,
  lookOnCompanySite,
  prepareAgentDraft,
  restoreAgentCandidate,
  runAgentNow,
  saveAgentPosting,
} from "./actions";

type ScanResult = { message: string };
type DraftResult = { applicationId: string };
type SourceResult = { found: boolean; score: number | null; skipped: boolean };
/** The list's tabs: All, Drafts to review (with those at the draft score still waiting for theirs), then score bands ten points apart below it. */
type Filter = "all" | "drafts" | "band1" | "band2" | "rest";

const SETTINGS: Record<
  NonNullable<AgentView["setupSection"]>,
  { href: string; label: string }
> = {
  agent: { href: "/settings?section=agent", label: "Settings → Job agent" },
  ai: { href: "/settings?section=ai", label: "Settings → AI provider" },
  jobs: { href: "/settings?section=jobs", label: "Settings → Job search" },
};

/**
 * The Agent screen (E16-6): what the job agent searches, when it runs, the
 * drafts it prepared and the postings it scored, waiting for a look. Nothing
 * here sends anything.
 */
/** How many postings the list shows at a time. */
const LIST_PAGE = 50;
/** How often the Today tile and the waiting line check for new counts while the page is open. */
const TODAY_EVERY_MS = 15_000;

type Today = {
  scored: number;
  drafted: number;
  inList: number;
  skipped: number;
  waiting: number;
  scoring: boolean;
  /** A run is searching right now. */
  running?: boolean;
  results: RunResults | null;
  all: RunResults & { since: string | null };
  periods: PeriodResults;
};

const SINCE = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** What the tiles count: the last run's postings, a calendar period's so far, or every run's since the first. */
type Range = "last" | Period | "all";
const RANGES: { value: Range; label: string; scores: string }[] = [
  { value: "last", label: "Last run", scores: "Last run's scores" },
  { value: "today", label: "Today", scores: "Today's scores" },
  { value: "week", label: "This week", scores: "This week's scores" },
  { value: "month", label: "This month", scores: "This month's scores" },
  { value: "all", label: "All time", scores: "All runs' scores" },
];
// A period's days are "2026-11-10" strings in your time zone, so they're shown as UTC to keep the date.
const DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});
const MONTH = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});
const dayDate = (day: string, plus = 0) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + plus * 86_400_000);
/** "Thu, Nov 13", "Mon, Nov 10 – Sun, Nov 16", "November 2026". */
const periodLine = (period: Period, from: string) =>
  period === "today"
    ? `${DAY.format(dayDate(from))}, since midnight`
    : period === "week"
      ? `${DAY.format(dayDate(from))} – ${DAY.format(dayDate(from, 6))}`
      : MONTH.format(dayDate(from));

export function AgentScreen({
  view,
  initialSelected = null,
}: {
  view: AgentView;
  initialSelected?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [runJobId, setRunJobId] = useState(view.runJobId);
  // Drafts to review first: they're what's waiting on you.
  const [filter, setFilter] = useState<Filter>("drafts");
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState("");
  const [where, setWhere] = useState("");
  const [scoreRange, setScoreRange] = useState("");
  const [postedWithin, setPostedWithin] = useState<
    "any" | "1" | "3" | "7" | "30"
  >("any");
  // 50 at a time.
  const [shown, setShown] = useState(LIST_PAGE);
  // When the page opened, for "Posted in the past week".
  const [openedAt] = useState(() => Date.now());
  const [selectedId, setSelectedId] = useState<string | null>(initialSelected);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // Back from a job: its card in view in the list, where you left it.
  useEffect(() => {
    if (!initialSelected) return;
    document.querySelector(`[data-candidate="${CSS.escape(initialSelected)}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [initialSelected]);

  const run = useJob<ScanResult>(runJobId, 0, (job) => {
    if (job.status !== "DONE" && job.status !== "FAILED") return;
    setRunJobId(null);
    toast(
      job.status === "DONE"
        ? (job.result?.message ?? "The run is done.")
        : (job.error ?? "The run didn't finish."),
    );
    router.refresh();
  });
  const running =
    Boolean(runJobId) &&
    (!run || run.status === "QUEUED" || run.status === "RUNNING");

  // Today's counts, checked every so often while the page is open; a fresh view from the server starts over from its own.
  const [live, setLive] = useState<{ view: AgentView; today: Today } | null>(
    null,
  );
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      void agentToday({}).then(
        (result) => result.ok && setLive({ view, today: result.data }),
      );
    }, TODAY_EVERY_MS);
    return () => clearInterval(timer);
  }, [view]);
  const today: Today =
    live?.view === view
      ? live.today
      : {
          scored: view.budget.scored,
          drafted: view.budget.drafted,
          inList: view.budget.inList,
          skipped: view.budget.skipped,
          waiting: view.waiting,
          scoring: view.batchOut || Boolean(view.runJobId),
          running: Boolean(view.runJobId),
          results: view.lastResults,
          all: view.allResults,
          periods: view.periodResults,
        };
  // The tiles: the last run's postings, today's, this week's or this month's so far, or every run's since the first.
  const [range, setRange] = useState<Range>("last");
  const shownResults =
    range === "last"
      ? today.results
      : range === "all"
        ? today.all
        : today.periods[range];
  const rangeInfo = RANGES.find((option) => option.value === range)!;
  const searching = running || Boolean(today.running);

  const runNow = () =>
    startTransition(async () => {
      const result = toastResult(await runAgentNow({}));
      if (result.ok) setRunJobId(result.data.jobId);
    });

  const hide = (id: string, gone: boolean) =>
    setHidden((current) => {
      const next = new Set(current);
      if (gone) next.add(id);
      else next.delete(id);
      return next;
    });

  const putBack = (id: string) =>
    void restoreAgentCandidate({ id }).then((restored) => {
      if (!toastResult(restored).ok) return;
      hide(id, false);
      router.refresh();
    });

  // Archive: nothing is deleted. A draft goes to the Job application log, archived; a posting to the Archive.
  const archive = (candidate: AgentCandidateView) =>
    startTransition(async () => {
      hide(candidate.id, true);
      const result = await dismissAgentCandidate({ candidateId: candidate.id });
      if (!result.ok) {
        hide(candidate.id, false);
        return toast(result.error);
      }
      const applicationId = result.data.archivedApplicationId;
      if (applicationId) {
        toast(
          "Archived in your Job application log, with its resume and cover letter.",
          {
            action: {
              label: "Open",
              onClick: () => router.push(`/applications/${applicationId}`),
            },
          },
        );
      } else {
        toast("Archived. It won't come back; find it in the Archive.", {
          action: { label: "Undo", onClick: () => putBack(candidate.id) },
        });
      }
      router.refresh();
    });

  const drafts = view.drafts.filter((candidate) => !hidden.has(candidate.id));
  const scored = view.scored.filter((candidate) => !hidden.has(candidate.id));
  const below = view.belowMinimum.filter(
    (candidate) => !hidden.has(candidate.id),
  );
  const empty = drafts.length === 0 && scored.length === 0;

  // Every tab lists the highest score first (each list comes sorted; All mixes them, so it's sorted again).
  // Past Drafts to review, the tabs are score bands ten points apart under your draft score, drafts or not.
  const bar = view.minScore;
  const all = [...drafts, ...scored, ...below].sort(
    (a, b) => b.score - a.score,
  );
  const inBand = (low: number, high: number) =>
    all.filter((candidate) => candidate.score >= low && candidate.score < high);
  // Drafts to review also lists postings at the draft score still waiting for their draft (the day's draft limit, say).
  const waitingIds = new Set(scored.map((candidate) => candidate.id));
  const lists: Record<Filter, AgentCandidateView[]> = {
    all,
    drafts: [
      ...drafts.filter((candidate) => candidate.score >= bar),
      ...scored,
    ].sort((a, b) => b.score - a.score),
    band1: inBand(bar - 10, bar),
    band2: inBand(bar - 20, bar - 10),
    rest: inBand(-Infinity, bar - 20),
  };
  // The companies and places in what it found, with how many jobs each, for the Company and Location filters.
  const everything = lists.all;
  const companies = countsOf(
    everything.map((candidate) => candidate.company.trim()).filter(Boolean),
  );
  const places = placeChoices(everything);
  const draftIds = new Set(drafts.map((candidate) => candidate.id));
  // The same filters as Manual job search, over what the agent found: what, where, remote only, and how recent.
  const within = (iso: string | null) =>
    postedWithin === "any" ||
    (iso !== null &&
      Date.parse(iso) >= openedAt - Number(postedWithin) * 86_400_000);
  const matches = (text: string, needle: string) =>
    !needle.trim() || text.toLowerCase().includes(needle.trim().toLowerCase());
  const list = lists[filter].filter(
    (candidate) =>
      matches(
        `${candidate.title} ${candidate.company} ${candidate.description}`,
        query,
      ) &&
      (!company || candidate.company.trim() === company) &&
      atPlace(candidate, where) &&
      inScoreRange(candidate.score, scoreRange) &&
      within(candidate.postedAt),
  );
  const selected =
    list.find((candidate) => candidate.id === selectedId) ?? list[0] ?? null;

  return (
    // A light green tint sets the agent's page apart from Manual job search.
    <div className="flex min-h-full flex-col bg-agent-tint">
      <PageHeader
        title="Agentic job search"
        wide
        description="At the times you choose, it runs each of your saved searches for new postings, scores them against your profile, and keeps the best here for you. Drafts wait for your review, and nothing is ever sent."
        actions={
          <Button title="Search for new postings now, instead of waiting for the next scheduled run"
            aria-disabled={running || pending || undefined}
            onClick={() => !running && !pending && runNow()}
          >
            {running ? "Running…" : "Run now"}
          </Button>
        }
      />
      <div className="-mt-4 flex flex-col gap-3.5 px-10 pb-20">
        <Notices view={view} />
        {today.waiting > 0 && (
          <ScoreNow
            waiting={today.waiting}
            scoring={running || today.scoring}
            onStarted={setRunJobId}
          />
        )}

        {/* The agent at a glance: the last run, the next one, and what the last run's postings became. Searches are in Settings → Job agent. */}
        {/* Kept short, so what it found starts high on the page. */}
        <Card padding="none" className="flex flex-col gap-2.5 px-4 py-3">
          <dl className="grid gap-2.5 lg:grid-cols-[1fr_1fr_2fr]">
            <Stat
              label={range === "all" ? "All runs" : rangeInfo.label}
              note={
                range === "last"
                  ? view.lastRun?.at
                  : range === "all"
                    ? today.all.since
                      ? `Since ${SINCE.format(new Date(today.all.since))}`
                      : "Since the first run"
                    : periodLine(range, today.periods[range].from)
              }
            >
              {searching && (
                // While a run searches: so it's plain nothing is stuck.
                <span className="mb-2 flex items-center gap-2 rounded-control bg-selected px-2.5 py-1.5 text-meta text-primary-text">
                  <span
                    aria-hidden="true"
                    className="size-3.5 flex-none animate-spin rounded-full border-2 border-current border-t-transparent"
                  />
                  Hang tight: the job search just started. It takes a few
                  minutes.
                </span>
              )}
              {range !== "last" && shownResults ? (
                <>
                  <Big
                    value={shownResults.found}
                    label={
                      shownResults.found === 1
                        ? "posting found"
                        : "postings found"
                    }
                  />
                  <span className="block text-meta text-muted">
                    {shownResults.scored.toLocaleString("en-US")} scored ·{" "}
                    {shownResults.setAside.toLocaleString("en-US")} set aside by
                    your settings before scoring
                    {shownResults.waiting > 0 &&
                      ` · ${shownResults.waiting.toLocaleString("en-US")} waiting for a score`}
                  </span>
                </>
              ) : view.lastRun ? (
                <>
                  {today.results && today.results.found > 0 ? (
                    <>
                      <Big
                        value={today.results.found}
                        label={
                          today.results.found === 1
                            ? "new posting found"
                            : "new postings found"
                        }
                      />
                      <span className="block text-meta text-muted">
                        {today.waiting > 0
                          ? `${today.results.scored} scored · ${today.waiting} ${today.scoring ? "being scored now" : "waiting for a score"}`
                          : `${today.results.scored} scored · ${today.results.setAside} set aside by your settings before scoring`}
                      </span>
                    </>
                  ) : (
                    <span className="mt-1 block text-sm">
                      {view.lastRun.message ?? "Nothing new."}
                    </span>
                  )}
                </>
              ) : (
                <span className="mt-1 block text-lg font-semibold">
                  Not yet
                </span>
              )}
            </Stat>
            <Stat
              label="Next run"
              note={
                view.nextRun
                  ? view.nextRunDue
                    ? "Starting now"
                    : view.nextRun.split(", ").slice(0, -1).join(", ") ||
                      "Today"
                  : undefined
              }
            >
              {view.nextRun ? (
                <span className="block text-[28px] leading-none font-bold tracking-tight tabular-nums">
                  {view.nextRun.split(", ").at(-1)}
                </span>
              ) : (
                <span className="block text-lg font-semibold">Off</span>
              )}
            </Stat>
            <Stat
              label={rangeInfo.scores}
              aside={
                // Last run, a calendar period so far, or every run since the first: deleted Archive records still count in all but the last run.
                <SegmentedControl<Range>
                  aria-label="Show"
                  size="sm"
                  options={RANGES.map(({ value, label }) => ({ value, label }))}
                  value={range}
                  onValueChange={setRange}
                />
              }
            >
              {shownResults ? (
                <span className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
                  <Big
                    value={shownResults.atMin}
                    label={`${view.minScore} and up`}
                  />
                  <Big
                    value={shownResults.below}
                    label={`Below ${view.minScore}`}
                  />
                  <Big value={shownResults.drafted} label="Drafted" />
                  <Big
                    value={shownResults.skipped}
                    label="Skipped by your rules"
                  />
                </span>
              ) : (
                <span className="block text-lg font-semibold">Nothing yet</span>
              )}
              <span className="mt-1 block text-meta text-muted">
                Daily limits: {today.scored} of {view.budget.scoreLimit} scores
                {view.autoDraft &&
                  ` and ${today.drafted} of ${view.budget.draftLimit} drafts`}{" "}
                used today
              </span>
            </Stat>
          </dl>
          {running && (
            <p
              role="status"
              className="border-t border-line pt-2.5 text-sm text-muted"
            >
              {run?.step ?? "Starting the run…"}
            </p>
          )}
        </Card>

        {/* What it found, as on Manual job search: a list to pick from, and the one picked beside it. */}
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label="Show"
            className="flex flex-wrap gap-1.5"
          >
            {(
              [
                ["drafts", `Drafts to review · ${bar}+`, lists.drafts.length],
                ["band1", `${bar - 10}–${bar - 1}`, lists.band1.length],
                ["band2", `${bar - 20}–${bar - 11}`, lists.band2.length],
                ["rest", `Below ${bar - 20}`, lists.rest.length],
                // Everything together, last: after the rest are worked through.
                ["all", "All", lists.all.length],
              ] satisfies [Filter, string, number][]
            ).map(([value, label, count]) => (
              <button title="Show only the jobs in this group"
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => {
                  setFilter(value);
                  setShown(LIST_PAGE);
                }}
                className={cn(
                  "flex items-baseline gap-1.5 rounded-control border px-3 py-1.5 text-control",
                  filter === value
                    ? "border-primary bg-selected font-medium text-primary-text"
                    : "border-line-field bg-card hover:border-line-strong hover:bg-hover",
                )}
              >
                {label} <span className="text-xs opacity-65">{count}</span>
              </button>
            ))}
          </div>
        </div>
        <Card
          padding="none"
          className="flex flex-wrap items-end gap-3 px-4 py-2.5"
        >
          <label className="flex min-w-[200px] flex-[2_1_220px] flex-col gap-1 text-label text-muted">
            What
            <input
              type="search"
              aria-label="Search what it found"
              placeholder="Title, company or anything in the posting"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="rounded-control border border-line-input bg-input px-2.5 py-1.5 text-sm text-ink placeholder:text-muted focus-visible:border-primary"
            />
          </label>
          <label className="flex min-w-[180px] flex-[1_1_200px] flex-col gap-1 text-label text-muted">
            Company
            <select
              value={company}
              onChange={(event) => setCompany(event.target.value)}
              className="rounded-control border border-line-input bg-input px-2.5 py-1.5 text-sm text-ink focus-visible:border-primary"
            >
              <option value="">Any company</option>
              {companies.map(([name, count]) => (
                <option key={name} value={name}>
                  {name} ({count})
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[180px] flex-[1_1_200px] flex-col gap-1 text-label text-muted">
            Location
            <select
              value={where}
              onChange={(event) => setWhere(event.target.value)}
              className="rounded-control border border-line-input bg-input px-2.5 py-1.5 text-sm text-ink focus-visible:border-primary"
            >
              <option value="">Anywhere</option>
              {places.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label} ({choice.count})
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[150px] flex-col gap-1 text-label text-muted">
            Posted
            <select
              value={postedWithin}
              onChange={(event) =>
                setPostedWithin(event.target.value as typeof postedWithin)
              }
              className="rounded-control border border-line-input bg-input px-2.5 py-1.5 text-sm text-ink focus-visible:border-primary"
            >
              <option value="any">Any time</option>
              <option value="1">Past 24 hours</option>
              <option value="3">Past 3 days</option>
              <option value="7">Past week</option>
              <option value="30">Past month</option>
            </select>
          </label>
          <label className="flex min-w-[130px] flex-col gap-1 text-label text-muted">
            Score
            <select
              value={scoreRange}
              onChange={(event) => setScoreRange(event.target.value)}
              className="rounded-control border border-line-input bg-input px-2.5 py-1.5 text-sm text-ink focus-visible:border-primary"
            >
              <option value="">Any score</option>
              {SCORE_RANGES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <p className="basis-full text-xs text-muted">
            Country and distance are set on each saved search in Settings → Job
            agent. Postings you archive, or the agent skips, are in the{" "}
            <Link title="See the postings you archived and the ones the agent skipped" href="/archive">Archive</Link>.
          </p>
        </Card>

        {/* Answer once what several drafts ask, above the drafts. */}
        {(filter === "drafts" || filter === "all") && (
          <RecurringQuestions
            questions={view.recurring.questions}
            roles={view.recurring.roles}
          />
        )}

        {list.length === 0 ? (
          <Empty>
            {filter === "all"
              ? empty
                ? "Nothing waiting yet. A run puts the postings that fit you best here."
                : "Nothing matches these filters."
              : lists[filter].length > 0
                ? "Nothing matches these filters."
                : filter === "drafts"
                  ? view.autoDraft
                    ? `No drafts yet. After a run, new postings scoring ${bar} or more get a draft here.`
                    : "No drafts yet. Prepare one from a scored posting, or let the agent prepare them in Settings → Job agent."
                  : "Nothing scored in this range."}
          </Empty>
        ) : (
          // The list runs as far down as the job beside it (at least 560px), scrolling inside.
          <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
            <div className="relative lg:min-h-[560px]">
              <ul
                aria-label="What it found"
                className="flex flex-col gap-2 lg:absolute lg:inset-0 lg:overflow-y-auto lg:pr-1"
              >
                {list.slice(0, shown).map((candidate) => (
                  <li key={candidate.id}>
                    <button title="Show this job's details on the right"
                      type="button"
                      aria-pressed={selected?.id === candidate.id}
                      data-candidate={candidate.id}
                      onClick={() => setSelectedId(candidate.id)}
                      className={cn(
                        "flex w-full items-start justify-between gap-3 rounded-card border bg-card px-4 py-3 text-left hover:border-line-strong",
                        selected?.id === candidate.id
                          ? "border-ink shadow-control"
                          : "border-line-card",
                      )}
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-field font-medium text-ink">
                          {candidate.title}
                        </span>
                        <span className="text-meta text-muted">
                          {[candidate.company, candidate.facts]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <WorkModeBadge posting={candidate} className="mt-0.5" />
                        <FoundDates candidate={candidate} />
                        {candidate.fresh && <Fresh label={candidate.fresh} />}
                        {candidate.wasArchived && <WasArchived />}
                        {waitingIds.has(candidate.id) && <WaitingForDraft />}
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1.5">
                        <ScoreBadge score={candidate.score} size="sm" />
                        {candidate.duplicate && (
                          <DuplicateBadge match={candidate.duplicate} />
                        )}
                      </span>
                    </button>
                  </li>
                ))}
                {list.length > shown && (
                  <li>
                    <Button title="Load the next 50 jobs in this list"
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      onClick={() => setShown((count) => count + LIST_PAGE)}
                    >
                      Show more ({list.length - shown} more)
                    </Button>
                  </li>
                )}
              </ul>
            </div>
            {selected && (
              <div key={selected.id} className="min-w-0 self-start">
                {draftIds.has(selected.id) ? (
                  <CandidateCard candidate={selected} minScore={view.minScore}>
                    <Link title="Open the tailored resume drafted for this job, to review and refine it"
                      href={`/applications/${selected.applicationId}`}
                      className={buttonClassName(
                        "primary",
                        "sm",
                        "hover:text-on-primary",
                      )}
                    >
                      Review Opportunity
                    </Link>
                    <OpenPosting url={selected.sourceUrl ?? selected.url} />
                    <ArchiveButton onClick={() => archive(selected)} />
                  </CandidateCard>
                ) : (
                  <ScoredCard
                    candidate={selected}
                    minScore={view.minScore}
                    onArchive={() => archive(selected)}
                    waiting={waitingIds.has(selected.id)}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Archive, the same on every screen: it hides and keeps; Delete is only in an application's menu. */
export function ArchiveButton({
  onClick,
  size = "sm",
}: {
  onClick: () => void;
  size?: "sm" | "md";
}) {
  return (
    <Button title="Hide this job; it's kept in the Archive, nothing is deleted" variant="danger-outline" size={size} onClick={onClick}>
      Archive
    </Button>
  );
}

/** Why the agent isn't running, and where to fix it. */
function Notices({ view }: { view: AgentView }) {
  const note = (children: ReactNode) => (
    <p
      role="note"
      className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning"
    >
      {children}
    </p>
  );
  if (!view.enabled) {
    return note(
      <>
        The job agent is off.{" "}
        <Link title="Open the agent's settings to switch it on"
          href={SETTINGS.agent.href}
          className="font-medium text-warning underline underline-offset-2"
        >
          Turn it on in Settings → Job agent
        </Link>
        {view.drafts.length + view.scored.length > 0 &&
          ". What it found before is still here."}
      </>,
    );
  }
  if (view.setupProblem && view.setupSection) {
    return note(
      <>
        {view.setupProblem.replace(/ in Settings → [^.]+ first\.$/, ".")}{" "}
        <Link title="Open the settings that need fixing before the agent can run"
          href={SETTINGS[view.setupSection].href}
          className="font-medium text-warning underline underline-offset-2"
        >
          Go to {SETTINGS[view.setupSection].label}
        </Link>
      </>,
    );
  }
  if (view.limitReached)
    return note(
      `The agent has run ${view.runsPerDay} times in the past 24 hours, as many as it may. It runs again once a day has passed since the first.`,
    );
  return null;
}

/** A tile: its name with a note beside it ("Last run · Sat 21 Nov, 1:00 PM"), and a control at the right end if it has one. */
function Stat({
  label,
  note,
  aside,
  children,
}: {
  label: string;
  note?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    // The name on the first line with its note and control beside it, what it counts under them.
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-1.5 gap-y-1.5 rounded-card bg-surface px-4 py-2.5 text-sm">
      <dt className="text-label font-medium text-muted">{label}</dt>
      <dd className="contents">
        <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-label text-muted">
          <span>{note && <>· {note}</>}</span>
          {aside && <span className="overflow-x-auto">{aside}</span>}
        </span>
        <span className="col-span-2 block">{children}</span>
      </dd>
    </div>
  );
}

/** A count as the tiles show it: big and bold, with what it counts beside it. */
function Big({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[28px] leading-none font-bold tracking-tight tabular-nums">
        {value}
      </span>
      <span className="text-meta text-muted">{label}</span>
    </span>
  );
}

const capsule =
  "rounded-full px-2 py-[2px] text-xs font-medium whitespace-nowrap";

/** When it was posted, when the agent found it, and when applications close, as on the Job application log. */
function FoundDates({ candidate }: { candidate: AgentCandidateView }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <span className={`${capsule} bg-success-surface text-success`}>
        {candidate.postedOn
          ? `Posted ${candidate.postedOn}`
          : "Posted date not given"}
      </span>
      <span className={`${capsule} bg-selected text-primary-text`}>
        Last updated {candidate.foundOn}
      </span>
      {candidate.deadline && (
        <span className={`${capsule} bg-danger-surface text-danger`}>
          Apply by {candidate.deadline}
        </span>
      )}
    </span>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-card border border-line-card bg-card px-5 py-4 text-sm text-muted">
      {children}
    </p>
  );
}

export function OpenPosting({ url }: { url: string }) {
  if (!url) return null;
  return (
    <a title="Open the original job posting in a new tab"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClassName("secondary", "sm")}
    >
      Open posting <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** A posting the agent found: what it is, its score and why. The actions go below. */
/**
 * A posting the agent found: its facts, score and why, its text, and what to
 * do with it. The title opens it: its draft when there is one, else its own
 * page with the whole posting, where nothing is written until asked. `full`
 * is that page: the title isn't a link there and the text isn't cut short.
 */
export function CandidateCard({
  candidate,
  minScore,
  full = false,
  children,
}: {
  candidate: AgentCandidateView;
  minScore?: number;
  full?: boolean;
  children: ReactNode;
}) {
  const opens = candidate.applicationId
    ? `/applications/${candidate.applicationId}`
    : `/agent/posting/${candidate.id}`;
  return (
    <Card padding="none" className="flex flex-col gap-3.5 px-6 py-5">
      {/* The title and the actions on one line (a long title ends in "…"; the actions go under it when there's no room), the job's details under them. */}
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {full ? (
            <h1
              title={candidate.title}
              className="min-w-0 flex-[1_1_240px] truncate font-serif text-[26px] leading-tight"
            >
              {candidate.title}
            </h1>
          ) : (
            <h3
              title={candidate.title}
              className="min-w-0 flex-[1_1_240px] truncate font-serif text-[20px] leading-tight"
            >
              <Link title="Open this job: its draft if there is one, otherwise the full posting"
                href={opens}
                className="text-ink underline-offset-4 hover:text-ink hover:underline"
              >
                {candidate.title}
              </Link>
            </h3>
          )}
          {/* The actions, there without scrolling: all one height, the score centered on them. */}
          <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-2.5">
            {/* Save for later comes first, before Review opportunity and the rest. */}
            <AgentSaveButton
              candidateId={candidate.id}
              saved={candidate.saved ?? false}
            />
            <div className="contents [&>a]:h-8 [&>a]:min-h-8 [&>a]:items-center [&>button]:h-8 [&>button]:min-h-8">
              {children}
            </div>
            <ScoreExplainer
              score={candidate.score}
              title={[candidate.title, candidate.company]
                .filter(Boolean)
                .join(" at ")}
              reasons={candidate.reasons}
              redFlags={candidate.redFlags}
              breakdown={candidate.breakdown}
              minScore={minScore}
            />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          {candidate.company && (
            <p className="text-sm text-ink">{candidate.company}</p>
          )}
          <WorkModeBadge posting={candidate} className="my-1" />
          {candidate.facts && (
            <p className="text-meta text-muted">{candidate.facts}</p>
          )}
          {candidate.origin && (
            <p className="text-xs text-muted">{candidate.origin}</p>
          )}
          <span className="mt-1.5">
            <FoundDates candidate={candidate} />
          </span>
          {candidate.fresh && <Fresh label={candidate.fresh} />}
          <span className="mt-1.5">
            <HowToApply url={candidate.url} links={candidate.applyLinks} />
          </span>
          {candidate.traps && candidate.traps.length > 0 && (
            <TrapWarning traps={candidate.traps} />
          )}
          {candidate.sourceCheck === "found" && (
            <p className="text-xs font-medium text-success">
              ✓ Found on the company&apos;s site: its own description and apply
              page
            </p>
          )}
          {candidate.sourceCheck === "not found" && (
            <p className="text-xs text-muted">
              Not found on the company&apos;s site: the description is the job
              board&apos;s
            </p>
          )}
          {candidate.foundBy && (
            <p className="text-xs text-muted">Found by “{candidate.foundBy}”</p>
          )}
          {/* As the source's terms ask (E14-2); the origin names the others. */}
          {linksAttribution(candidate.source) && (
            <SourceAttribution
              source={candidate.source}
              url={candidate.url}
              className="mt-1.5 self-start"
            />
          )}
        </div>
      </div>
      {candidate.duplicate && <DuplicateNote match={candidate.duplicate} />}
      <FitSummary reasons={candidate.reasons} />
      {candidate.redFlags.length > 0 && (
        <div className="rounded-card bg-warning-surface px-3.5 py-2.5 text-meta text-warning">
          <p className="font-medium">Worth knowing</p>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
            {candidate.redFlags.map((flag, index) => (
              <li key={index}>{flag}</li>
            ))}
          </ul>
        </div>
      )}
      {candidate.description.trim() && (
        <div
          className={cn(
            "border-t border-line pt-3.5 text-sm leading-[1.65] whitespace-pre-wrap text-document",
            full ? "max-w-[78ch]" : "max-h-[420px] overflow-y-auto",
          )}
        >
          {candidate.description}
        </div>
      )}
      {looksCutShort(candidate.description) &&
        !candidate.error?.startsWith("Not drafted:") && (
          <p role="alert" className="text-meta font-medium text-error">
            {shortPostingWarning(candidate.description)}
          </p>
        )}
      {candidate.error && (
        <p role="alert" className="text-meta text-error">
          {candidate.error}
        </p>
      )}
    </Card>
  );
}

/** A scored posting: Prepare draft (following the job while it writes), Open posting, Archive. */
export function ScoredCard({
  candidate,
  onArchive,
  minScore,
  full = false,
  waiting = false,
}: {
  candidate: AgentCandidateView;
  onArchive: () => void;
  minScore?: number;
  full?: boolean;
  /** At the draft score, its draft not written yet: says so. */
  waiting?: boolean;
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState(candidate.draftJobId);
  const [starting, startTransition] = useTransition();
  const job = useJob<DraftResult>(jobId, 0, (update) => {
    if (update.status === "DONE") {
      setJobId(null);
      toast("The draft is ready for your review.");
      router.refresh();
    } else if (update.status === "FAILED") {
      setJobId(null);
      toast(update.error ?? "The draft couldn't be prepared.");
      router.refresh();
    }
  });
  const preparing = starting || Boolean(jobId);

  const prepare = () =>
    startTransition(async () => {
      const result = toastResult(
        await prepareAgentDraft({ candidateId: candidate.id }),
      );
      if (!result.ok) return;
      if (result.data.applicationId) router.refresh();
      else setJobId(result.data.jobId);
    });

  return (
    <CandidateCard candidate={candidate} minScore={minScore} full={full}>
      {waiting && !preparing && <WaitingForDraft />}
      <Button title="Write a tailored resume for this job now (about a minute)"
        size="sm"
        aria-disabled={preparing || undefined}
        onClick={() => !preparing && prepare()}
      >
        {preparing ? "Preparing draft…" : "Prepare draft"}
      </Button>
      <OpenPosting url={candidate.sourceUrl ?? candidate.url} />
      {!candidate.sourceCheck && !preparing && (
        <LookOnCompanySite candidateId={candidate.id} />
      )}
      <ArchiveButton onClick={onArchive} />
      {preparing && job?.step && (
        <span role="status" className="text-meta text-muted">
          {job.step}
        </span>
      )}
    </CandidateCard>
  );
}

/**
 * Look on company website: finds the posting on the company's own site, for
 * its own description and the page to apply on, following the job until
 * it's done.
 */
function LookOnCompanySite({ candidateId }: { candidateId: string }) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, startTransition] = useTransition();
  useJob<SourceResult>(jobId, 0, (update) => {
    if (update.status === "DONE") {
      setJobId(null);
      const result = update.result;
      toast(
        !result?.found
          ? "Not found on the company's site. The job board's description stays."
          : result.score !== null
            ? `Found on the company's site, and scored ${result.score} from its own description.`
            : "Found on the company's site: its description and apply page are on the card.",
      );
      router.refresh();
    } else if (update.status === "FAILED") {
      setJobId(null);
      toast(update.error ?? "Couldn't look on the company's site just now.");
    }
  });
  const looking = starting || Boolean(jobId);
  return (
    <Button title="Look for this job on the employer's own site, for its own description and apply page"
      size="sm"
      variant="secondary"
      aria-disabled={looking || undefined}
      onClick={() =>
        !looking &&
        startTransition(async () => {
          const result = toastResult(await lookOnCompanySite({ candidateId }));
          if (result.ok) setJobId(result.data.jobId);
        })
      }
    >
      {looking ? "Looking on company website…" : "Look on company website"}
    </Button>
  );
}

/** On a posting at the draft score whose draft isn't written yet: the next run writes it, or Prepare draft now. */
function WaitingForDraft() {
  return (
    <span
      className="self-start rounded-full bg-warning-surface px-2.5 py-0.5 text-meta font-medium text-warning"
      title="The next run writes its draft, or click Prepare draft to write it now."
    >
      Waiting for a draft
    </span>
  );
}

/** On a posting put back from the Archive, so it can be told apart. */
export function WasArchived() {
  return (
    <span className="w-fit rounded-chip bg-warning-surface px-1.5 py-0.5 text-[11px] font-medium text-warning">
      Was archived
    </span>
  );
}

/** How new a freshly posted job is: "Posted 3 hours ago", "Posted today". */
export function Fresh({ label }: { label: string }) {
  return (
    <span className="w-fit rounded-chip bg-success-surface px-1.5 py-0.5 text-[11px] font-medium text-success">
      {label}
    </span>
  );
}

/** Save for later on an agent's job: lights up at once, and the sidebar's count follows. */
function AgentSaveButton({
  candidateId,
  saved,
}: {
  candidateId: string;
  saved: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(saved);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    setOn(!on);
    const result = toastResult(
      await saveAgentPosting({ candidateId, saved: !on }),
    );
    setBusy(false);
    if (!result.ok) return setOn(on);
    router.refresh();
  };
  return (
    <SaveForLaterButton saved={on} busy={busy} onToggle={() => void toggle()} />
  );
}
