import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CalendarItem } from "@/lib/calendar-view";

import { CalendarCard } from "./calendar-card";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
// Outside the app router, next/link never calls onNavigate; this one does, as the app router's does on a plain click.
vi.mock("next/link", () => ({
  default: ({ onNavigate, ...props }: ComponentProps<"a"> & { onNavigate?: (event: { preventDefault: () => void }) => void }) => (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onNavigate?.({ preventDefault: () => {} });
      }}
    />
  ),
}));

const items: CalendarItem[] = [
  { id: "nw", title: "Interview · Product Designer · Northwind", kind: "interview", href: "/applications/nw", external: false, allDay: false, start: new Date("2026-10-20T10:00:00Z"), end: new Date("2026-10-20T10:45:00Z") },
  { id: "dentist", title: "Dentist", kind: "event", href: "https://calendar.google.com/event?eid=dentist", external: true, allDay: false, start: new Date("2026-10-23T13:00:00Z"), end: new Date("2026-10-23T13:30:00Z") },
  { id: "trip", title: "Trip", kind: "event", href: null, external: false, allDay: true, startDay: "2026-10-24", endDay: "2026-10-26" },
  { id: "workshop", title: "Workshop", kind: "event", href: null, external: false, allDay: false, start: new Date("2026-11-03T09:00:00Z"), end: new Date("2026-11-03T10:00:00Z") },
];
const props: ComponentProps<typeof CalendarCard> = {
  month: "2026-10-20",
  today: "2026-10-20",
  start: "2026-10-20",
  items,
  timeZone: "Europe/Berlin",
  source: { status: "google" },
  links: { previous: "/?date=2026-09-01", next: "/?date=2026-11-01", today: "/" },
  personal: true,
};
const agendaDays = () => screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);

