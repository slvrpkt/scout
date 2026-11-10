"use client";

import { ScoreNow } from "./score-now";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { DuplicateBadge, DuplicateNote } from "@/components/duplicate-note";
import { PageHeader } from "@/components/page-header";
import { ScoreBadge } from "@/components/score-badge";
import { ScoreExplainer } from "@/components/score-explainer";
import { HowToApply } from "@/components/how-to-apply";
import { linksAttribution, SourceAttribution } from "@/components/source-attribution";
import { toast, toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useJob } from "@/hooks/use-job";
import type { AgentCandidateView, AgentView } from "@/lib/agent/view";
import { cn } from "@/lib/cn";

import { dismissAgentCandidate, prepareAgentDraft, restoreAgentCandidate, runAgentNow } from "./actions";

type ScanResult = { message: string };
type DraftResult = { applicationId: string };

const SETTINGS: Record<NonNullable<AgentView["setupSection"]>, { href: string; label: string }> = {
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

export function AgentScreen({ view, initialSelected = null }: { view: AgentView; initialSelected?: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [runJobId, setRunJobId] = useState(view.runJobId);
  const [filter, setFilter] = useState<"all" | "drafts" | "scored" | "below">("all");
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState("");
  const [where, setWhere] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [postedWithin, setPostedWithin] = useState<"any" | "1" | "3" | "7" | "30">("any");
  // 50 at a time.
  const [shown, setShown] = useState(LIST_PAGE);
  // When the page opened, for "Posted in the past week".
  const [openedAt] = useState(() => Date.now());
  const [selectedId, setSelectedId] = useState<string | null>(initialSelected);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const run = useJob<ScanResult>(runJobId, 0, (job) => {
    if (job.status !== "DONE" && job.status !== "FAILED") return;
    setRunJobId(null);
    toast(job.status === "DONE" ? (job.result?.message ?? "The run is done.") : (job.error ?? "The run didn't finish."));
    router.refresh();
  });
  const running = Boolean(runJobId) && (!run || run.status === "QUEUED" || run.status === "RUNNING");

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
        toast("Archived in your Job application log, with its resume and cover letter.", {
          action: { label: "Open", onClick: () => router.push(`/applications/${applicationId}`) },
        });
      } else {
        toast("Archived. It won't come back; find it in the Archive.", { action: { label: "Undo", onClick: () => putBack(candidate.id) } });
      }
      router.refresh();
    });

  const drafts = view.drafts.filter((candidate) => !hidden.has(candidate.id));
  const scored = view.scored.filter((candidate) => !hidden.has(candidate.id));
  const below = view.belowMinimum.filter((candidate) => !hidden.has(candidate.id));
  const empty = drafts.length === 0 && scored.length === 0;

  const lists = { all: [...drafts, ...scored, ...below], drafts, scored, below } as const;
  // The companies and places in what it found, with how many jobs each, for the Company and Location filters.
  const everything = lists.all;
  const companies = countsOf(everything.map((candidate) => candidate.company.trim()).filter(Boolean));
  const places = placeChoices(everything);
  const draftIds = new Set(drafts.map((candidate) => candidate.id));
  // The same filters as Manual job search, over what the agent found: what, where, remote only, and how recent.
  const within = (iso: string | null) => postedWithin === "any" || (iso !== null && Date.parse(iso) >= openedAt - Number(postedWithin) * 86_400_000);
  const matches = (text: string, needle: string) => !needle.trim() || text.toLowerCase().includes(needle.trim().toLowerCase());
  const list = lists[filter].filter(
    (candidate) =>
      matches(`${candidate.title} ${candidate.company} ${candidate.description}`, query) &&
      (!company || candidate.company.trim() === company) &&
      atPlace(candidate, where) &&
      (!remoteOnly || candidate.remote === true) &&
      within(candidate.postedAt),
  );
  const selected = list.find((candidate) => candidate.id === selectedId) ?? list[0] ?? null;

  return (
    // A light green tint sets the agent's page apart from Manual job search.
    <div className="flex min-h-full flex-col bg-agent-tint">
      <PageHeader
        title="Agentic job search"
        description="At the times you choose, it runs each of your saved searches for new postings, scores them against your profile, and keeps the best here for you. Drafts wait for your review, and nothing is ever sent."
        actions={
          <Button aria-disabled={running || pending || undefined} onClick={() => !running && !pending && runNow()}>
            {running ? "Running…" : "Run now"}
          </Button>
        }
      />
      <div className="flex flex-col gap-5 px-10 pb-20">
        <Notices view={view} />
        {view.waiting > 0 && <ScoreNow waiting={view.waiting} />}

        {/* The agent at a glance: the runs in one row, the searches three across. */}
        <Card padding="none" className="flex flex-col gap-4 px-6 py-5">
          <dl className="grid gap-3 sm:grid-cols-3">
            <Stat label="Last run">
              {view.lastRun ? (
                <>
                  {view.lastRun.at}
                  {view.lastRun.message && <span className="block text-meta text-muted">{view.lastRun.message}</span>}
                </>
              ) : (
                "Not yet"
              )}
            </Stat>
            <Stat label="Next run">{view.nextRun ?? "Off"}</Stat>
            <Stat label="Today">
              {view.budget.scored} of {view.budget.scoreLimit} scored
              {view.autoDraft && ` · ${view.budget.drafted} of ${view.budget.draftLimit} drafts`}
            </Stat>
          </dl>
          <div className="flex flex-col gap-2">
            <p className="text-label text-muted">{view.searches.length === 1 ? "Searches for" : `Searches (${view.searches.length})`}</p>
            {view.searches.length === 0 ? (
              <p className="text-sm text-muted">Nothing yet</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {view.searches.map((search) => (
                  <li key={search.id} className={cn("rounded-card border border-line-card bg-surface px-3.5 py-2 text-sm", !search.enabled && "text-muted")}>
                    {search.line}
                    {!search.enabled && " · off"}
                    {search.lastMessage && <span className="block text-meta text-muted">Last run: {search.lastMessage}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {running && (
            <p role="status" className="border-t border-line pt-3.5 text-sm text-muted">
              {run?.step ?? "Starting the run…"}
            </p>
          )}
        </Card>

        {/* What it found, as on Manual job search: a list to pick from, and the one picked beside it. */}
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
            {(
              [
                ["all", "All", drafts.length + scored.length + below.length],
                ["drafts", "Drafts to review", drafts.length],
                ["scored", "Scored postings", scored.length],
                ["below", `Below ${view.minScore}`, below.length],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => {
                  setFilter(value);
                  setShown(LIST_PAGE);
                }}
                className={cn(
                  "flex items-baseline gap-1.5 rounded-control border px-3 py-2 text-control",
                  filter === value ? "border-primary bg-selected font-medium text-primary-text" : "border-line-field bg-card hover:border-line-strong hover:bg-hover",
                )}
              >
                {label} <span className="text-xs opacity-65">{count}</span>
              </button>
            ))}
          </div>
        </div>
        <Card padding="none" className="flex flex-wrap items-end gap-4 px-6 py-4">
          <label className="flex min-w-[220px] flex-[2_1_260px] flex-col gap-1.5 text-label text-muted">
            What
            <input
              type="search"
              aria-label="Search what it found"
              placeholder="Title, company or anything in the posting"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="rounded-control border border-line-input bg-input px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:border-primary"
            />
          </label>
          <label className="flex min-w-[180px] flex-[1_1_200px] flex-col gap-1.5 text-label text-muted">
            Company
            <select
              value={company}
              onChange={(event) => setCompany(event.target.value)}
              className="rounded-control border border-line-input bg-input px-3 py-2 text-sm text-ink focus-visible:border-primary"
            >
              <option value="">Any company</option>
              {companies.map(([name, count]) => (
                <option key={name} value={name}>
                  {name} ({count})
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[180px] flex-[1_1_200px] flex-col gap-1.5 text-label text-muted">
            Location
            <select
              value={where}
              onChange={(event) => setWhere(event.target.value)}
              className="rounded-control border border-line-input bg-input px-3 py-2 text-sm text-ink focus-visible:border-primary"
            >
              <option value="">Anywhere</option>
              {places.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label} ({choice.count})
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[150px] flex-col gap-1.5 text-label text-muted">
            Posted
            <select
              value={postedWithin}
              onChange={(event) => setPostedWithin(event.target.value as typeof postedWithin)}
              className="rounded-control border border-line-input bg-input px-3 py-2 text-sm text-ink focus-visible:border-primary"
            >
              <option value="any">Any time</option>
              <option value="1">Past 24 hours</option>
              <option value="3">Past 3 days</option>
              <option value="7">Past week</option>
              <option value="30">Past month</option>
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={remoteOnly} onChange={(event) => setRemoteOnly(event.target.checked)} className="size-4 accent-[var(--color-primary)]" />
            Remote only
          </label>
          <p className="basis-full text-meta text-muted">
            Country and distance are set on each saved search in Settings → Job agent. Postings you archive, or the agent skips, are in the <Link href="/archive">Archive</Link>.
          </p>
        </Card>

        {list.length === 0 ? (
          <Empty>
            {filter === "all"
              ? empty
                ? "Nothing waiting yet. A run puts the postings that fit you best here."
                : "Nothing matches these filters."
              : filter === "drafts"
              ? view.autoDraft
                ? "No drafts yet. After a run, the best new postings get a draft here."
                : "No drafts yet. Prepare one from a scored posting, or let the agent prepare them in Settings → Job agent."
              : filter === "scored"
                ? empty
                  ? "Nothing waiting yet. A run puts the postings that fit you best here."
                  : "No postings waiting for a draft."
                : filter === "below"
                  ? `Nothing below your minimum score of ${view.minScore}.`
                  : "Nothing here."}
          </Empty>
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
            <ul aria-label="What it found" className="flex flex-col gap-2 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
              {list.slice(0, shown).map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    aria-pressed={selected?.id === candidate.id}
                    onClick={() => setSelectedId(candidate.id)}
                    className={cn(
                      "flex w-full items-start justify-between gap-3 rounded-card border bg-card px-4 py-3 text-left hover:border-line-strong",
                      selected?.id === candidate.id ? "border-ink shadow-control" : "border-line-card",
                    )}
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-field font-medium text-ink">{candidate.title}</span>
                      <span className="text-meta text-muted">{[candidate.company, candidate.facts].filter(Boolean).join(" · ")}</span>
                      <FoundDates candidate={candidate} />
                      {candidate.fresh && <Fresh label={candidate.fresh} />}
                      {candidate.wasArchived && <WasArchived />}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1.5">
                      <ScoreBadge score={candidate.score} size="sm" />
                      {candidate.duplicate && <DuplicateBadge match={candidate.duplicate} />}
                    </span>
                  </button>
                </li>
              ))}
              {list.length > shown && (
                <li>
                  <Button variant="secondary" size="sm" className="w-full" onClick={() => setShown((count) => count + LIST_PAGE)}>
                    Show more ({list.length - shown} more)
                  </Button>
                </li>
              )}
            </ul>
            {selected && (
              <div key={selected.id} className="min-w-0">
                {draftIds.has(selected.id) ? (
                  <CandidateCard candidate={selected} minScore={view.minScore}>
                    <Link href={`/applications/${selected.applicationId}`} className={buttonClassName("primary", "sm", "hover:text-on-primary")}>
                      Review Opportunity
                    </Link>
                    <OpenPosting url={selected.url} />
                    <ArchiveButton onClick={() => archive(selected)} />
                  </CandidateCard>
                ) : (
                  <ScoredCard candidate={selected} minScore={view.minScore} onArchive={() => archive(selected)} />
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
export function ArchiveButton({ onClick, size = "sm" }: { onClick: () => void; size?: "sm" | "md" }) {
  return (
    <Button variant="danger-outline" size={size} onClick={onClick}>
      Archive
    </Button>
  );
}

/** Why the agent isn't running, and where to fix it. */
function Notices({ view }: { view: AgentView }) {
  const note = (children: ReactNode) => (
    <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
      {children}
    </p>
  );
  if (!view.enabled) {
    return note(
      <>
        The job agent is off.{" "}
        <Link href={SETTINGS.agent.href} className="font-medium text-warning underline underline-offset-2">
          Turn it on in Settings → Job agent
        </Link>
        {view.drafts.length + view.scored.length > 0 && ". What it found before is still here."}
      </>,
    );
  }
  if (view.setupProblem && view.setupSection) {
    return note(
      <>
        {view.setupProblem.replace(/ in Settings → [^.]+ first\.$/, ".")}{" "}
        <Link href={SETTINGS[view.setupSection].href} className="font-medium text-warning underline underline-offset-2">
          Go to {SETTINGS[view.setupSection].label}
        </Link>
      </>,
    );
  }
  if (view.limitReached) return note(`The agent has run ${view.runsPerDay} times in the past 24 hours, as many as it may. It runs again once a day has passed since the first.`);
  return null;
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-card bg-surface px-4 py-3 text-sm">
      <dt className="text-label text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}


const capsule = "rounded-full px-2 py-[2px] text-xs font-medium whitespace-nowrap";

/** When it was posted, when the agent found it, and when applications close, as on the Job application log. */
function FoundDates({ candidate }: { candidate: AgentCandidateView }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <span className={`${capsule} bg-success-surface text-success`}>{candidate.postedOn ? `Posted ${candidate.postedOn}` : "Posted date not given"}</span>
      <span className={`${capsule} bg-selected text-primary-text`}>Last updated {candidate.foundOn}</span>
      {candidate.deadline && <span className={`${capsule} bg-danger-surface text-danger`}>Apply by {candidate.deadline}</span>}
    </span>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-card border border-line-card bg-card px-5 py-4 text-sm text-muted">{children}</p>;
}

export function OpenPosting({ url }: { url: string }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={buttonClassName("secondary", "sm")}>
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
export function CandidateCard({ candidate, minScore, full = false, children }: { candidate: AgentCandidateView; minScore?: number; full?: boolean; children: ReactNode }) {
  const opens = candidate.applicationId ? `/applications/${candidate.applicationId}` : `/agent/posting/${candidate.id}`;
  return (
    <Card padding="none" className="flex flex-col gap-3.5 px-6 py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          {full ? (
            <h1 className="font-serif text-[26px] leading-tight text-pretty">{candidate.title}</h1>
          ) : (
            <h3 className="font-serif text-[20px] leading-tight text-pretty">
              <Link href={opens} className="text-ink underline-offset-4 hover:text-ink hover:underline">
                {candidate.title}
              </Link>
            </h3>
          )}
          {candidate.company && <p className="text-sm text-ink">{candidate.company}</p>}
          {candidate.facts && <p className="text-meta text-muted">{candidate.facts}</p>}
          {candidate.origin && <p className="text-xs text-muted">{candidate.origin}</p>}
          <span className="mt-1.5">
            <FoundDates candidate={candidate} />
          </span>
          {candidate.fresh && <Fresh label={candidate.fresh} />}
          <span className="mt-1.5">
            <HowToApply url={candidate.url} />
          </span>
          {candidate.foundBy && <p className="text-xs text-muted">Found by “{candidate.foundBy}”</p>}
          {/* As the source's terms ask (E14-2); the origin names the others. */}
          {linksAttribution(candidate.source) && <SourceAttribution source={candidate.source} url={candidate.url} className="mt-1.5 self-start" />}
        </div>
        <ScoreExplainer
          score={candidate.score}
          title={[candidate.title, candidate.company].filter(Boolean).join(" at ")}
          reasons={candidate.reasons}
          redFlags={candidate.redFlags}
          breakdown={candidate.breakdown}
          minScore={minScore}
        />
      </div>
      {candidate.duplicate && <DuplicateNote match={candidate.duplicate} />}
      {candidate.reasons.length > 0 && (
        <ul aria-label="Why it fits" className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
          {candidate.reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      )}
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
      {candidate.error && (
        <p role="alert" className="text-meta text-error">
          {candidate.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-3.5">{children}</div>
    </Card>
  );
}

/** A scored posting: Prepare draft (following the job while it writes), Open posting, Archive. */
export function ScoredCard({ candidate, onArchive, minScore, full = false }: { candidate: AgentCandidateView; onArchive: () => void; minScore?: number; full?: boolean }) {
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
      const result = toastResult(await prepareAgentDraft({ candidateId: candidate.id }));
      if (!result.ok) return;
      if (result.data.applicationId) router.refresh();
      else setJobId(result.data.jobId);
    });

  return (
    <CandidateCard candidate={candidate} minScore={minScore} full={full}>
      <Button size="sm" aria-disabled={preparing || undefined} onClick={() => !preparing && prepare()}>
        {preparing ? "Preparing draft…" : "Prepare draft"}
      </Button>
      <OpenPosting url={candidate.url} />
      <ArchiveButton onClick={onArchive} />
      {preparing && job?.step && (
        <span role="status" className="text-meta text-muted">
          {job.step}
        </span>
      )}
    </CandidateCard>
  );
}

/** On a posting put back from the Archive, so it can be told apart. */
export function WasArchived() {
  return <span className="w-fit rounded-chip bg-warning-surface px-1.5 py-0.5 text-[11px] font-medium text-warning">Was archived</span>;
}

/** How new a freshly posted job is: "Posted 3 hours ago", "Posted today". */
export function Fresh({ label }: { label: string }) {
  return <span className="w-fit rounded-chip bg-success-surface px-1.5 py-0.5 text-[11px] font-medium text-success">{label}</span>;
}

/** Each name and how many times it comes up, the most first, then by name. */
function countsOf(names: readonly string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** "Reston, VA, US" → its state ("VA") and its city ("Reston, VA"); remote jobs as Remote. */
function placeParts(candidate: { place: string; remote: boolean | null }): { state: string | null; city: string | null; remote: boolean } {
  const parts = candidate.place.split(",").map((part) => part.trim()).filter(Boolean);
  // The country at the end, when there is one, isn't a state.
  if (parts.length >= 3) parts.pop();
  const state = parts.length >= 2 ? parts[parts.length - 1] : null;
  const city = parts.length >= 2 ? `${parts[0]}, ${state}` : parts[0] ?? null;
  return { state, city, remote: candidate.remote === true };
}

/** The Location filter's choices: Remote, each state, then each city, with how many jobs each. */
function placeChoices(candidates: readonly { place: string; remote: boolean | null }[]): { value: string; label: string; count: number }[] {
  const all = candidates.map(placeParts);
  const remote = all.filter((place) => place.remote).length;
  const states = countsOf(all.flatMap((place) => (place.state ? [place.state] : [])));
  const cities = countsOf(all.flatMap((place) => (place.city ? [place.city] : [])));
  return [
    ...(remote > 0 ? [{ value: "remote", label: "Remote", count: remote }] : []),
    ...states.map(([state, count]) => ({ value: `state:${state}`, label: `All of ${state}`, count })),
    ...cities.map(([city, count]) => ({ value: `city:${city}`, label: city, count })),
  ];
}

/** Whether a job is at the place chosen in the Location filter. */
function atPlace(candidate: { place: string; remote: boolean | null }, where: string): boolean {
  if (!where) return true;
  const place = placeParts(candidate);
  if (where === "remote") return place.remote;
  if (where.startsWith("state:")) return place.state === where.slice("state:".length);
  if (where.startsWith("city:")) return place.city === where.slice("city:".length);
  return true;
}
