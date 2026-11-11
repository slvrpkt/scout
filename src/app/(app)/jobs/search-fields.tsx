"use client";

import type { ReactNode } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Country } from "@/lib/job-search/countries";
import { POSTED_WITHIN, RADII_KM, radiusLabel, type JobSource, type RadiusKm, type SearchQuery } from "@/lib/job-search/search";
import { SOURCE_INFO, sourceCovers } from "@/lib/job-search/sources";

// A search's fields, as Find jobs asks them (E14-6) and Settings → Job agent
// saves its search (E16-7).

export type SearchFieldErrors = { keywords?: string; country?: string };

/** Why `source` can't search the country, in words, or undefined. */
export function uncoveredCountry(source: JobSource | null, query: SearchQuery, countries: readonly Country[]): string | undefined {
  if (!source || !query.country || sourceCovers(source, query.country)) return undefined;
  const name = countries.find((country) => country.code === query.country)?.name ?? query.country.toUpperCase();
  return `${SOURCE_INFO[source].name} doesn't list jobs in ${name}.`;
}

/** What, Where, Country, Within and Posted, for a grid; the filters are SearchFilters. */
export function SearchFields({
  value,
  onChange,
  source,
  countries,
  errors = {},
  onBlur,
  where,
  agent = false,
  underWhat,
}: {
  value: SearchQuery;
  onChange: (patch: Partial<SearchQuery>) => void;
  source: JobSource | null;
  countries: readonly Country[];
  errors?: SearchFieldErrors;
  /** For text fields that save once typing is done. */
  onBlur?: () => void;
  /** Stands in for Where and Within, across the grid: the job agent's locations. */
  where?: ReactNode;
  /** A job agent search: it looks at what's new since its last run, so there's no Posted to choose. */
  agent?: boolean;
  /** Under What, e.g. the job agent's other titles. */
  underWhat?: ReactNode;
}) {
  const uncovered = uncoveredCountry(source, value, countries);
  const noRadius = source !== null && !SOURCE_INFO[source].radius;
  return (
    <>
      <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
        <Input
          label="What"
          value={value.keywords}
          placeholder="Job title, skill or company"
          error={errors.keywords}
          onChange={(event) => onChange({ keywords: event.target.value })}
          onBlur={onBlur}
        />
        {underWhat}
      </div>
      {where ? <div className="sm:col-span-2">{where}</div> : <Input label="Where" value={value.place} placeholder="City or region" onChange={(event) => onChange({ place: event.target.value })} onBlur={onBlur} />}
      <Select label="Country" value={value.country} error={errors.country ?? uncovered} onChange={(event) => onChange({ country: event.target.value })}>
        <option value="">Choose a country</option>
        {countries.map((country) => (
          <option key={country.code} value={country.code}>
            {country.name}
          </option>
        ))}
      </Select>
      {!where && (
      <Select
        label="Within"
        value={String(value.radiusKm)}
        disabled={noRadius || !value.place.trim()}
        hint={noRadius ? `${SOURCE_INFO[source].name} has no distance filter` : value.place.trim() ? undefined : "Add a place first"}
        onChange={(event) => onChange({ radiusKm: Number(event.target.value) as RadiusKm })}
      >
        {RADII_KM.map((km) => (
          <option key={km} value={km}>
            {radiusLabel(km)}
          </option>
        ))}
      </Select>
      )}
      {agent ? (
        <div className="flex flex-col gap-1.5 text-label text-muted">
          Posted
          <span className="rounded-control border border-line-field bg-sunken px-3 py-2 text-sm text-ink">Automatic (new since last run)</span>
        </div>
      ) : (
        <Select label="Date posted" value={value.postedWithin} onChange={(event) => onChange({ postedWithin: event.target.value as SearchQuery["postedWithin"] })}>
          {POSTED_WITHIN.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value === "day" ? "Past 24 hours" : option.label}
            </option>
          ))}
        </Select>
      )}
    </>
  );
}
