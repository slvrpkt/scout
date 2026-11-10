"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";
import { EMPLOYMENT_TYPES, LEVELS, WORK_MODES } from "@/lib/job-search/filters";
import type { JobSource, SearchQuery } from "@/lib/job-search/search";

// A search's filters, the same on Manual job search and in each of the job
// agent's searches: pick any number of each; none picked means any.

const SALARY_TIP =
  "Only jobs whose listed pay is below this are hidden. A job that doesn't list its pay always shows, as if it met your salary.";

function Choices<V extends string>({
  label,
  options,
  chosen,
  onChange,
  hint,
}: {
  label: string;
  options: readonly { value: V; label: string }[];
  chosen: readonly V[];
  onChange: (next: V[]) => void;
  hint?: string;
}) {
  const toggle = (value: V) => onChange(chosen.includes(value) ? chosen.filter((entry) => entry !== value) : [...chosen, value]);
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="pb-1.5 text-label text-muted">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const on = chosen.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(option.value)}
              className={cn(
                "rounded-control border px-2.5 py-1.5 text-control",
                on ? "border-primary bg-selected font-medium text-primary-text" : "border-line-field bg-card hover:border-line-strong hover:bg-hover",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {hint && <span className="text-meta text-muted">{hint}</span>}
    </fieldset>
  );
}

/**
 * Work mode, experience level, employment type and the least salary. Work
 * mode also keeps the sources' own "remote only" in step.
 */
export function SearchFilters({ value, onChange, onBlur, source = null }: { value: SearchQuery; onChange: (patch: Partial<SearchQuery>) => void; onBlur?: () => void; source?: JobSource | null }) {
  const [salary, setSalary] = useState(value.minSalary ? value.minSalary.toLocaleString("en-US") : "");
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:col-span-full sm:grid-cols-2 xl:grid-cols-4">
      <Choices
        label="Work mode"
        options={WORK_MODES}
        chosen={value.workModes ?? []}
        onChange={(workModes) => onChange({ workModes, remoteOnly: workModes.length === 1 && workModes[0] === "remote" })}
        hint={source === "ADZUNA" && value.remoteOnly ? "Adzuna has no remote filter, so this adds “remote” to your search." : "None picked: any. A posting that doesn't say stays."}
      />
      <Choices label="Experience level" options={LEVELS} chosen={value.levels ?? []} onChange={(levels) => onChange({ levels })} hint="From the job title and the years it asks for." />
      <Choices label="Employment type" options={EMPLOYMENT_TYPES} chosen={value.types ?? []} onChange={(types) => onChange({ types })} />
      <label className="flex min-w-0 flex-col gap-1.5 text-label text-muted">
        <span className="flex items-center gap-1.5">
          Salary at least (jobs without listed pay are kept)
          <span title={SALARY_TIP} aria-label={SALARY_TIP} role="img" className="cursor-help rounded-full border border-line-field px-1.5 text-[11px] leading-4 text-muted">
            i
          </span>
        </span>
        <input
          inputMode="numeric"
          placeholder="e.g. 110,000 a year"
          value={salary}
          onBlur={onBlur}
          onChange={(event) => {
            const digits = event.target.value.replace(/[^\d]/g, "");
            setSalary(digits ? Number(digits).toLocaleString("en-US") : "");
            onChange({ minSalary: digits ? Number(digits) : null });
          }}
          className="rounded-control border border-line-input bg-input px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:border-primary"
        />
      </label>
    </div>
  );
}
