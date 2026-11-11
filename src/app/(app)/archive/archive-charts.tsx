"use client";

import { ARCHIVE_REASONS } from "@/lib/agent/archive-reasons";
import type { ArchiveRow } from "@/lib/archive-data";

// The Archive at a glance, kept compact: archived records per week (Monday to
// Sunday) on the left, and everything in the Archive by why it was archived in
// a donut beside it.

/** The donut's slices, in a fixed order; their colors are validated for color blindness in light and dark. */
export const ARCHIVE_SLICES = [...ARCHIVE_REASONS.map((reason) => ({ id: reason.id as string, label: reason.label })), { id: "application", label: "Applications" }];
const SLICE_COLORS = ["--color-chart-1", "--color-chart-2", "--color-chart-3", "--color-chart-4", "--color-chart-5", "--color-chart-6", "--color-chart-7"];

/** The slice a row counts in: an archived application has its own. */
const sliceOf = (row: ArchiveRow) => (row.kind === "application" ? "application" : row.why);

/** How many weeks the bars show. */
export const WEEKS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight on the Monday that starts `date`'s week, in this browser's time zone. */
export function weekStart(date: Date): Date {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay(): Sunday is 0, so a Sunday belongs to the week that began six days before.
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

/** The last WEEKS weeks, oldest first, each with how many records were archived in it. */
export function weeklyCounts(rows: readonly ArchiveRow[], now: Date): { start: Date; count: number }[] {
  const latest = weekStart(now);
  const weeks = Array.from({ length: WEEKS }, (_, index) => {
    const start = new Date(latest);
    start.setDate(start.getDate() - (WEEKS - 1 - index) * 7);
    return { start, count: 0 };
  });
  for (const row of rows) {
    const start = weekStart(new Date(row.archivedAt)).getTime();
    // Half a day either way: a daylight saving change moves midnight by an hour.
    const week = weeks.find((entry) => Math.abs(entry.start.getTime() - start) < DAY_MS / 2);
    if (week) week.count += 1;
  }
  return weeks;
}

const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const number = (value: number) => value.toLocaleString("en-US");

export function ArchiveCharts({ rows, now }: { rows: readonly ArchiveRow[]; now: Date }) {
  const weeks = weeklyCounts(rows, now);
  const most = Math.max(1, ...weeks.map((week) => week.count));
  const slices = ARCHIVE_SLICES.map((slice, index) => ({ ...slice, color: `var(${SLICE_COLORS[index]})`, count: rows.filter((row) => sliceOf(row) === slice.id).length }));
  const total = rows.length;

  // The donut: a ring of arcs with a 2px gap between them, the total in the middle.
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const shown = slices.filter((slice) => slice.count > 0);
  const gap = shown.length > 1 ? 2 : 0;
  const lengths = shown.map((slice) => (slice.count / total) * circumference);
  // Each arc starts where the ones before it end.
  const arcs = shown.map((slice, index) => ({
    ...slice,
    dash: `${Math.max(0, lengths[index] - gap)} ${circumference}`,
    offset: -lengths.slice(0, index).reduce((sum, length) => sum + length, 0),
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section aria-labelledby="archive-weekly" className="flex flex-col gap-2 rounded-panel border border-line-card bg-card px-5 py-4">
        <h2 id="archive-weekly" className="text-sm font-medium text-ink">
          Archived records per week <span className="font-normal text-muted">· Monday to Sunday, the last {WEEKS} weeks</span>
        </h2>
        <svg
          viewBox={`0 0 ${WEEKS * 30} 112`}
          role="img"
          aria-label={`Archived records per week: ${weeks.map((week) => `week of ${SHORT.format(week.start)} ${week.count}`).join(", ")}`}
          className="h-32 w-full"
        >
          <line x1="0" y1="92" x2={WEEKS * 30} y2="92" stroke="var(--color-line)" strokeWidth="1" />
          {weeks.map((week, index) => {
            const height = week.count === 0 ? 0 : Math.max(3, (week.count / most) * 74);
            return (
              <g key={week.start.toISOString()}>
                <title>{`Week of ${SHORT.format(week.start)}: ${week.count} archived`}</title>
                {/* A bigger target than the bar, for the hover. */}
                <rect x={index * 30} y="0" width="30" height="92" fill="transparent" />
                <rect x={index * 30 + 7} y={92 - height} width="16" height={height} rx="3" fill="var(--color-status-sent)" />
                {week.count > 0 && (index === WEEKS - 1 || week.count === most) && (
                  <text x={index * 30 + 15} y={92 - height - 4} textAnchor="middle" className="fill-ink text-[10px]">
                    {week.count}
                  </text>
                )}
                {(WEEKS - 1 - index) % 3 === 0 && (
                  <text x={index * 30 + 15} y="107" textAnchor="middle" className="fill-muted text-[9px]">
                    {SHORT.format(week.start)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </section>

      <section aria-labelledby="archive-reasons" className="flex flex-col gap-2 rounded-panel border border-line-card bg-card px-5 py-4">
        <h2 id="archive-reasons" className="text-sm font-medium text-ink">
          All archived records by reason <span className="font-normal text-muted">· everything in the Archive</span>
        </h2>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <svg viewBox="0 0 180 180" role="img" aria-label={`${total} archived records: ${slices.map((slice) => `${slice.label} ${slice.count}`).join(", ")}`} className="size-32 flex-none">
            <circle cx="90" cy="90" r={radius} fill="none" stroke="var(--color-track)" strokeWidth="24" />
            <g transform="rotate(-90 90 90)">
              {arcs.map((arc) => (
                <circle key={arc.id} cx="90" cy="90" r={radius} fill="none" stroke={arc.color} strokeWidth="24" strokeDasharray={arc.dash} strokeDashoffset={arc.offset}>
                  <title>{`${arc.label}: ${arc.count}`}</title>
                </circle>
              ))}
            </g>
            <text x="90" y="96" textAnchor="middle" className="fill-ink text-[34px] font-bold">
              {number(total)}
            </text>
          </svg>
          {/* The legend names every slice with its count, so none depends on its color alone. */}
          <ul aria-label="Archived records by reason" className="grid min-w-[200px] flex-1 grid-cols-1 gap-x-5 gap-y-1 text-meta sm:grid-cols-2">
            {slices.map((slice) => (
              <li key={slice.id} className="flex items-center gap-2">
                <span aria-hidden="true" className="size-2.5 flex-none rounded-full" style={{ background: slice.color }} />
                <span className="flex-1 text-ink">{slice.label}</span>
                <span className="text-muted tabular-nums">{number(slice.count)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
