import { ApplicationStatus, FunnelStage } from "@/generated/prisma/enums";
import { daysBetween, formatDateTime, formatDay, formatShortCalendarDate, formatTime } from "@/lib/dates";
import { FUNNEL_STAGES, STATUSES } from "@/lib/status";

// Every dashboard figure (E9-6, PRD §6.7 and §8), worked out on the server
// from the applications, so the dashboard only draws them.

/** What the dashboard needs to know about an application. */
export type DashboardApplication = {
  id: string;
  company: string;
  role: string;
  status: ApplicationStatus;
  furthestStage: FunnelStage | null;
  archived: boolean;
  /** Calendar date at UTC midnight. */
  deadline: Date | null;
  /** When its status last changed; null when it never did. */
  lastStatusChange: Date | null;
  sentAt: Date | null;
  /** The next interview, while in Interview (E9-9). */
  nextInterviewAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Where an application that went no further than a stage is now: still
 * open, rejected, declined, or archived while it was still open.
 */
export type FunnelOutcome = "open" | "rejected" | "declined" | "archived";
/** The outcomes, in the order the funnel draws them. */
export const FUNNEL_OUTCOMES: readonly FunnelOutcome[] = ["open", "rejected", "declined", "archived"];

export type FunnelStep = {
  stage: FunnelStage;
  count: number;
  /** Percent of the previous stage, rounded; null for Sent or when the previous stage is empty. */
  conversion: number | null;
  /**
   * The applications that got this far and no further, by outcome. Accepted
   * is the end of the funnel, so it has none: they all count as accepted.
   */
  stopped: Record<FunnelOutcome, number>;
};

export type AttentionItem = {
  id: string;
  company: string;
  role: string;
  status: ApplicationStatus;
  reason: string;
  action: "Review" | "Finish" | "Open" | "Answer";
  /** Where the item links to, when not the application's first tab. */
  tab?: "conversation";
  /** An interview today or tomorrow (E9-9). */
  soon?: boolean;
};

/** One bar of the activity chart (E9-8): what happened in a day or a week, by status. */
export type WeekActivity = {
  /** The day, or the Monday the week starts on, in the server's time zone. */
  start: Date;
  /** Applications created (New) and status changes, by the status moved to. */
  counts: Record<ApplicationStatus, number>;
};

/** A status change, for the activity chart. */
export type ActivityEvent = { to: ApplicationStatus; at: Date };

/** The dashboard's time filter (E9-8, DSH-7). */
export const DASHBOARD_PERIODS = [
  { value: "week", label: "This week", days: null },
  { value: "lastweek", label: "Last week", days: null },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "all", label: "All time", days: null },
] as const;

/** Whether the activity chart shows the period day by day (a week) or week by week. */
export type ActivityUnit = "day" | "week";

/**
 * A period's window: from `since` (null: the first application) up to
 * `until` (null: now). Weeks start on Monday, in the server's time zone.
 */
export function periodWindow(period: DashboardPeriod, now: Date): { since: number | null; until: number | null; unit: ActivityUnit } {
  const monday = weekStart(now);
  if (period === "week") return { since: monday.getTime(), until: null, unit: "day" };
  if (period === "lastweek") {
    const previous = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7);
    return { since: previous.getTime(), until: monday.getTime(), unit: "day" };
  }
  const days = DASHBOARD_PERIODS.find((entry) => entry.value === period)?.days ?? null;
  return { since: days === null ? null : now.getTime() - days * DAY_MS, until: null, unit: "week" };
}
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number]["value"];

/** "30d" from `?period=`, or null for anything else. */
export function periodFromParam(value: unknown): DashboardPeriod | null {
  return DASHBOARD_PERIODS.find((period) => period.value === value)?.value ?? null;
}

/** The activity chart shows at most a year of weeks. */
const MAX_WEEKS = 52;

export type DashboardFigures = {
  /** Every application, whatever the period: none at all means the welcome. */
  total: number;
  /** How many applications are in each status now, all eight. */
  byStatus: Record<ApplicationStatus, number>;
  /**
   * Sent → Accepted by the furthest stage reached, so closed applications
   * count where they got to (DSH-3), and how the ones that stopped ended.
   */
  funnel: FunnelStep[];
  sent: number;
  heardBack: number;
  /** Heard back ÷ sent, rounded; null before anything was sent. */
  heardBackPercent: number | null;
  reachedInterview: number;
  /** "Worth a look" (DSH-5), in priority order; always about now, whatever the period. */
  attention: AttentionItem[];
  /** The period's applications by the day or week they were started and sent, oldest first. */
  weeks: WeekActivity[];
  /** Whether `weeks` holds days (This week, Last week) or weeks. */
  activityUnit: ActivityUnit;
};

/** A Sent or Screening application quiet for this many days deserves a follow-up, unless the settings say otherwise (E9-9). */
export const DEFAULT_QUIET_DAYS = 7;
/** The choices for that threshold. */
export const QUIET_DAYS_CHOICES = [3, 5, 7, 10, 14, 21, 30] as const;

