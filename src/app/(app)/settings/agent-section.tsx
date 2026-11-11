"use client";

import Link from "next/link";
import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SlideSwitch } from "@/components/ui/slide-switch";
import { Toggle } from "@/components/ui/toggle";
import { twelveHour } from "@/lib/dates";
import type { Country } from "@/lib/job-search/countries";
import type { JobSource, SearchQuery } from "@/lib/job-search/search";
import type { Scorer } from "@/lib/scoring/scorers";
import { AGENT_DAILY_DRAFTS, MAX_AGENT_TIMES, sortedTimes } from "@/lib/settings";

import { saveAgentSettings } from "../agent/actions";
import { AgentSearches, type AgentSearchSetting, type HomeCountry } from "./agent-searches";
import { TitleSkips } from "./skip-rules";
import { SETTINGS_SECTIONS, settingsSectionHref, type SettingsSectionId } from "./sections";
import { SettingsSectionIntro } from "./settings-screen";

export type AgentSettings = {
  enabled: boolean;
  /** "HH:MM", earliest first. */
  times: string[];
  minScore: number;
  /** Postings scored, and drafts prepared, a day across all runs. */
  dailyScores: number;
  dailyDrafts: number;
  autoDraft: boolean;
  /** How many of the day's scores, and drafts, each run time gets, in time order. */
  scoreShares: number[];
  draftShares: number[];
  /** A posting needs this score for a draft. */
  draftScore: number;
  /** Stop for the day once this many reached the minimum score. */
  dailyGoal: number;
  /** Words that rule a job out by its title. */
  titleSkip: string[];
};

/** Every quarter hour, as the schedule checks. */
const QUARTER_HOURS = Array.from({ length: 96 }, (_, index) => `${String(Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}`);
const MIN_SCORES = [50, 55, 60, 65, 70, 75, 80, 85, 90];
const SCORE_BUDGETS = [25, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000];
const DRAFT_BUDGETS = [0, 5, 10, 15, 20, 30, 40, 50, 75, 100];
const DAILY_GOALS = [25, 50, 75, 100, 150, 200, 300, 400];
const SHARE_STEPS = [0, 5, 8, 10, 15, 20, 22, 25, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500];
/** The choices, with the saved value among them even when it isn't one. */
const withValue = (choices: readonly number[], value: number) => [...new Set([...choices, value])].sort((a, b) => a - b);
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
/** "04:00, 08:00 and 13:00" */
const timesInWords = (stored: readonly string[]) => {
  const times = stored.map(twelveHour);
  return times.length === 1 ? times[0] : `${times.slice(0, -1).join(", ")} and ${times[times.length - 1]}`;
};

/**
 * Settings → Job agent (E16-7): whether it runs, the searches it runs,
 * when, and how much a run may do. Each change saves at once; a search
 * once typing pauses.
 */
