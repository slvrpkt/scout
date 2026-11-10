import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { buttonClassName } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import type { ApplicationStatus } from "@/generated/prisma/enums";
import { DASHBOARD_PERIODS, DEFAULT_QUIET_DAYS, type DashboardFigures, type DashboardPeriod } from "@/lib/dashboard";
import type { DayPeriod } from "@/lib/greeting";
import { STATUSES } from "@/lib/status";

import { ActivityChart } from "./activity-chart";
import { FunnelChart } from "./funnel-chart";
import { Greeting } from "./greeting";
import { PeriodFilter, PeriodScoped } from "./period-filter";
import { QuietDays } from "./quiet-days";

const card = "flex flex-col rounded-panel border border-line-card bg-card";
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The dashboard (DSH-1 to DSH-6): the funnel, where things stand, what's worth a look, and the calendar. */
export function Dashboard({
  figures,
  firstName,
  period,
  range = "all",
  quietDays = DEFAULT_QUIET_DAYS,
  empty,
  profileStarted = true,
  calendar,
}: {
  figures: DashboardFigures;
  firstName: string;
  period: DayPeriod;
  /** The time filter (E9-8). */
  range?: DashboardPeriod;
  /** Days without news before a follow-up is suggested (E9-9). */
  quietDays?: number;
  /** No applications at all yet. */
  empty: boolean;
  /** Whether the profile has anything in it yet, so the welcome only points there when it doesn't. */
  profileStarted?: boolean;
  /** The calendar (E15-6), which the time filter doesn't scope. */
  calendar?: ReactNode;
}) {
  const { sent, heardBack } = figures;
  // The summary follows the time filter, so it says which period it covers.
  const label = DASHBOARD_PERIODS.find((entry) => entry.value === range)?.label;
  // "This week", "Last week", "In the last 30 days"; nothing for all time.
  const within = range === "all" || !label ? null : range === "week" || range === "lastweek" ? label : `In the ${label.toLowerCase()}`;
  return (
    <>
      <PageHeader
        title={<Greeting name={firstName} serverPeriod={period} />}
        description={
          sent > 0
            ? `${within ? `${within} you've` : "You've"} applied to ${plural(sent, "job", "jobs")} and heard back from ${heardBack}. That's a solid run. Keep it going.`
            : within
              ? `You haven't applied to anything ${within.startsWith("In the") ? within.replace("In the", "in the") : within.toLowerCase()}, so there's nothing to show for this period.`
              : "Nothing to show yet: the dashboard fills in once you start applying."
        }
        actions={
          <Link href="/new?fresh=1" className={buttonClassName("primary", "md", "hover:text-on-primary")}>
            + New application
          </Link>
        }
      />

      {empty ? (
        // Nothing to line the calendar up with yet: it keeps its own height.
        <Columns calendar={calendar} natural>
          <Welcome profileStarted={profileStarted} />
        </Columns>
      ) : (
        <PeriodFilter period={range}>
          <Columns
            calendar={calendar}
            after={
              <PeriodScoped>
                <WorthALook items={figures.attention} quietDays={quietDays} />
              </PeriodScoped>
            }
          >
            <PeriodScoped className="grid max-w-[1200px] grid-cols-1 items-start gap-5">
              <Funnel figures={figures} />
              <ActivityChart weeks={figures.weeks} unit={figures.activityUnit} title={label ?? "All time"} />
              <WhereThingsStand byStatus={figures.byStatus} />
            </PeriodScoped>
          </Columns>
        </PeriodFilter>
      )}
    </>
  );
}

/**
 * The cards, with the calendar beside them where there's room for both, and
 * `after` (Worth a look) in a row of its own across both. Where there isn't
 * room, everything stacks: the cards, the calendar, then `after`.
 */
function Columns({ calendar, after, natural = false, children }: { calendar?: ReactNode; after?: ReactNode; natural?: boolean; children: ReactNode }) {
  return (
    <div className="@container px-10 pb-[72px]">
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 @min-[1240px]:grid-cols-[minmax(0,1200px)_minmax(400px,1fr)] @min-[1240px]:items-stretch">
        {children}
        {calendar && (
          // Beside the cards, the calendar takes all the width left and exactly their height:
          // the top of Your funnel to the bottom of Where things stand. It scrolls inside.
          // With `natural` (no cards beside it yet), it keeps its own height instead.
          <div className={natural ? "min-w-0 @min-[780px]:max-w-[calc(50%-10px)] @min-[1240px]:max-w-none" : "min-w-0 @min-[780px]:max-w-[calc(50%-10px)] @min-[1240px]:relative @min-[1240px]:max-w-none"}>
            <div className={natural ? "flex flex-col" : "flex max-h-[720px] flex-col @min-[1240px]:absolute @min-[1240px]:inset-0 @min-[1240px]:max-h-none"}>{calendar}</div>
          </div>
        )}
        {after && <div className="col-span-full min-w-0">{after}</div>}
      </div>
    </div>
  );
}