export type DashboardOptions = {
  period?: DashboardPeriod;
  /** Days without news before "Worth a look" suggests a follow-up. */
  quietDays?: number;
  /** Per application, replies from Gmail waiting for an answer (E15-3). */
  replies?: ReadonlyMap<string, { count: number; summary: string }>;
  /** The user's time zone, for interview dates; the server's when not given. */
  timeZone?: string;
  /** Every status change, for the activity chart. */
  events?: readonly ActivityEvent[];
};

const DAY_MS = 86_400_000;
const rank = (stage: FunnelStage | null) => (stage === null ? -1 : FUNNEL_STAGES.indexOf(stage));

/** A closed status says how it ended; an open one archived means it was let go (decided 16 October 2026). */
function outcome({ status, archived }: DashboardApplication): FunnelOutcome {
  if (status === ApplicationStatus.REJECTED) return "rejected";
  if (status === ApplicationStatus.DECLINED) return "declined";
  return archived ? "archived" : "open";
}

/**
 * Counts and the "Worth a look" list (decided 28 September 2026): archived
 * applications count in the funnel and the status breakdown, but aren't
 * worth a look. With a period (E9-8, decided 29 September 2026), the funnel
 * and the breakdown count the applications created in it.
 */
export function dashboardFigures(
  all: readonly DashboardApplication[],
  now = new Date(),
  { period = "all", quietDays = DEFAULT_QUIET_DAYS, timeZone, replies, events = [] }: DashboardOptions = {},
): DashboardFigures {
  const { since, until, unit } = periodWindow(period, now);
  const applications = all.filter(
    (application) => (since === null || application.createdAt.getTime() >= since) && (until === null || application.createdAt.getTime() < until),
  );

  const byStatus = Object.fromEntries(STATUSES.map(({ value }) => [value, 0])) as Record<ApplicationStatus, number>;
  for (const application of applications) byStatus[application.status] += 1;

  const reached = (stage: FunnelStage) => applications.filter((application) => rank(application.furthestStage) >= rank(stage)).length;
  const funnel = FUNNEL_STAGES.map((stage, index): FunnelStep => {
    const count = reached(stage);
    const previous = index > 0 ? reached(FUNNEL_STAGES[index - 1]) : 0;
    const stopped = Object.fromEntries(FUNNEL_OUTCOMES.map((key) => [key, 0])) as Record<FunnelOutcome, number>;
    if (index < FUNNEL_STAGES.length - 1) {
      for (const application of applications) if (application.furthestStage === stage) stopped[outcome(application)] += 1;
    }
    return { stage, count, conversion: index > 0 && previous > 0 ? Math.round((count / previous) * 100) : null, stopped };
  });
  const sent = reached(FunnelStage.SENT);
  const heardBack = reached(FunnelStage.SCREENING);

  return {
    total: all.length,
    byStatus,
    funnel,
    sent,
    heardBack,
    heardBackPercent: sent > 0 ? Math.round((heardBack / sent) * 100) : null,
    reachedInterview: reached(FunnelStage.INTERVIEW),
    attention: worthALook(all.filter((application) => !application.archived), now, { quietDays, timeZone, replies }),
    weeks: activity(applications, events, { unit, since, until }, now),
    activityUnit: unit,
  };
}

/** The Monday of a date's week, at midnight in the server's time zone. */
function weekStart(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

/** No status yet: the counts of a new bar. */
const noCounts = () => Object.fromEntries(STATUSES.map(({ value }) => [value, 0])) as Record<ApplicationStatus, number>;

/**
 * What happened in the period, bar by bar (E9-8): each application created
 * adds one to New, each status change one to the status it moved to. Days
 * for a week (Monday to Sunday, days to come empty), else weeks from the
 * period's start (or the first application's, for all time) to now, at most
 * a year.
 */
function activity(
  applications: readonly DashboardApplication[],
  events: readonly ActivityEvent[],
  { unit, since, until }: { unit: ActivityUnit; since: number | null; until: number | null },
  now: Date,
): WeekActivity[] {
  let starts: Date[];
  if (unit === "day") {
    const first = new Date(since!);
    starts = Array.from({ length: 7 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + index));
  } else {
    if (applications.length === 0 && events.length === 0) return [];
    const first = since ?? Math.min(...applications.map((application) => application.createdAt.getTime()), ...events.map((event) => event.at.getTime()));
    starts = [];
    for (let start = weekStart(new Date(first)); start <= now; start = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)) starts.push(start);
    starts = starts.slice(-MAX_WEEKS);
  }
  const step = unit === "day" ? 1 : 7;
  const last = starts.at(-1)!;
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + step).getTime();
  const bars: WeekActivity[] = starts.map((start) => ({ start, counts: noCounts() }));
  const add = (date: Date, status: ApplicationStatus) => {
    const time = date.getTime();
    if (time < starts[0].getTime() || time >= end || (until !== null && time >= until)) return;
    const index = bars.findLastIndex((bar) => bar.start.getTime() <= time);
    if (index >= 0) bars[index].counts[status] += 1;
  };
  for (const application of applications) add(application.createdAt, ApplicationStatus.DRAFT);
  for (const event of events) if (since === null || event.at.getTime() >= since) add(event.at, event.to);
  return bars;
}

