"use client";

import { useState } from "react";

import type { ApplicationStatus } from "@/generated/prisma/enums";
import { formatShortDate } from "@/lib/dates";
import type { ActivityUnit, WeekActivity } from "@/lib/dashboard";
import { STATUSES } from "@/lib/status";

// The activity chart (E9-8): what happened in each day or week of the
// period, as one stacked bar per day or week. Each application created is a
// New slice and each status change a slice of the status it moved to, in
// the board's order from the bottom and in each status's colour. A tick
// marks every bar on the axis, with dates under some of them; a tooltip on
// hover, and the numbers as a table for everyone else.

/** How each status reads in the summary line: "5 applied", "3 screening calls". */
const NOUNS: Record<ApplicationStatus, [string, string]> = {
  DRAFT: ["new application", "new applications"],
  SENT: ["applied", "applied"],
  SCREENING: ["screening call", "screening calls"],
  INTERVIEW: ["interview", "interviews"],
  OFFER: ["offer", "offers"],
  ACCEPTED: ["accepted", "accepted"],
  REJECTED: ["rejected", "rejected"],
  DECLINED: ["declined", "declined"],
};

const said = (status: ApplicationStatus, count: number) => `${count} ${NOUNS[status][count === 1 ? 0 : 1]}`;
const total = (week: WeekActivity) => STATUSES.reduce((sum, { value }) => sum + week.counts[value], 0);

/** "Mon 3", for a day's bar. */
const dayName = (date: Date) => `${new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date)} ${date.getDate()}`;

