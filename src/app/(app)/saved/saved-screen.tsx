"use client";

import { useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { postingKey, type ShownPosting } from "@/lib/job-search/search";
import { atPlace, countsOf, inScoreRange, placeChoices, SCORE_RANGES } from "@/lib/place-filter";

import { PostingResults } from "../jobs/posting-results";

/** How many jobs a page shows. */
export const SAVED_PAGE = 8;

const field = "rounded-control border border-line-input bg-input px-3 py-2 text-sm text-ink focus-visible:border-primary";
const label = "flex flex-col gap-1.5 text-label text-muted";

/**
 * Saved for later: jobs put aside from Agentic and Manual job search, highest
 * score first, with the Agentic page's filters and 8 to a page. Saving never
 * took them out of those lists; applying takes them off here.
 */
export function SavedScreen({ postings, today }: { postings: ShownPosting[]; today: string }) {
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState("");
  const [where, setWhere] = useState("");
  const [postedWithin, setPostedWithin] = useState<"any" | "1" | "3" | "7" | "30">("any");
  const [scoreRange, setScoreRange] = useState("");
  const [page, setPage] = useState(0);
  const now = Date.parse(today);

  const scoreOf = (posting: ShownPosting) => posting.state.score?.score ?? null;
  const matches = (text: string, needle: string) => !needle.trim() || text.toLowerCase().includes(needle.trim().toLowerCase());
  const within = (iso: string | null) => postedWithin === "any" || (iso !== null && Date.parse(iso) >= now - Number(postedWithin) * 86_400_000);
  const filtered = postings
    .filter(
      (posting) =>
        matches(`${posting.title} ${posting.company} ${posting.description}`, query) &&
        (!company || posting.company.trim() === company) &&
        atPlace(posting, where) &&
        within(posting.postedAt) &&
        inScoreRange(scoreOf(posting), scoreRange),
    )
    // Highest score first; one not scored yet goes last.
    .toSorted((a, b) => (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1));
  const pages = Math.max(1, Math.ceil(filtered.length / SAVED_PAGE));
  const current = Math.min(page, pages - 1);
  const shown = filtered.slice(current * SAVED_PAGE, (current + 1) * SAVED_PAGE);
  const companies = countsOf(postings.map((posting) => posting.company.trim()).filter(Boolean));
  const places = placeChoices(postings);
  // A filter starts again from the first page.
  const filter =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(0);
    };

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title="Saved for later"
        description="A temporary place for jobs you want to come back to, so you can find them again without digging through the longer lists on Agentic and Manual job search. Saving doesn't take a job out of those lists, and once you apply, it moves to your Job application log and off this page."
      />
      <div className="flex flex-col gap-5 px-10 pb-6">
        <Card padding="none" className="flex flex-wrap items-end gap-4 px-6 py-4">
          <label className={`${label} min-w-[200px] flex-[2_1_220px]`}>
            What
            <input
              type="search"
              aria-label="Search saved jobs"
              placeholder="Title, company or anything in the posting"
              value={query}
              onChange={(event) => filter(setQuery)(event.target.value)}
              className={`${field} placeholder:text-muted`}
            />
          </label>
          <label className={`${label} min-w-[180px] flex-[1_1_200px]`}>
            Company
            <select value={company} onChange={(event) => filter(setCompany)(event.target.value)} className={field}>
              <option value="">Any company</option>
              {companies.map(([name, count]) => (
                <option key={name} value={name}>
                  {name} ({count})
                </option>
              ))}
            </select>
          </label>
          <label className={`${label} min-w-[180px] flex-[1_1_200px]`}>
            Location
            <select value={where} onChange={(event) => filter(setWhere)(event.target.value)} className={field}>
              <option value="">Anywhere</option>
              {places.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label} ({choice.count})
                </option>
              ))}
            </select>
          </label>
          <label className={`${label} min-w-[150px]`}>
            Posted
            <select value={postedWithin} onChange={(event) => filter(setPostedWithin)(event.target.value as typeof postedWithin)} className={field}>
              <option value="any">Any time</option>
              <option value="1">Past 24 hours</option>
              <option value="3">Past 3 days</option>
              <option value="7">Past week</option>
              <option value="30">Past month</option>
            </select>
          </label>
          <label className={`${label} min-w-[130px]`}>
            Score
            <select value={scoreRange} onChange={(event) => filter(setScoreRange)(event.target.value)} className={field}>
              <option value="">Any score</option>
              {SCORE_RANGES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
        </Card>
        {pages > 1 && (
          <nav aria-label="Pages" className="flex flex-wrap items-center gap-2 text-meta text-muted">
            <Button size="sm" variant="secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>
              Previous
            </Button>
            {Array.from({ length: pages }, (_, index) => (
              <Button
                key={index}
                size="sm"
                variant={index === current ? "primary" : "secondary"}
                aria-current={index === current ? "page" : undefined}
                onClick={() => setPage(index)}
              >
                {index + 1}
              </Button>
            ))}
            <Button size="sm" variant="secondary" disabled={current === pages - 1} onClick={() => setPage(current + 1)}>
              Next
            </Button>
            <span>
              {filtered.length} saved jobs, {SAVED_PAGE} to a page
            </span>
          </nav>
        )}
      </div>
      {/* Keyed by what it shows: a filter, a page, or a job saved or taken off elsewhere starts it fresh. */}
      <PostingResults key={shown.map(postingKey).join("|") || "empty"} mode="saved" postings={shown} today={today} scoreInClaude={false} />
    </div>
  );
}
