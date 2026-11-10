"use client";

import { ChevronDown, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { useAutosave } from "@/hooks/use-autosave";
import { cn } from "@/lib/cn";
import type { Country } from "@/lib/job-search/countries";
import { EMPLOYMENT_TYPES, LEVELS, WORK_MODES } from "@/lib/job-search/filters";
import { skipRuleList } from "@/lib/scoring/rubric";
import { searchHref, type JobSource, type SearchQuery } from "@/lib/job-search/search";

import { addAgentSearch, changeAgentSearch, removeAgentSearch } from "../agent/actions";
import { SearchFields, type SearchFieldErrors } from "../jobs/search-fields";
import { SearchFilters } from "../jobs/search-filters";
import { companyInTitle } from "@/lib/job-search/company";

import { AltTitles, SearchCompanies, SearchPlaces, SkipRules } from "./skip-rules";

export type AgentSearchSetting = { id: string; query: SearchQuery; enabled: boolean; maxPages: number; skipRules: string; places: string; altTitles?: string; companies?: string };
/** The country company searches cover, and whether it's the one in the profile or the US by default. */
export type HomeCountry = { name: string; fromProfile: boolean };

/**
 * The job agent's saved searches: every run goes through each one that's
 * on. A search saves once typing pauses; its switch and Remove at once.
 * One search is open at a time; the rest are tiles with their title and
 * where they look, and a click on a tile opens it.
 */
export function AgentSearches({
  initial,
  max,
  maxPages,
  startFrom,
  source,
  countries,
  homeCountry = { name: "United States", fromProfile: false },
}: {
  initial: AgentSearchSetting[];
  /** How many it may keep. */
  max: number;
  /** The most pages a search may read. */
  maxPages: number;
  /** The country company searches cover (Profile → Basics, else the US). */
  homeCountry?: HomeCountry;
  /** What Add search starts from: the last search in Find jobs, or an empty one. */
  startFrom: SearchQuery;
  source: JobSource | null;
  countries: readonly Country[];
}) {
  const track = useTrackSave();
  const [searches, setSearches] = useState(initial);
  const [adding, setAdding] = useState(false);
  // The one search shown in full: the only one, else none until a tile is clicked.
  const [open, setOpen] = useState<string | null>(initial.length === 1 ? initial[0].id : null);

  const add = async () => {
    setAdding(true);
    // A new search copies the one before it (locations, filters, pages to read and every other setting), so only the job title and what to skip start blank.
    const previous = searches.at(-1);
    const query = previous ? { ...previous.query, keywords: "" } : { ...startFrom, place: "", country: startFrom.country || "us" };
    const result = toastResult(await track(addAgentSearch({ query })));
    if (!result.ok) {
      setAdding(false);
      return;
    }
    const added: AgentSearchSetting = { id: result.data.id, query, enabled: true, maxPages: previous?.maxPages ?? result.data.maxPages, skipRules: "", places: previous?.places ?? "" };
    if (previous && (added.places || added.maxPages !== result.data.maxPages)) {
      await track(changeAgentSearch({ id: added.id, places: added.places, maxPages: added.maxPages }));
    }
    setAdding(false);
    setSearches((current) => [...current, added]);
    setOpen(added.id);
  };

  const remove = async (id: string) => {
    const previous = searches;
    setSearches(searches.filter((search) => search.id !== id));
    if (!toastResult(await track(removeAgentSearch({ id }))).ok) setSearches(previous);
  };

  return (
    <>
      <div className="flex items-center justify-end gap-4">
        <span className="text-sm text-muted">
          {searches.length} of {max} searches
        </span>
        <Button
          size="lg"
          className="min-h-12 px-7 text-base font-semibold"
          aria-disabled={adding || searches.length >= max || undefined}
          onClick={() => !adding && searches.length < max && void add()}
        >
          <span aria-hidden="true">+ </span>Add search
        </Button>
      </div>
      <Card padding="none" className="flex flex-col gap-4 px-7 py-[26px]">
      <div className="flex flex-col gap-1">
        <h3 className="text-field font-medium">What it looks for</h3>
        <p className="text-meta text-muted">
          Each search is asked on every run, through the source in Settings → Job search; a job two searches both find counts once. Postings you saved, dismissed or applied for in Manual job search are left out.
        </p>
      </div>
      {searches.length === 0 && <p className="text-meta text-muted">No searches yet. Use Add search to tell the agent what to look for.</p>}
      <ol className="flex flex-col gap-4">
        {searches.map((search, index) => (
          <li key={search.id}>
            <SearchCard
              number={index + 1}
              search={search}
              expanded={open === search.id}
              onToggle={() => setOpen((current) => (current === search.id ? null : search.id))}
              maxPages={maxPages}
              source={source}
              countries={countries}
              homeCountry={homeCountry}
              onChange={(next) => setSearches((current) => current.map((entry) => (entry.id === search.id ? next : entry)))}
              onRemove={() => void remove(search.id)}
            />
          </li>
        ))}
      </ol>
      </Card>
    </>
  );
}

/** Where a search looks and what it keeps, in a line, for its tile. */
export function searchSummary(search: AgentSearchSetting): string {
  const companies = skipRuleList(search.companies ?? "");
  if (companies.length > 0) {
    const named = companies.length > 3 ? `${companies.slice(0, 3).join(", ")} +${companies.length - 3}` : companies.join(", ");
    return `At ${named} · across the country in your profile`;
  }
  const places = skipRuleList(search.places);
  const where = places.length > 0 ? places.join(", ") : search.query.place.trim() || `Anywhere${search.query.country ? ` in ${search.query.country.toUpperCase()}` : ""}`;
  const labels = (options: readonly { value: string; label: string }[], chosen: readonly string[] | undefined) =>
    options.filter((option) => chosen?.includes(option.value)).map((option) => option.label);
  const parts = [
    where,
    labels(WORK_MODES, search.query.workModes).join("/"),
    labels(LEVELS, search.query.levels).join("/"),
    labels(EMPLOYMENT_TYPES, search.query.types).join("/"),
    search.query.minSalary ? `$${search.query.minSalary.toLocaleString("en-US")}+` : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

/** One saved search: its switch, Open in Find jobs and Remove, its fields, and what to skip; a tile when it isn't the open one. */
function SearchCard({
  number,
  search,
  expanded,
  onToggle,
  maxPages,
  source,
  countries,
  homeCountry,
  onChange,
  onRemove,
}: {
  number: number;
  search: AgentSearchSetting;
  /** Shown in full; otherwise a tile. */
  expanded: boolean;
  onToggle: () => void;
  maxPages: number;
  source: JobSource | null;
  countries: readonly Country[];
  homeCountry: HomeCountry;
  onChange: (search: AgentSearchSetting) => void;
  onRemove: () => void;
}) {
  const track = useTrackSave();
  const [errors, setErrors] = useState<SearchFieldErrors>({});
  const places = skipRuleList(search.places);
  const { flush } = useAutosave(search.query, (query) => track(changeAgentSearch({ id: search.id, query })));
  const setQuery = (patch: Partial<SearchQuery>) => {
    setErrors({});
    onChange({ ...search, query: { ...search.query, ...patch } });
  };
  const switchTo = async (enabled: boolean) => {
    if (enabled && (!search.query.keywords.trim() || !search.query.country)) {
      setErrors({
        keywords: search.query.keywords.trim() ? undefined : "Type what this search should look for.",
        country: search.query.country ? undefined : "Choose a country.",
      });
      return;
    }
    onChange({ ...search, enabled });
    if (!toastResult(await track(changeAgentSearch({ id: search.id, enabled }))).ok) onChange(search);
  };
  const setSkipRules = async (rules: string[]) => {
    const skipRules = rules.join("\n");
    onChange({ ...search, skipRules });
    if (!toastResult(await track(changeAgentSearch({ id: search.id, skipRules }))).ok) onChange(search);
  };
  const setCompanies = async (list: string[]) => {
    const companies = list.join("\n");
    onChange({ ...search, companies });
    if (!toastResult(await track(changeAgentSearch({ id: search.id, companies }))).ok) onChange(search);
  };
  const setAltTitles = async (list: string[]) => {
    const altTitles = list.join("\n");
    onChange({ ...search, altTitles });
    if (!toastResult(await track(changeAgentSearch({ id: search.id, altTitles }))).ok) onChange(search);
  };
  const setPlaces = async (list: string[]) => {
    const places = list.join("\n");
    onChange({ ...search, places });
    if (!toastResult(await track(changeAgentSearch({ id: search.id, places }))).ok) onChange(search);
  };
  const setPages = async (pages: number) => {
    onChange({ ...search, maxPages: pages });
    if (!toastResult(await track(changeAgentSearch({ id: search.id, maxPages: pages }))).ok) onChange(search);
  };

  const title = search.query.keywords.trim();
  const altCount = skipRuleList(search.altTitles ?? "").length;
  const companies = skipRuleList(search.companies ?? "");
  // A company written into a title ("Project Manager at Leidos") while the search has locations: each location costs its own request.
  const titleCompany =
    companies.length === 0 && places.length > 0 ? ([search.query.keywords, ...skipRuleList(search.altTitles ?? "")].map(companyInTitle).find(Boolean) ?? null) : null;
  const toggle = (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className="flex min-w-0 flex-1 items-start gap-2 rounded-control text-left focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <ChevronDown aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0 text-muted transition-transform", !expanded && "-rotate-90")} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">
          Search {number}
          <span className={cn("font-normal", title ? "text-ink" : "text-muted")}> · {title || "No job title yet"}</span>
          {altCount > 0 && <span className="font-normal text-muted">{` +${altCount} ${altCount === 1 ? "title" : "titles"}`}</span>}
        </span>
        {!expanded && <span className="truncate text-meta text-muted">{searchSummary(search)}</span>}
      </span>
    </button>
  );

  if (!expanded) {
    return (
      <section aria-label={`Search ${number}`} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line-card bg-card px-5 py-3 hover:border-line-strong">
        {toggle}
        <div className="flex items-center gap-3">
          <span className={cn("text-meta", search.enabled ? "text-ink" : "text-muted")}>{search.enabled ? "Enabled" : "Disabled"}</span>
          <Button variant="secondary" size="sm" onClick={onToggle}>
            Edit
          </Button>
          <Button variant="danger-text" size="sm" onClick={onRemove} aria-label={`Remove search ${number}`}>
            <Trash2 aria-hidden="true" className="size-3.5" />
            Remove
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label={`Search ${number}`} className="flex flex-col gap-4 rounded-card border border-line-card bg-card px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {toggle}
        <div className="flex items-center gap-3">
          {search.query.keywords.trim() && places.length === 0 && (
            <Link href={searchHref(search.query)} className="text-meta font-medium text-ink underline underline-offset-2">
              Open in Manual job search
            </Link>
          )}
          <Toggle
            label={search.enabled ? "Enabled" : "Disabled"}
            className="gap-2"
            checked={search.enabled}
            onCheckedChange={(enabled) => void switchTo(enabled)}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 items-start gap-x-4 gap-y-4 sm:grid-cols-2" onBlur={flush}>
        <SearchFields
          agent
          value={search.query}
          onChange={setQuery}
          source={source}
          countries={countries}
          errors={errors}
          underWhat={
            <div className="flex flex-col gap-2">
              <AltTitles titles={skipRuleList(search.altTitles ?? "")} onChange={(list) => void setAltTitles(list)} />
              <SearchCompanies companies={companies} onChange={(list) => void setCompanies(list)} country={homeCountry.name} />
              {titleCompany && <CompanyInTitleNote searchId={search.id} company={titleCompany} places={places.length} country={homeCountry.name} />}
            </div>
          }
          where={
            <div className="flex flex-col gap-1.5">
              {companies.length > 0 ? (
                <div role="note" className="flex flex-col gap-1 rounded-control border border-dashed border-line-field bg-hover px-4 py-3 text-meta text-muted">
                  <span className="text-label font-medium text-ink">Locations are off for this search</span>
                  {homeCountry.fromProfile
                    ? `Companies are searched across ${homeCountry.name} (the country in your profile), so locations are off for this search.`
                    : `Companies are searched across ${homeCountry.name}, the default because your profile has no country. Add one in Profile → Basics to search another.`}
                </div>
              ) : (
                <SearchPlaces places={places} onChange={(list) => void setPlaces(list)} />
              )}
              {companies.length === 0 && search.query.keywords.trim() && places.length > 0 && (
                <p className="flex flex-wrap gap-x-2 text-meta text-muted">
                  Open in Manual job search, one location at a time:
                  {places.map((place) => (
                    <Link key={place} href={searchHref({ ...search.query, place })} className="font-medium text-ink underline underline-offset-2">
                      {place}
                    </Link>
                  ))}
                </p>
              )}
            </div>
          }
        />
        <div className="sm:col-span-2">
          <SearchFilters value={search.query} onChange={setQuery} onBlur={flush} source={source} />
        </div>
      </div>
      <Select
        label="Pages to read"
        hint={
          source === "JSEARCH"
            ? "About 10–20 postings a page, one request each. JSearch's free plan has 200 requests a month."
            : "About 20 postings a page, one request each. A run stops early when a page has nothing new."
        }
        value={String(search.maxPages)}
        onChange={(event) => void setPages(Number(event.target.value))}
      >
        {Array.from({ length: maxPages }, (_, index) => index + 1).map((pages) => (
          <option key={pages} value={pages}>
            {pages === 1 ? "1 page" : `Up to ${pages} pages`}
          </option>
        ))}
      </Select>
      <SkipRules rules={skipRuleList(search.skipRules)} onChange={(rules) => void setSkipRules(rules)} />
      <div className="flex justify-end">
        <Button variant="danger-text" size="sm" onClick={onRemove}>
          <Trash2 aria-hidden="true" className="size-3.5" />
          Remove
        </Button>
      </div>
    </section>
  );
}

/**
 * Said once per search when a title names a company ("Project Manager at
 * Leidos") and the search has locations: every location is its own request,
 * where the Companies box would search the company once, across the country.
 */
function CompanyInTitleNote({ searchId, company, places, country }: { searchId: string; company: string; places: number; country: string }) {
  const key = `company-in-title:${searchId}`;
  const [closed, setClosed] = useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  if (closed) return null;
  const close = () => {
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // Without storage it shows again on the next visit.
    }
    setClosed(true);
  };
  return (
    <div role="note" className="flex flex-col gap-2 rounded-control border border-warning bg-warning-surface px-4 py-3 text-meta text-warning">
      <span className="text-label font-medium">Looks like you&apos;re searching for a company</span>
      <span>
        Each location is searched on its own, so a title with “at {company}” across {places} {places === 1 ? "location" : "locations"} is {places} {places === 1 ? "request" : "requests"} on every run, which raises your monthly API cost. To get the same jobs for less, add {company} with + Add companies instead: it&apos;s searched once across {country}, and you can narrow the jobs by place afterwards with the Location filter in Agentic job search.
      </span>
      <div>
        <Button variant="secondary" size="sm" onClick={close}>
          Got it
        </Button>
      </div>
    </div>
  );
}