export function ActivityChart({ weeks, unit = "week", title = "All time" }: { weeks: WeekActivity[]; unit?: ActivityUnit; /** The period's name, e.g. "Last 30 days". */ title?: string }) {
  const daily = unit === "day";
  /** What a bar is called on the axis, in the tooltip and in the table. */
  const axis = (start: Date) => (daily ? dayName(start) : formatShortDate(start));
  const long = (start: Date) => (daily ? `${dayName(start)} ${new Intl.DateTimeFormat("en-US", { month: "short" }).format(start)}` : `Week of ${formatShortDate(start)}`);
  const [hovered, setHovered] = useState<number | null>(null);
  const sums = Object.fromEntries(STATUSES.map(({ value }) => [value, weeks.reduce((sum, week) => sum + week.counts[value], 0)])) as Record<ApplicationStatus, number>;
  const all = STATUSES.reduce((sum, { value }) => sum + sums[value], 0);
  const max = Math.max(1, ...weeks.map(total));
  const middle = max > 1 ? Math.round(max / 2) : null;
  // Every day of a week; dates under at most eight of a longer chart's weeks, evenly spread.
  const every = daily ? 1 : Math.max(1, Math.ceil(weeks.length / 8));
  const summary =
    all === 0
      ? "Nothing happened in this period yet."
      : `${all} ${all === 1 ? "thing" : "things"} happened: ${STATUSES.filter(({ value }) => sums[value] > 0)
          .map(({ value }) => said(value, sums[value]))
          .join(", ")}.`;

  return (
    <section aria-labelledby="activity-heading" className="col-span-full flex flex-col gap-5 rounded-panel border border-line-card bg-card p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="activity-heading" className="font-serif text-section">
            {title}, {daily ? "day by day" : "week by week"}
          </h2>
          <p className="text-control text-muted">{weeks.length === 0 ? "Nothing to show yet." : summary}</p>
        </div>
        {weeks.length > 0 && (
          <ul aria-label="Legend" className="flex max-w-[460px] flex-wrap justify-end gap-x-4 gap-y-1 text-meta text-muted">
            {STATUSES.map(({ value, label, color }) => (
              <li key={value} className={`flex items-center gap-1.5 ${sums[value] === 0 ? "opacity-45" : ""}`}>
                <span aria-hidden="true" className="size-2.5 rounded-[2px]" style={{ backgroundColor: color }} />
                {label}
              </li>
            ))}
          </ul>
        )}
      </div>

      {weeks.length > 0 && (
        <>
          {/* The picture; the table below has the same numbers for screen readers and keyboards. */}
          <div aria-hidden="true" className="flex gap-3">
            <div className="relative h-[160px] w-6 text-right text-label text-muted tabular-nums">
              <span className="absolute top-0 right-0 -translate-y-1/2">{max}</span>
              {middle !== null && <span className="absolute top-1/2 right-0 -translate-y-1/2">{middle}</span>}
              <span className="absolute right-0 bottom-0 translate-y-1/2">0</span>
            </div>
            <div className="relative flex min-w-0 flex-1 flex-col">
              <div className="relative flex h-[160px] items-end border-b border-line">
                <span className="absolute inset-x-0 top-0 border-t border-line" />
                {middle !== null && <span className="absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${(middle / max) * 100}%` }} />}
                {weeks.map((week, index) => {
                  const height = (total(week) / max) * 100;
                  return (
                    <div
                      key={week.start.toISOString()}
                      onPointerEnter={() => setHovered(index)}
                      onPointerLeave={() => setHovered((current) => (current === index ? null : current))}
                      className="relative flex h-full flex-1 items-end justify-center px-[2px]"
                    >
                      {/* New at the bottom, up through the board's statuses; a hairline between slices. */}
                      <span
                        className={`flex w-full max-w-[22px] flex-col-reverse overflow-hidden rounded-t-[4px] ${hovered !== null && hovered !== index ? "opacity-50" : ""}`}
                        style={{ height: `${height}%` }}
                      >
                        {STATUSES.filter(({ value }) => week.counts[value] > 0).map(({ value, color }) => (
                          <span key={value} data-status={value} className="w-full border-t border-card" style={{ flexGrow: week.counts[value], backgroundColor: color }} />
                        ))}
                      </span>
                      {hovered === index && (
                        <span
                          className={`pointer-events-none absolute top-1 z-10 rounded-card border border-line-popover bg-card px-3 py-2 text-meta whitespace-nowrap shadow-menu ${
                            // Kept inside the chart: anchored to the side near either edge.
                            index < 2 ? "left-0" : index > weeks.length - 3 ? "right-0" : "left-1/2 -translate-x-1/2"
                          }`}
                        >
                          <span className="block text-muted">{long(week.start)}</span>
                          <span className="block">
                            {total(week) === 0
                              ? "Nothing happened"
                              : STATUSES.filter(({ value }) => week.counts[value] > 0)
                                  .map(({ value }) => said(value, week.counts[value]))
                                  .join(" · ")}
                          </span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* A tick under every bar, so each week is marked; dates under some. */}
              <div className="flex text-label text-muted">
                {weeks.map((week, index) => (
                  <span key={week.start.toISOString()} className="flex flex-1 flex-col items-center overflow-visible whitespace-nowrap">
                    <span data-tick="" className="h-1.5 w-px bg-line-strong" />
                    <span className="pt-1">{index % every === 0 ? axis(week.start) : " "}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <details className="text-meta text-muted">
            <summary className="w-fit cursor-pointer hover:text-ink">Show the numbers</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left tabular-nums">
                <caption className="sr-only">What happened per {daily ? "day" : "week"}, by status</caption>
                <thead>
                  <tr>
                    <th scope="col" className="py-1 font-medium text-ink">
                      {daily ? "Day" : "Week of"}
                    </th>
                    {STATUSES.map(({ value, label }) => (
                      <th key={value} scope="col" className="py-1 text-right font-medium text-ink">
                        {label}
                      </th>
                    ))}
                    <th scope="col" className="py-1 text-right font-medium text-ink">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week) => (
                    <tr key={week.start.toISOString()} className="border-t border-line">
                      <th scope="row" className="py-1 font-normal">
                        {daily ? long(week.start) : formatShortDate(week.start)}
                      </th>
                      {STATUSES.map(({ value }) => (
                        <td key={value} className="py-1 text-right text-ink">
                          {week.counts[value]}
                        </td>
                      ))}
                      <td className="py-1 text-right font-medium text-ink">{total(week)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
