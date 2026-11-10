import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { changeStatus } from "@/components/change-status";
import type { ApplicationRow } from "@/lib/applications-data";
import { DEFAULT_SORT } from "@/lib/applications-list";

import { ApplicationsScreen } from "./applications-screen";

vi.mock("./actions", () => ({ rememberListView: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => null }));
vi.mock("@/components/change-status", () => ({ changeStatus: vi.fn(async () => true) }));

const row = (id: string, extra: Partial<ApplicationRow> = {}): ApplicationRow => ({
  id,
  company: "Ledgerly",
  role: "Senior Product Designer",
  location: "Amsterdam",
  mode: "Hybrid",
  status: "SENT",
  archived: false,
  deadline: null,
  match: { hit: 5, total: 7 },
  sent: "20 Sep",
  updated: "2 days ago",
  updatedAt: Date.UTC(2026, 8, 26),
  resume: null,
  posted: null,
  created: "15 Sep",
  employer: { type: null, chosen: null, auto: true },
  latestEvent: null,
  appliedVia: { value: null, auto: true },
  thingsToNote: "",
  salary: "",
  postingUrl: "",
  hasPosting: false,
  driveLinks: { documents: null, posting: null },
  manual: false,
  ...extra,
});

const rows = [
  row("kestrel", { company: "Kestrel Maps", role: "Product Designer, Mobile", updatedAt: Date.UTC(2026, 8, 20), updated: "8 days ago", match: null }),
  row("meridian", { company: "Meridian Bank", role: "Product Designer, Onboarding", location: "", mode: "Remote" }),
  row("brightline", { company: "Brightline Transit", status: "DRAFT", deadline: "3 Oct 2026" }),
  row("oaken", { company: "Oaken Studio", status: "OFFER" }),
];
const params = { view: "board" as const, filter: "all" as const, q: "", sort: DEFAULT_SORT, archived: false };
const open = (extra = {}) =>
  render(<ApplicationsScreen params={params} rows={rows} counts={{ all: 4, active: 4, closed: 0 }} summary="4 applications" empty={false} archivedCount={0} {...extra} />);
const column = (name: string) => screen.getByRole("region", { name: new RegExp(`^${name} `) });

beforeEach(() => vi.mocked(changeStatus).mockClear());

describe("the board (E9-2)", () => {
  it("has a column per status in the filter, with counts", () => {
    open();
    expect(screen.getAllByRole("region").map((region) => region.getAttribute("aria-labelledby"))).toEqual([
      "board-DRAFT",
      "board-SENT",
      "board-SCREENING",
      "board-INTERVIEW",
      "board-OFFER",
      "board-ACCEPTED",
      "board-REJECTED",
      "board-DECLINED",
    ]);
    expect(column("Applied")).toHaveAccessibleName("Applied 2 applications");
    expect(within(column("Screening")).getByText("Nothing here yet")).toBeInTheDocument();
  });

  it("shows only the filter's columns", () => {
    open({ params: { ...params, filter: "closed" }, rows: [] });
    expect(screen.getByText("Nothing in this view yet.")).toBeInTheDocument();
    open({ params: { ...params, filter: "closed" }, rows: [row("q", { status: "DECLINED" })] });
    expect(screen.getAllByRole("region")).toHaveLength(3);
  });

  it("puts the latest update first, with each card's details", () => {
    open();
    const cards = within(column("Applied")).getAllByRole("listitem");
    expect(cards.map((card) => within(card).getByRole("link").textContent)).toEqual(["Product Designer, Onboarding", "Product Designer, Mobile"]);
    expect(cards[0]).toHaveTextContent("Meridian BankProduct Designer, OnboardingRemoteCreated 15 Sep5/7 match2 days ago");
    expect(cards[1]).toHaveTextContent("Kestrel MapsProduct Designer, MobileAmsterdam · HybridCreated 15 SepNot matched8 days ago");
    expect(within(cards[0]).getByRole("link")).toHaveAttribute("href", "/applications/meridian");
  });

  it("shows when the job was posted, in green, and its deadline, in red", () => {
    open({ rows: [row("posted", { posted: "28 Oct", deadline: "21 Nov 2026" })] });
    expect(screen.getByText("Posted 28 Oct")).toHaveClass("bg-success-surface", "text-success");
    expect(screen.getByText("Apply by 21 Nov 2026")).toHaveClass("bg-danger-surface", "text-danger");
    expect(screen.queryByText(/^Created/)).not.toBeInTheDocument();
  });

  it("flags a draft's deadline", () => {
    open();
    expect(within(column("New")).getByText("Apply by 3 Oct 2026")).toBeInTheDocument();
    expect(within(column("Applied")).queryByText(/^Apply by/)).not.toBeInTheDocument();
  });

  it("moves a card from its Move to menu, showing it in the new column at once", async () => {
    const user = userEvent.setup();
    let finish: (moved: boolean) => void = () => {};
    vi.mocked(changeStatus).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    open();
    await user.click(screen.getByRole("button", { name: "Actions for Product Designer, Mobile, Kestrel Maps" }));
    await user.click(screen.getByRole("menuitemradio", { name: /Interview/ }));

    expect(changeStatus).toHaveBeenCalledWith("kestrel", "INTERVIEW");
    expect(within(column("Interview")).getByText("Kestrel Maps")).toBeInTheDocument();
    expect(within(column("Applied")).queryByText("Kestrel Maps")).not.toBeInTheDocument();
    finish(true);
  });
});

describe("downloading a card's resume", () => {
  it("has a Download button on cards with a resume, not on the others", () => {
    open({ rows: [row("sent", { resume: { href: "/api/pdf?doc=sent&sent=s1", sent: true } }), row("none", { status: "DRAFT" })] });
    expect(screen.getByRole("link", { name: "Download the resume and cover letter you applied with, for Senior Product Designer at Ledgerly" })).toHaveAttribute("href", "/api/pdf?doc=sent&sent=s1");
    expect(screen.getAllByRole("link", { name: /resume and cover letter/ })).toHaveLength(1);
  });

});
