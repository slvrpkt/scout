"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";

import { addDays, agenda, dayLabel, itemsOnDay, monthDays, monthTitle, shortDayLabel, startOfMonth, type CalendarItem, type Day, type JobStage } from "@/lib/calendar-view";
import { cn } from "@/lib/cn";
import type { CalendarSource } from "@/lib/google/calendar-data";

import { itemDot, ItemLink, itemTime } from "./calendar-item";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** The arrow keys move a day or a week through the month. */
const STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** How many days the list under the month covers: the day picked and the two after it. */
export const CARD_DAYS = 3;

/** The space, in pixels, the encouraging line needs under the events before it shows. */
const QUOTE_ROOM = 170;

/**
 * The dashboard's calendar (E15-6): a month on top with marks on the days
 * that have something on, and below it what's on from the day picked, today
 * at first, for three days. Job events stand out as capsules; Personal
 * Events off hides the rest. An encouraging line fills the space left.
 * Interviews open their application; other events open in Google Calendar.
 * Picking a day stays on the page; another month loads.
 */
export function CalendarCard({
  month,
  today,
  start,
  items,
  timeZone,
  source,
  links,
  personal: personalAtLoad = false,
  quote = null,
}: {
  /** The month on show, as a day in it. */
  month: Day;
  today: Day;
  /** The day picked at first. */
  start: Day;
  /** Everything from the month's first week through a week past its last. */
  items: CalendarItem[];
  timeZone: string;
  source: CalendarSource;
  links: { previous: string; next: string; today: string };
  /** Personal Events: whether events that aren't about a job show too; off on every visit. */
  personal?: boolean;
  /** An encouraging line for the space under the days' events. */
  quote?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picked, pick] = useState(start);
  const grid = useRef<HTMLDivElement>(null);
  const days = monthDays(month);
  const [personal, setPersonal] = useState(personalAtLoad);
  const shown = personal ? items : items.filter((item) => item.job || item.kind === "interview");
  const entries = agenda(shown, picked, timeZone, CARD_DAYS);
  // The line shows only while the days' events leave room for it. The room is
  // measured from the events alone, so showing the line can't change the
  // answer (which made it flicker on and off).
  const list = useRef<HTMLDivElement>(null);
  const events = useRef<HTMLDivElement>(null);
  const [roomy, setRoomy] = useState(true);
  useEffect(() => {
    const box = list.current;
    const taken = events.current;
    if (!box || !taken || typeof ResizeObserver === "undefined") return;
    // Without a layout (no height yet), assume there is room.
    const measure = () => setRoomy(box.clientHeight === 0 || box.clientHeight - taken.offsetHeight >= QUOTE_ROOM);
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(taken);
    measure();
    return () => observer.disconnect();
  }, []);

  // Another month, without scrolling the dashboard; dimmed until it's in.
  const load = (href: string) => startTransition(() => router.push(href, { scroll: false }));
  const onNavigate = (href: string) => (event: { preventDefault: () => void }) => {
    event.preventDefault();
    load(href);
  };

  function move(event: KeyboardEvent<HTMLDivElement>) {
    const step = STEPS[event.key];
    const from = (event.target as HTMLElement).dataset.day;
    const next = step && from ? days[days.indexOf(from) + step] : undefined;
    if (!next) return;
    event.preventDefault();
    pick(next);
    grid.current?.querySelector<HTMLElement>(`[data-day="${next}"]`)?.focus();
  }

  return (
    <section
      aria-labelledby="calendar-heading"
      aria-busy={pending || undefined}
      className={cn(
        "@container/calendar flex min-h-0 flex-1 flex-col gap-4 rounded-panel border border-line-card bg-card px-6 pt-[26px] pb-5",
        pending && "opacity-60 motion-safe:transition-opacity",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="calendar-heading" className="text-[15px] font-medium">
          Calendar
        </h2>
        <span className="flex items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-meta text-muted">
          <input
            type="checkbox"
            role="switch"
            checked={personal}
            onChange={(event) => {
              setPersonal(event.target.checked);
            }}
            className="peer sr-only"
          />
          <span aria-hidden="true" className="relative h-4 w-7 rounded-full bg-line-strong transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus">
            <span className={cn("absolute top-0.5 left-0.5 size-3 rounded-full bg-white transition-transform", personal && "translate-x-3")} />
          </span>
          Personal Events
        </label>
        {picked !== today && (
          <Link
            href={links.today}
            onNavigate={(event) => {
              // Today's month is already on show: no need to load it.
              if (month.slice(0, 7) !== today.slice(0, 7)) return onNavigate(links.today)(event);
              event.preventDefault();
              pick(today);
            }}
            className="text-meta text-muted underline underline-offset-3 hover:text-ink"
          >
            Today
          </Link>
        )}
        </span>
      </div>

      {/* The month on top, centred; the days' events below it. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Each month has its own tint, so flipping months is easy to follow. */}
      <div className="flex w-full flex-none flex-col gap-1.5 rounded-card p-2.5" style={{ backgroundColor: `var(--color-month-${Number(month.slice(5, 7))})` }}>
        {/* The month and year on a royal-navy band, so they stand out. */}
        <div className="flex items-center justify-between gap-2 rounded-control bg-[#162032] px-2 py-1.5 text-white">
          <Link
            href={links.previous}
            onNavigate={onNavigate(links.previous)}
            aria-label="Previous month"
            title="Previous month"
            className="grid size-8 place-items-center rounded-control text-white hover:bg-white/15 hover:text-white"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </Link>
          <p className="font-serif text-xl font-medium tracking-[0.01em]">{monthTitle(month)}</p>
          <Link
            href={links.next}
            onNavigate={onNavigate(links.next)}
            aria-label="Next month"
            title="Next month"
            className="grid size-8 place-items-center rounded-control text-white hover:bg-white/15 hover:text-white"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </Link>
        </div>
        {/* The days of the week, set apart from the dates. */}
        <div aria-hidden="true" className="grid grid-cols-7 border-b border-line-strong text-center text-[12px] font-semibold tracking-[0.06em] text-primary uppercase">
          {WEEKDAYS.map((weekday) => (
            <span key={weekday} className="py-1.5">
              {weekday}
            </span>
          ))}
        </div>
        {/* One day takes Tab, the arrow keys move between them. */}
        <div ref={grid} role="group" aria-label={monthTitle(month)} onKeyDown={move} className="grid grid-cols-7 gap-y-0.5">
          {days.map((day) => {
            const onDay = itemsOnDay(shown, day, timeZone);
            const interviews = onDay.filter((item) => item.kind === "interview" || item.job).length;
            const others = onDay.length - interviews;
            const stage = onDay.find((item) => item.job)?.job?.stage;
            const isPicked = day === picked;
            return (
              <button
                key={day}
                type="button"
                data-day={day}
                tabIndex={day === (days.includes(picked) ? picked : startOfMonth(month)) ? 0 : -1}
                aria-pressed={isPicked}
                aria-current={day === today ? "date" : undefined}
                aria-label={[dayLabel(day), interviews > 0 && plural(interviews, "job event", "job events"), others > 0 && plural(others, "event", "events")].filter(Boolean).join(", ")}
                onClick={() => pick(day)}
                className="flex flex-col items-center gap-0.5 rounded-control py-1 hover:bg-hover"
              >
                <span
                  className={cn(
                    "grid size-10 place-items-center rounded-full font-serif text-[18px] tabular-nums",
                    day.slice(0, 7) !== month.slice(0, 7) && "text-muted",
                    day === today ? "bg-primary text-on-primary" : isPicked && "ring-1 ring-ink",
                  )}
                >
                  {Number(day.slice(8))}
                </span>
                {/* What's on, which the label says in words: an interview, other events. */}
                <span aria-hidden="true" className="flex h-1.5 gap-0.5">
                  {interviews > 0 && <span className={cn("size-1.5 rounded-full", stage ? JOB_STYLES[stage].dot : "bg-primary")} />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div ref={list} className="flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto border-t border-line pt-4">
        <div ref={events} className="flex flex-none flex-col gap-4">
        {entries.length === 0 ? (
          <p className="text-sm text-muted">{`Nothing from ${shortDayLabel(picked)} to ${shortDayLabel(addDays(picked, CARD_DAYS - 1))}.`}</p>
        ) : (
          entries.map(({ day, items: onDay }) => (
            <div key={day} className="flex flex-col gap-1.5">
              <h3 className="text-meta text-muted">{agendaDay(day, today)}</h3>
              <ul className="-mx-2.5">
                {onDay.map((item) => (
                  <li key={item.id}>
                    <ItemLink item={item} className="flex items-start gap-3 px-2.5 py-1.5 text-control">
                      <span aria-hidden="true" className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", itemDot(item))} />
                      <span className="w-[84px] shrink-0 text-muted tabular-nums">{itemTime(item, timeZone)}</span>{" "}
                      {item.job ? (
                        // Part of a job search: a solid capsule in the stage's color.
                        <span className={cn("min-w-0 rounded-full px-2.5 py-0.5 font-medium break-words", JOB_STYLES[item.job.stage].capsule)}>
                          {item.title}
                          {item.job.company && !item.title.toLowerCase().includes(item.job.company.toLowerCase()) && <span className="font-normal opacity-85"> · {item.job.company}</span>}
                          <span className="sr-only"> ({JOB_STYLES[item.job.stage].label})</span>
                        </span>
                      ) : (
                        <span className={cn("min-w-0 break-words", item.kind === "interview" && "font-medium")}>{item.title}</span>
                      )}
                    </ItemLink>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
        </div>
        {/* Something kind for the space the events leave; gone when they need it. */}
        {quote && roomy && (
          // Centred in the space the events leave, big enough to fill most of it.
          // The quotation marks sit right against the words, opening and closing. The lines are
          // Scout's own, so there's no one to credit.
          <figure className="my-auto flex flex-col items-center px-6 py-6 text-center">
            <blockquote className="max-w-[560px] font-serif text-[clamp(1.4rem,2.2vw,2rem)] leading-snug text-pretty text-muted italic">
              <span aria-hidden="true" className="text-faint">&ldquo;</span>
              {quote}
              <span aria-hidden="true" className="text-faint">&rdquo;</span>
            </blockquote>
          </figure>
        )}
      </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-3 text-meta text-muted">
        <SourceNotice source={source} />
      </div>
    </section>
  );
}

/** A job event's capsule and mark by stage: navy for recruiter and screening calls, green for interview rounds, maroon for offers and finals. */
const JOB_STYLES: Record<JobStage, { capsule: string; dot: string; label: string }> = {
  screening: { capsule: "bg-job-screening text-white", dot: "bg-job-screening", label: "recruiter or screening" },
  interview: { capsule: "bg-job-interview text-white", dot: "bg-job-interview", label: "interview" },
  offer: { capsule: "bg-job-offer text-white", dot: "bg-job-offer", label: "offer or final round" },
};

/** "Today · Tue 20 Oct", "Tomorrow · Wed 21 Oct" or "Thu 22 Oct". */
function agendaDay(day: Day, today: Day) {
  const label = shortDayLabel(day);
  if (day === today) return `Today · ${label}`;
  if (day === addDays(today, 1)) return `Tomorrow · ${label}`;
  return label;
}

/** Why only interviews show, when Google Calendar isn't there. */
function SourceNotice({ source }: { source: CalendarSource }) {
  if (source.status === "google") return null;
  const text =
    source.status === "failed"
      ? `Your Google Calendar didn't load: ${source.message}`
      : source.status === "no-permission"
        ? "Scout may not use your calendar yet. Allow it in Settings → Google to see your other events here."
        : "Connect Google Calendar in Settings → Google to see your other events here, and keep interviews in step with it.";
  return (
    <p>
      {text}
      {source.status !== "failed" && (
        <>
          {" "}
          <Link href="/settings?section=google" className="inline-flex min-h-6 items-center font-medium text-ink underline underline-offset-2">
            Settings → Google
          </Link>
        </>
      )}
    </p>
  );
}
