import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ApplicationStatus } from "@/generated/prisma/enums";
import type { WeekActivity } from "@/lib/dashboard";

import { ActivityChart } from "./activity-chart";

const none: Record<ApplicationStatus, number> = { DRAFT: 0, SENT: 0, SCREENING: 0, INTERVIEW: 0, OFFER: 0, ACCEPTED: 0, REJECTED: 0, DECLINED: 0 };
const week = (day: number, counts: Partial<Record<ApplicationStatus, number>>): WeekActivity => ({ start: new Date(2026, 8, day), counts: { ...none, ...counts } });
const weeks = [week(7, { DRAFT: 2 }), week(14, { DRAFT: 1, SENT: 2 }), week(21, { SENT: 3, SCREENING: 2, REJECTED: 1 }), week(28, {})];

describe("the activity chart (E9-8)", () => {
  it("sums up what happened in words, with a legend of every status", () => {
    render(<ActivityChart weeks={weeks} title="Last 30 days" />);
    const chart = screen.getByRole("region", { name: "Last 30 days, week by week" });
    expect(within(chart).getByText("11 things happened: 3 new applications, 5 applied, 2 screening calls, 1 rejected.")).toBeInTheDocument();
    expect(within(chart).getByRole("list", { name: "Legend" })).toHaveTextContent("NewAppliedScreeningInterviewOfferAcceptedRejectedDeclined");
  });

  it("stacks each week's statuses, to scale, with a tick under every week", () => {
    const { container } = render(<ActivityChart weeks={weeks} />);
    const columns = container.querySelectorAll("[aria-hidden='true'] .items-end > div");
    expect(columns).toHaveLength(4);
    const bar = (index: number) => columns[index].querySelector("span")!;
    expect(bar(2)).toHaveStyle({ height: "100%" });
    expect(bar(1)).toHaveStyle({ height: "50%" });
    expect([...bar(2).querySelectorAll("[data-status]")].map((slice) => slice.getAttribute("data-status"))).toEqual(["SENT", "SCREENING", "REJECTED"]);
    expect(container.querySelectorAll("[data-tick]")).toHaveLength(4);

    fireEvent.pointerEnter(columns[2]);
    expect(columns[2]).toHaveTextContent("Week of 21 Sep3 applied · 2 screening calls · 1 rejected");
    fireEvent.pointerLeave(columns[2]);
    expect(columns[2]).not.toHaveTextContent("Week of");
  });

  it("names a week's days", () => {
    const days = Array.from({ length: 7 }, (_, index) => week(28 + index, {}));
    render(<ActivityChart weeks={days} unit="day" title="This week" />);
    expect(screen.getByRole("heading", { name: "This week, day by day" })).toBeInTheDocument();
  });

  it("has the numbers as a table, a column per status", async () => {
    const user = userEvent.setup();
    render(<ActivityChart weeks={weeks} />);
    await user.click(screen.getByText("Show the numbers"));
    const table = screen.getByRole("table", { name: "What happened per week, by status" });
    const rows = within(table).getAllByRole("row").map((row) => row.textContent);
    expect(rows[0]).toBe("Week ofNewAppliedScreeningInterviewOfferAcceptedRejectedDeclinedTotal");
    expect(rows[3]).toBe("21 Sep032000106");
  });

  it("says so when there's nothing in the period", () => {
    render(<ActivityChart weeks={[]} />);
    expect(screen.getByText("Nothing to show yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Legend" })).not.toBeInTheDocument();
    expect(screen.queryByText("Show the numbers")).not.toBeInTheDocument();
  });
});