/**
 * DSH-5, in this order: interviews today or tomorrow (E9-9); offers awaiting
 * a decision; drafts, soonest deadline first; Sent or Screening with no news
 * for `quietDays` or more, longest silence first; then the other interviews:
 * upcoming by date, then the ones whose date has passed, then those without
 * a date.
 */
function worthALook(
  applications: readonly DashboardApplication[],
  now: Date,
  { quietDays, timeZone, replies }: { quietDays: number; timeZone?: string; replies?: DashboardOptions["replies"] },
): AttentionItem[] {
  const item = (application: DashboardApplication, reason: string, action: AttentionItem["action"]): AttentionItem => ({
    id: application.id,
    company: application.company,
    role: application.role,
    status: application.status,
    reason,
    action,
  });
  const latestFirst = (a: DashboardApplication, b: DashboardApplication) => b.updatedAt.getTime() - a.updatedAt.getTime();
  const inStatus = (status: ApplicationStatus) => applications.filter((application) => application.status === status);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const silence = (application: DashboardApplication) =>
    Math.floor((now.getTime() - (application.lastStatusChange ?? application.sentAt ?? application.updatedAt).getTime()) / DAY_MS);

  const offers = inStatus(ApplicationStatus.OFFER)
    .sort(latestFirst)
    .map((application) => item(application, "An offer is waiting on your decision.", "Review"));

  const drafts = inStatus(ApplicationStatus.DRAFT)
    .sort((a, b) => (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity) || latestFirst(a, b))
    .map((application) => {
      const { deadline } = application;
      if (!deadline) return item(application, "Still a draft. Ready when you are.", "Finish");
      const date = formatShortCalendarDate(deadline, now);
      return item(
        application,
        deadline.getTime() < today ? `Still a draft, and the deadline was ${date}.` : `Still a draft, and applications close ${date}.`,
        "Finish",
      );
    });

  const quiet = applications
    .filter(
      (application) =>
        (application.status === ApplicationStatus.SENT || application.status === ApplicationStatus.SCREENING) &&
        silence(application) >= quietDays,
    )
    .sort((a, b) => silence(b) - silence(a))
    .map((application) =>
      item(application, `No news for ${silence(application)} days. A short, friendly follow-up could help.`, "Open"),
    );

  // Interviews by their date (E9-9, decided 29 September 2026).
  const interviewing = inStatus(ApplicationStatus.INTERVIEW);
  const at = (application: DashboardApplication) => application.nextInterviewAt!.getTime();
  const upcoming = interviewing
    .filter((application) => application.nextInterviewAt && at(application) >= now.getTime())
    .sort((a, b) => at(a) - at(b))
    .map((application) => {
      const date = application.nextInterviewAt!;
      const days = daysBetween(now, date, timeZone);
      const time = formatTime(date, timeZone);
      const when = days === 0 ? `today at ${time}` : days === 1 ? `tomorrow at ${time}` : `on ${formatDateTime(date, timeZone, now)}`;
      return { ...item(application, `Interview ${when}. Worth re-reading your tailored letter first.`, "Open"), soon: days <= 1 };
    });
  const past = interviewing
    .filter((application) => application.nextInterviewAt && at(application) < now.getTime())
    .sort((a, b) => at(b) - at(a))
    .map((application) => {
      const date = application.nextInterviewAt!;
      const when = daysBetween(date, now, timeZone) === 0 ? "earlier today" : `on ${formatDay(date, timeZone, now)}`;
      return item(application, `Your interview was ${when}. How did it go? Move it on, or add the next round's date.`, "Open");
    });
  const undated = interviewing
    .filter((application) => !application.nextInterviewAt)
    .sort(latestFirst)
    .map((application) => item(application, "You're interviewing. Add the next interview's date and it shows up here.", "Open"));

  // Replies waiting for an answer come first, in place of the application's other item (E15-3).
  const answering = applications.flatMap((application) => {
    const waiting = replies?.get(application.id);
    if (!waiting) return [];
    const reason = waiting.count === 1 ? `A reply is waiting: ${waiting.summary}` : `${waiting.count} replies are waiting. ${waiting.summary}`;
    return [{ ...item(application, reason, "Answer"), tab: "conversation" as const }];
  });
  const answered = new Set(answering.map((entry) => entry.id));
  const soon = upcoming.filter((entry) => entry.soon);
  const later = upcoming.filter((entry) => !entry.soon);
  return [...answering, ...[...soon, ...offers, ...drafts, ...quiet, ...later, ...past, ...undated].filter((entry) => !answered.has(entry.id))];
}