export function AgentSection({
  initial,
  searches,
  maxSearches,
  maxPages,
  startFrom,
  source,
  scoring,
  countries,
  homeCountry,
  timeZone,
}: {
  initial: AgentSettings;
  searches: AgentSearchSetting[];
  maxSearches: number;
  maxPages: number;
  /** What a first search starts from: the last one in Find jobs. */
  startFrom: SearchQuery;
  /** The source in Settings → Job search; null while job search is off. */
  source: JobSource | null;
  /** What scores the postings (Settings → Scoring), and whether it's set up. */
  scoring: { scorer: Scorer; ready: boolean };
  countries: readonly Country[];
  /** The country company searches cover (Profile → Basics, else the US). */
  homeCountry?: HomeCountry;
  /** The user's time zone, which the hour is in. */
  timeZone: string;
}) {
  const track = useTrackSave();
  const [settings, setSettings] = useState(initial);
  // The master switch asks first, either way: what it would become, until answered.
  const [asking, setAsking] = useState<boolean | null>(null);

  const change = (next: Partial<AgentSettings>) => {
    const previous = settings;
    setSettings({ ...settings, ...next });
    void track(saveAgentSettings(next)).then((result) => {
      if (!toastResult(result).ok) setSettings(previous);
    });
  };
  // Turning it on needs a complete search that's on; the server says so if there's none.
  const turnOn = (on: boolean) => change({ enabled: on });

  return (
    <>
      <SettingsSectionIntro title="Job agent">
        At the times you choose, it runs each of your saved searches, scores the new postings against your profile, and keeps the best on the Agent screen. It never sends or applies.
      </SettingsSectionIntro>

      {source === "ARBEITSAGENTUR" ? (
        // It searches on its own, which the BA's terms forbid most clearly (#223).
        <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
          The agent doesn&apos;t search the Bundesagentur für Arbeit. Choose JSearch, Adzuna or FreeHire in{" "}
          <Link href="/settings?section=jobs" className="font-medium text-warning underline underline-offset-2">
            Settings → Job search
          </Link>{" "}
          for it.
        </p>
      ) : !source ? (
        <SetupNote before="The agent searches the source you choose in " section="jobs" after=", which is off. Choose one first." />
      ) : scoring.ready ? null : scoring.scorer === "JEV" ? (
        <SetupNote before="The agent scores postings with Jev, which needs your TypeSafe key in " section="scoring" after="." />
      ) : (
        <SetupNote before="The agent scores postings with the AI provider in " section="ai" after=", which isn't set up yet. Choose one first." />
      )}

      <Card padding="none" className="px-7 py-4">
        <SlideSwitch
          label="Run the job agent"
          description={
            settings.enabled
              ? `On. It runs at ${timesInWords(settings.times)} your time (${timeZone}), and you can run it now and then on the Agent screen.`
              : "Off. Nothing is searched or scored until it's on."
          }
          checked={settings.enabled}
          onCheckedChange={setAsking}
        />
      </Card>
      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
        title={asking ? "Turn on the job agent?" : "Turn off the job agent?"}
        description={
          asking
            ? "Are you sure you want to do this? It will search and score new postings at the times you chose, which uses your search and AI budgets."
            : "Are you sure you want to do this? Nothing will be searched or scored until you turn it back on."
        }
        confirmLabel={asking ? "Turn on" : "Turn off"}
        onConfirm={() => {
          if (asking !== null) turnOn(asking);
          setAsking(null);
        }}
      />

      <AgentSearches initial={searches} max={maxSearches} maxPages={maxPages} startFrom={startFrom} source={source} countries={countries} homeCountry={homeCountry} />

      <section aria-labelledby="agent-all-searches" className="flex flex-col gap-4 rounded-panel border-2 border-line-strong bg-canvas p-5">
        <div className="flex flex-col gap-1">
          <h3 id="agent-all-searches" className="font-serif text-section">
            Applies to all searches
          </h3>
          <p className="text-meta text-muted">These settings cover every card under What it looks for, not one search.</p>
        </div>

        <RunTimes settings={settings} timeZone={timeZone} onChange={change} />

        <Card padding="none" className="grid gap-x-[18px] gap-y-5 px-7 py-[26px] sm:grid-cols-2">
        <Select
          label="Minimum score"
          hint="Postings scored lower stay out of the queue."
          value={String(settings.minScore)}
          onChange={(event) => change({ minScore: Number(event.target.value) })}
        >
          {[...new Set([...MIN_SCORES, settings.minScore])].sort((a, b) => a - b).map((score) => (
            <option key={score} value={score}>
              {score} of 100
            </option>
          ))}
        </Select>
        <Select
          label="Postings scored a day"
          hint="Across all runs. A run stops scoring when it's used up."
          value={String(settings.dailyScores)}
          onChange={(event) => change({ dailyScores: Number(event.target.value) })}
        >
          {withValue(SCORE_BUDGETS, settings.dailyScores).map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </Select>
        <Select
          label="Stop for the day at"
          hint="Jobs that reached the minimum score. Once there are this many, the rest of the day's runs don't search or score."
          value={String(settings.dailyGoal)}
          onChange={(event) => change({ dailyGoal: Number(event.target.value) })}
        >
          {withValue(DAILY_GOALS, settings.dailyGoal).map((count) => (
            <option key={count} value={count}>
              {count} qualifying jobs
            </option>
          ))}
        </Select>
        <Select
          label="Draft from a score of"
          hint={settings.autoDraft ? "Lower scores only show their score. Scores can differ by a few points from one try to the next." : "Turn on Prepare drafts on its own first"}
          value={String(settings.draftScore)}
          disabled={!settings.autoDraft}
          onChange={(event) => change({ draftScore: Number(event.target.value) })}
        >
          {[...new Set([...MIN_SCORES, settings.draftScore])].sort((a, b) => a - b).map((score) => (
            <option key={score} value={score}>
              {score} of 100
            </option>
          ))}
        </Select>
        <Select
          label="Drafts a day, at most"
          value={String(settings.dailyDrafts)}
          disabled={!settings.autoDraft}
          hint={settings.autoDraft ? "Across all runs, best scores first." : "Turn on Prepare drafts on its own first"}
          onChange={(event) => change({ dailyDrafts: Number(event.target.value) })}
        >
          {withValue(DRAFT_BUDGETS, settings.dailyDrafts).map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </Select>
        <Toggle
          className="sm:col-span-2"
          label="Prepare drafts on its own"
          description={
            settings.autoDraft
              ? `For the best postings of the day, up to ${plural(settings.dailyDrafts, "draft", "drafts")} a day: a tailored resume and cover letter, waiting for your review.`
              : "Off. You choose which postings get a draft with Prepare draft."
          }
          checked={settings.autoDraft}
          onCheckedChange={(autoDraft) => change({ autoDraft })}
        />
        </Card>

        <TitleSkips titles={settings.titleSkip} onChange={(titleSkip) => change({ titleSkip })} />

        <p className="text-meta text-muted">
        {plural(settings.times.length, "run", "runs")} a day, and at most {settings.times.length + 2} in any 24 hours with Run now. Together they score up to {plural(settings.dailyScores, "posting", "postings")} a day, a fair share from each search
        {settings.autoDraft ? `, and prepare up to ${plural(settings.dailyDrafts, "draft", "drafts")}` : ""}. Scoring and drafts go to your AI provider with your profile, as a new application does; the job source only gets the search.
        </p>
      </section>
    </>
  );
}

/** What the agent still needs, with a link to the section that sets it up. */
function SetupNote({ before, section, after }: { before: string; section: SettingsSectionId; after: string }) {
  return (
    <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
      {before}
      <Link href={settingsSectionHref(section)} className="font-medium text-warning underline underline-offset-2">
        Settings → {SETTINGS_SECTIONS.find((entry) => entry.id === section)?.label}
      </Link>
      {after}
    </p>
  );
}

/** When the agent runs, with each run's share of the day's scores and drafts, each saved at once. */
function RunTimes({ settings, timeZone, onChange }: { settings: AgentSettings; timeZone: string; onChange: (next: Partial<AgentSettings>) => void }) {
  const { times, scoreShares, draftShares, dailyScores, dailyDrafts, autoDraft } = settings;
  // Each time with its shares, so they stay together when the times are put in order. Unset shares split evenly.
  const even = (total: number, index: number) => Math.floor(total / times.length) + (index < total % times.length ? 1 : 0);
  const rows = times.map((time, index) => ({ time, score: scoreShares.length ? (scoreShares[index] ?? 0) : even(dailyScores, index), draft: draftShares.length ? (draftShares[index] ?? 0) : even(dailyDrafts, index) }));
  const save = (next: typeof rows) => {
    const sorted = next.toSorted((a, b) => a.time.localeCompare(b.time));
    onChange({ times: sorted.map((row) => row.time), scoreShares: sorted.map((row) => row.score), draftShares: sorted.map((row) => row.draft) });
  };
  const set = (index: number, change: Partial<(typeof rows)[number]>) => save(rows.map((row, at) => (at === index ? { ...row, ...change } : row)));
  // Drafts across the runs past "Drafts a day, at most": ask whether to raise it, or keep things as they were.
  const [overDrafts, setOverDrafts] = useState<{ next: typeof rows; total: number } | null>(null);
  const setDrafts = (index: number, draft: number) => {
    const next = rows.map((row, at) => (at === index ? { ...row, draft } : row));
    const total = next.reduce((sum, row) => sum + row.draft, 0);
    if (total > dailyDrafts) setOverDrafts({ next, total });
    else save(next);
  };
  const raiseTo = overDrafts ? Math.min(overDrafts.total, AGENT_DAILY_DRAFTS.max) : 0;
  // The next free hour after the last time, so a new one doesn't repeat it; it gets no share until you give it one.
  const add = () => {
    const last = Number(times[times.length - 1]?.slice(0, 2) ?? 7);
    const free = QUARTER_HOURS.find((time) => Number(time.slice(0, 2)) > last && !times.includes(time)) ?? QUARTER_HOURS.find((time) => !times.includes(time))!;
    save([...rows, { time: free, score: 0, draft: 0 }]);
  };
  const scoreTotal = rows.reduce((sum, row) => sum + row.score, 0);
  const draftTotal = rows.reduce((sum, row) => sum + row.draft, 0);
  return (
    <Card padding="none" className="flex flex-col gap-4 px-7 py-[26px]">
      <div className="flex flex-col gap-1">
        <h3 className="text-field font-medium">When it runs</h3>
        <p className="text-meta text-muted">
          Your time ({timeZone}). Each run asks every search; Scout has to be running then, and a time it missed runs as soon as it&apos;s back. Each run scores and drafts up to its share, so later runs still have room for jobs posted later in the day. What a run doesn&apos;t use carries on to the next.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <li key={row.time} className="flex flex-wrap items-end gap-3">
            <Select label={`Run ${index + 1}`} value={row.time} onChange={(event) => set(index, { time: event.target.value })}>
              {QUARTER_HOURS.filter((option) => option === row.time || !times.includes(option)).map((option) => (
                <option key={option} value={option}>
                  {twelveHour(option)}
                </option>
              ))}
            </Select>
            <Select label="Jobs to score" value={String(row.score)} onChange={(event) => set(index, { score: Number(event.target.value) })}>
              {withValue(SHARE_STEPS, row.score).map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </Select>
            {autoDraft && (
              <Select label="Drafts" value={String(row.draft)} onChange={(event) => setDrafts(index, Number(event.target.value))}>
                {withValue(SHARE_STEPS.filter((count) => count <= 100), row.draft).map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </Select>
            )}
            {times.length > 1 && (
              <Button variant="danger-text" size="sm" aria-label={`Remove run ${index + 1} (${twelveHour(row.time)})`} onClick={() => save(rows.filter((_, at) => at !== index))}>
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="text-meta text-muted">
        {scoreTotal} jobs to score in all, of {dailyScores} a day{scoreTotal > dailyScores ? ": the daily limit stops it first" : ""}.
        {autoDraft && ` ${draftTotal} drafts in all, of ${dailyDrafts} a day${draftTotal > dailyDrafts ? ": the daily limit stops it first" : ""}.`}
      </p>
      <Button variant="secondary" size="sm" className="self-start" aria-disabled={times.length >= MAX_AGENT_TIMES || undefined} onClick={() => times.length < MAX_AGENT_TIMES && add()}>
        Add a run time
      </Button>
      <ConfirmDialog
        open={overDrafts !== null}
        onOpenChange={(open) => !open && setOverDrafts(null)}
        title={`Raise drafts a day to ${raiseTo}?`}
        description={
          overDrafts
            ? `Your runs now add up to ${overDrafts.total} drafts, more than "Drafts a day, at most" (${dailyDrafts}), which would stop them first. Raise it to ${raiseTo}${overDrafts.total > raiseTo ? ", the most allowed" : ""} so the runs can use what you picked? Cancel keeps everything as it was.`
            : ""
        }
        confirmLabel={`Raise to ${raiseTo}`}
        onConfirm={() => {
          if (!overDrafts) return;
          const sorted = overDrafts.next.toSorted((a, b) => a.time.localeCompare(b.time));
          onChange({ times: sorted.map((row) => row.time), scoreShares: sorted.map((row) => row.score), draftShares: sorted.map((row) => row.draft), dailyDrafts: raiseTo });
          setOverDrafts(null);
        }}
      />
    </Card>
  );
}