describe("the dashboard's calendar (E15-6)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks the month's days that have something on, in words too", () => {
    render(<CalendarCard {...props} />);
    const month = screen.getByRole("group", { name: "October 2026" });
    // The whole weeks the month touches, from Monday 28 September.
    expect(within(month).getAllByRole("button")).toHaveLength(35);
    const today = within(month).getByRole("button", { name: "Tuesday 20 October, 1 job event" });
    expect(today).toHaveAttribute("aria-current", "date");
    expect(today).toHaveAttribute("aria-pressed", "true");
    expect(within(month).getByRole("button", { name: "Saturday 24 October, 1 event" })).toHaveAttribute("aria-pressed", "false");
    expect(within(month).getByRole("button", { name: "Wednesday 21 October" })).toBeInTheDocument();
    expect(screen.queryByText(/In your time zone/)).not.toBeInTheDocument();
  });

  it("lists three days from today: interviews open their application, events Google Calendar", async () => {
    const user = userEvent.setup();
    render(<CalendarCard {...props} />);
    expect(agendaDays()).toEqual(["Today · Tue 20 Oct"]);
    expect(screen.getByRole("link", { name: "12:00–12:45 Interview · Product Designer · Northwind" })).toHaveAttribute("href", "/applications/nw");
    await user.click(screen.getByRole("button", { name: /^Friday 23 October/ }));
    expect(agendaDays()).toEqual(["Fri 23 Oct", "Sat 24 Oct", "Sun 25 Oct"]);
    const dentist = screen.getByRole("link", { name: /^15:00–15:30 Dentist/ });
    expect(dentist).toHaveAttribute("href", "https://calendar.google.com/event?eid=dentist");
    expect(dentist).toHaveAttribute("target", "_blank");
    expect(screen.getAllByText("Trip")).toHaveLength(2);
    expect(screen.queryByText("Workshop")).not.toBeInTheDocument();
  });

  it("has no Today link while today is picked", () => {
    render(<CalendarCard {...props} />);
    expect(screen.queryByRole("link", { name: "Today" })).not.toBeInTheDocument();
  });

  it("lists the week from the day picked, and back from today", async () => {
    const user = userEvent.setup();
    render(<CalendarCard {...props} />);
    await user.click(screen.getByRole("button", { name: "Sunday 1 November" }));
    expect(screen.getByRole("button", { name: "Sunday 1 November" })).toHaveAttribute("aria-pressed", "true");
    expect(agendaDays()).toEqual(["Tue 3 Nov"]);
    expect(screen.getByText("Workshop")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Monday 26 October" }));
    expect(screen.getByText("Nothing from Mon 26 Oct to Wed 28 Oct.")).toBeInTheDocument();

    // Today's month is on show, so it's picked without loading anything.
    await user.click(screen.getByRole("link", { name: "Today" }));
    expect(agendaDays()[0]).toBe("Today · Tue 20 Oct");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("moves through the days with the arrow keys, one of them in the tab order", async () => {
    const user = userEvent.setup();
    render(<CalendarCard {...props} />);
    const month = screen.getByRole("group", { name: "October 2026" });
    expect(within(month).getAllByRole("button").filter((button) => button.tabIndex === 0)).toEqual([within(month).getByRole("button", { name: /^Tuesday 20 October/ })]);
    await user.click(within(month).getByRole("button", { name: /^Tuesday 20 October/ }));
    await user.keyboard("{ArrowRight}");
    expect(within(month).getByRole("button", { name: "Wednesday 21 October" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    const picked = within(month).getByRole("button", { name: "Wednesday 28 October" });
    expect(picked).toHaveFocus();
    expect(picked).toHaveAttribute("aria-pressed", "true");
    expect(picked.tabIndex).toBe(0);
    expect(screen.getByText("Nothing from Wed 28 Oct to Fri 30 Oct.")).toBeInTheDocument();
  });

  it("loads the month before or after in place", async () => {
    const user = userEvent.setup();
    render(<CalendarCard {...props} />);
    expect(screen.getByRole("link", { name: "Previous month" })).toHaveAttribute("href", "/?date=2026-09-01");
    await user.click(screen.getByRole("link", { name: "Next month" }));
    expect(router.push).toHaveBeenCalledWith("/?date=2026-11-01", { scroll: false });
  });

  it("starts on the day asked for, in another month", () => {
    render(<CalendarCard {...props} month="2026-11-01" start="2026-11-01" />);
    expect(screen.getByRole("group", { name: "November 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sunday 1 November" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("href", "/");
  });

  it("says why only interviews show, and where to change that", () => {
    const { rerender } = render(<CalendarCard {...props} items={[]} source={{ status: "not-connected" }} />);
    expect(screen.getByText("Nothing from Tue 20 Oct to Thu 22 Oct.")).toBeInTheDocument();
    expect(screen.getByText(/Connect Google Calendar in Settings → Google/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings → Google" })).toHaveAttribute("href", "/settings?section=google");
    rerender(<CalendarCard {...props} source={{ status: "no-permission" }} />);
    expect(screen.getByText(/Scout may not use your calendar yet/)).toBeInTheDocument();
    rerender(<CalendarCard {...props} source={{ status: "failed", message: "Google had a problem with that." }} />);
    expect(screen.getByText("Your Google Calendar didn't load: Google had a problem with that.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Settings → Google" })).not.toBeInTheDocument();
  });
});

describe("job events and the month's tint", () => {
  it("shows a job event as a capsule in its stage's colour, and tints each month its own colour", () => {
    const job: CalendarItem = {
      id: "screen",
      title: "Phone screen",
      kind: "event",
      job: { stage: "screening", company: "Northwind" },
      href: "/applications/nw",
      external: false,
      allDay: false,
      start: new Date("2026-10-20T15:00:00Z"),
      end: new Date("2026-10-20T15:30:00Z"),
    };
    const { container, unmount } = render(<CalendarCard {...props} items={[job]} />);
    const capsule = screen.getByText("Phone screen");
    expect(capsule).toHaveClass("bg-job-screening", "text-white");
    expect(capsule).toHaveTextContent("Phone screen · Northwind (recruiter or screening)");
    const tint = (element: Element) => (element.querySelector("[style*='--color-month']") as HTMLElement).style.backgroundColor;
    expect(tint(container)).toBe("var(--color-month-10)");
    unmount();
    const { container: november } = render(<CalendarCard {...props} month="2026-11-01" items={[]} />);
    expect(tint(november)).toBe("var(--color-month-11)");
  });
});

describe("Personal Events and the encouraging line", () => {
  it("starts with personal events hidden on every visit, and shows them on request", async () => {
    const user = userEvent.setup();
    render(<CalendarCard {...props} personal={undefined} start="2026-10-23" />);
    expect(screen.queryByText("Dentist")).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Personal Events" }));
    expect(screen.getByText("Dentist")).toBeInTheDocument();
  });

  it("marks only the days with a job event", () => {
    render(<CalendarCard {...props} />);
    const month = screen.getByRole("group", { name: "October 2026" });
    const marks = (name: RegExp) => within(month).getByRole("button", { name }).querySelectorAll("[aria-hidden='true'] > span").length;
    expect(marks(/^Tuesday 20 October/)).toBe(1);
    expect(marks(/^Friday 23 October/)).toBe(0);
  });

  it("shows an encouraging line in the space the events leave", () => {
    render(<CalendarCard {...props} quote="Slow progress is still progress." />);
    // Opening and closing marks, right against the words.
    expect(screen.getByRole("blockquote")).toHaveTextContent(/^“Slow progress is still progress\.”$/);
  });
});
