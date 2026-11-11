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
  row = false,
  warning,
}: {
  label: string;
  options: readonly { value: V; label: string }[];
  chosen: readonly V[];
  onChange: (next: V[]) => void;
  hint?: string;
  /** As a row: the label on the left, the choices in a line, the hint as a tooltip. */
  row?: boolean;
  /** As a row: a note that has to be seen, under the choices. */
  warning?: string;
}) {
  const toggle = (value: V) =>
    onChange(
      chosen.includes(value)
        ? chosen.filter((entry) => entry !== value)
        : [...chosen, value],
    );
  if (row)
    return (
      <fieldset className="grid min-w-0 items-center gap-x-4 gap-y-1.5 sm:grid-cols-[150px_1fr]">
        <legend className="contents">
          <span className="text-label text-muted" title={hint}>
            {label}
          </span>
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => (
            <ChoiceButton
              key={option.value}
              label={option.label}
              on={chosen.includes(option.value)}
              onClick={() => toggle(option.value)}
            />
          ))}
        </div>
        {warning && <span className="text-meta text-warning sm:col-start-2">{warning}</span>}
      </fieldset>
    );
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
                on
                  ? "border-primary bg-selected font-medium text-primary-text"
                  : "border-line-field bg-card hover:border-line-strong hover:bg-hover",
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

/** One choice: pressed when picked. */
function ChoiceButton({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-control border px-2.5 py-1.5 text-control",
        on
          ? "border-primary bg-selected font-medium text-primary-text"
          : "border-line-field bg-card hover:border-line-strong hover:bg-hover",
      )}
    >
      {label}
    </button>
  );
}

/**
 * Work mode, experience level, employment type and the least salary. Work
 * mode also keeps the sources' own "remote only" in step. `rows` lays them
 * out one under another, each label on the left (Manual job search).
 */
export function SearchFilters({
  value,
  onChange,
  onBlur,
  source = null,
  rows = false,
}: {
  value: SearchQuery;
  onChange: (patch: Partial<SearchQuery>) => void;
  onBlur?: () => void;
  source?: JobSource | null;
  rows?: boolean;
}) {
  const [salary, setSalary] = useState(
    value.minSalary ? value.minSalary.toLocaleString("en-US") : "",
  );
  const salaryInput = (
    <input
      inputMode="numeric"
      aria-label={rows ? "Salary at least" : undefined}
      placeholder="e.g. 110,000 a year"
      value={salary}
      onBlur={onBlur}
      onChange={(event) => {
        const digits = event.target.value.replace(/[^\d]/g, "");
        setSalary(digits ? Number(digits).toLocaleString("en-US") : "");
        onChange({ minSalary: digits ? Number(digits) : null });
      }}
      className={cn(
        "rounded-control border border-line-input bg-input px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:border-primary",
        rows && "w-full max-w-[240px]",
      )}
    />
  );
  const workModes = (picked: SearchQuery["workModes"]) =>
    onChange({
      workModes: picked,
      remoteOnly: (picked ?? []).length === 1 && picked?.[0] === "remote",
    });
  if (rows)
    return (
      <div className="flex flex-col gap-3">
        <p className="text-meta text-muted">
          Leave a row with nothing picked to get any. A posting that
          doesn&apos;t say still shows.
        </p>
        <Choices
          row
          label="Work mode"
          options={WORK_MODES}
          chosen={value.workModes ?? []}
          onChange={workModes}
          warning={source === "ADZUNA" && value.remoteOnly ? "Adzuna has no remote filter, so this adds “remote” to your search." : undefined}
        />
        <Choices
          row
          label="Experience level"
          options={LEVELS}
          chosen={value.levels ?? []}
          onChange={(levels) => onChange({ levels })}
          hint="From the job title and the years it asks for."
        />
        <Choices
          row
          label="Employment type"
          options={EMPLOYMENT_TYPES}
          chosen={value.types ?? []}
          onChange={(types) => onChange({ types })}
        />
        <div className="grid min-w-0 items-center gap-x-4 gap-y-1.5 sm:grid-cols-[150px_1fr]">
          <span className="flex items-center gap-1.5 text-label text-muted">
            Salary at least
            <span
              title={SALARY_TIP}
              aria-label={SALARY_TIP}
              role="img"
              className="cursor-help rounded-full border border-line-field px-1.5 text-[11px] leading-4 text-muted"
            >
              i
            </span>
          </span>
          {salaryInput}
        </div>
      </div>
    );
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:col-span-full sm:grid-cols-2 xl:grid-cols-4">
      <Choices
        label="Work mode"
        options={WORK_MODES}
        chosen={value.workModes ?? []}
        onChange={(workModes) =>
          onChange({
            workModes,
            remoteOnly: workModes.length === 1 && workModes[0] === "remote",
          })
        }
        hint={
          source === "ADZUNA" && value.remoteOnly
            ? "Adzuna has no remote filter, so this adds “remote” to your search."
            : "None picked: any. A posting that doesn't say stays."
        }
      />
      <Choices
        label="Experience level"
        options={LEVELS}
        chosen={value.levels ?? []}
        onChange={(levels) => onChange({ levels })}
        hint="From the job title and the years it asks for."
      />
      <Choices
        label="Employment type"
        options={EMPLOYMENT_TYPES}
        chosen={value.types ?? []}
        onChange={(types) => onChange({ types })}
      />
      <label className="flex min-w-0 flex-col gap-1.5 text-label text-muted">
        <span className="flex items-center gap-1.5">
          Salary at least (jobs without listed pay are kept)
          <span
            title={SALARY_TIP}
            aria-label={SALARY_TIP}
            role="img"
            className="cursor-help rounded-full border border-line-field px-1.5 text-[11px] leading-4 text-muted"
          >
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