/** "Your funnel" (DSH-2): how far every sent application got, closed ones included, as a Sankey diagram. */
function Funnel({ figures }: { figures: DashboardFigures }) {
  const { funnel, sent, heardBackPercent, reachedInterview } = figures;
  return (
    <section aria-labelledby="funnel-heading" className={`${card} col-span-full gap-6 p-7`}>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="funnel-heading" className="font-serif text-section">
            Your funnel
          </h2>
          <p className="text-control text-muted">How far each job you&apos;ve applied to has made it, and where the ones that stopped are now.</p>
        </div>
        <dl className="flex gap-7">
          <Figure value={String(sent)} label="sent" />
          <Figure value={heardBackPercent === null ? "None yet" : `${heardBackPercent}%`} label="heard back" />
          <Figure value={String(reachedInterview)} label="reached interview" />
        </dl>
      </div>
      <FunnelChart funnel={funnel} />
    </section>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col-reverse gap-0.5">
      <dt className="text-label text-muted">{label}</dt>
      <dd className="font-serif text-[32px] leading-none tabular-nums">{value}</dd>
    </div>
  );
}

/** "Where things stand" (DSH-4): every application by its status now. */
function WhereThingsStand({ byStatus }: { byStatus: Record<ApplicationStatus, number> }) {
  const present = STATUSES.filter(({ value }) => byStatus[value] > 0);
  return (
    <section aria-labelledby="standing-heading" className={`${card} @container/standing gap-[18px] px-7 py-[26px]`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="standing-heading" className="text-[15px] font-medium">
          Where things stand
        </h2>
        <Link href="/applications?view=board" className="text-meta text-muted underline underline-offset-3 hover:text-ink">
          Open board
        </Link>
      </div>
      {/* The legend below says the same in words. */}
      <div aria-hidden="true" className="flex h-3 gap-0.5 overflow-hidden rounded-[6px] bg-hover">
        {present.map(({ value, color }) => (
          <span key={value} style={{ flex: byStatus[value], backgroundColor: color }} />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-8 gap-y-1 @min-[700px]/standing:grid-cols-4">
        {STATUSES.map(({ value, label }) => (
          <li key={value} className={`flex items-center gap-[9px] py-1.5 text-sm ${byStatus[value] > 0 ? "text-ink" : "text-muted"}`}>
            <StatusDot status={value} />
            <span className="flex-1">{label}</span>
            <span className="tabular-nums">{byStatus[value]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Worth a look" (DSH-5): offers, drafts, quiet applications and interviews. */
function WorthALook({ items, quietDays }: { items: DashboardFigures["attention"]; quietDays: number }) {
  return (
    // Across the whole page, under the cards and the calendar; wide, its items sit in columns.
    <section aria-labelledby="attention-heading" className={`${card} @container/attention px-7 pt-[26px] pb-3.5`}>
      <div className="flex items-baseline justify-between gap-3 pb-3">
        <h2 id="attention-heading" className="text-[15px] font-medium">
          Worth a look
        </h2>
        {items.length > 0 && <span className="text-meta text-muted">{plural(items.length, "thing", "things")}</span>}
      </div>
      {items.length === 0 ? (
        <p className="border-t border-line py-5 text-sm text-muted">All caught up. Nice.</p>
      ) : (
        <ul className="grid gap-x-6 @min-[760px]/attention:grid-cols-2 @min-[1180px]/attention:grid-cols-3">
          {items.map((item) => (
            <li key={item.id} className="-mx-2.5 border-t border-line">
              <Link href={`/applications/${item.id}${item.tab ? `?tab=${item.tab}` : ""}`} className="flex items-start gap-3 rounded-control px-2.5 py-[13px] text-ink hover:bg-hover">
                <StatusDot status={item.status} className="mt-1.5" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-field font-medium">
                    {[item.company, item.role].filter(Boolean).join(", ")}
                    {item.soon && <span className="ml-2 rounded-[6px] bg-warning-surface px-2 py-[3px] align-[1px] text-xs font-normal text-warning">Soon</span>}
                  </span>
                  <span className="text-meta leading-[1.45] text-muted">{item.reason}</span>
                </span>
                <span className="mt-px flex-none text-meta text-muted">{item.action} →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <QuietDays days={quietDays} />
    </section>
  );
}

/** Before the first application: what this page is for, and where to begin. */
function Welcome({ profileStarted }: { profileStarted: boolean }) {
  return (
    <Panel>
      <h2 className="font-serif text-section">Your dashboard</h2>
      <p className="text-sm text-muted">
        Once you start applying, this page shows how your search is going: your funnel (how far each application got), your activity week by
        week, where every application stands, what&apos;s worth a look next, and your interviews and deadlines on the calendar.
      </p>
      {profileStarted ? (
        <p className="text-sm text-muted">To start an application, use + New application at the top right of this page.</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            If you haven&apos;t filled in your profile yet, start there: every tailored resume and cover letter is built from it. To start an
            application, use + New application at the top right.
          </p>
          <Link href="/profile" className={buttonClassName("secondary")}>
            Fill in your profile
          </Link>
        </>
      )}
    </Panel>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className={`${card} max-w-[640px] items-start gap-3 p-7`}>{children}</div>;
}
