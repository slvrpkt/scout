import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { changeStatus } from "@/components/change-status";
import type { ApplicationRow } from "@/lib/applications-data";
import { DEFAULT_SORT, type ListParams } from "@/lib/applications-list";

import { ApplicationsScreen } from "./applications-screen";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("./actions", () => ({ rememberListView: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => null }));
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
const rows = [row("kestrel", { company: "Kestrel Maps", role: "Product Designer, Mobile", match: null }), row("draft", { status: "DRAFT", sent: null, location: "" })];
const params: ListParams = { view: "table", filter: "all", q: "", sort: DEFAULT_SORT, archived: false };
const open = (extra: Partial<ListParams> = {}) =>
  render(<ApplicationsScreen params={{ ...params, ...extra }} rows={rows} counts={{ all: 2, active: 2, closed: 0 }} summary="2 applications" empty={false} archivedCount={0} />);

beforeEach(() => {
  router.push.mockClear();
  vi.mocked(changeStatus).mockClear();
});

describe("the table (E9-3)", () => {
  it("downloads each row's resume without opening it: the copy sent, else the tailored one", () => {
    render(
      <ApplicationsScreen
        params={params}
        rows={[
          row("sent", { resume: { href: "/api/pdf?doc=sent&sent=s1", sent: true } }),
          row("draft", { status: "DRAFT", sent: null, resume: { href: "/api/pdf?doc=resume&application=draft", sent: false } }),
          row("none", { status: "DRAFT", sent: null }),
        ]}
        counts={{ all: 3, active: 3, closed: 0 }}
        summary="3 applications"
        empty={false}
        archivedCount={0}
      />,
    );
    const [sent, draft, none] = screen.getAllByRole("row").slice(1);
    expect(within(sent).getByRole("link", { name: "Download the resume and cover letter you applied with, for Senior Product Designer at Ledgerly" })).toHaveAttribute("href", "/api/pdf?doc=sent&sent=s1");
    expect(within(draft).getByRole("link", { name: /Download the tailored resume and cover letter/ })).toHaveAttribute("href", "/api/pdf?doc=resume&application=draft");
    expect(within(none).queryByRole("link", { name: /resume and cover letter/ })).not.toBeInTheDocument();
  });

  it("has the columns, sorted by the latest update", () => {
    open();
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Company",
      "Role",
      "Salary",
      "Location",
      "Things To Note",
      "Applied Using",
      "Status",
      "Match",
      "Applied",
      "Resume & Cover Letter",
      "Job Description",
      "Activity",
      "Updated ↓",
      "Actions",
    ]);
    expect(screen.getByRole("columnheader", { name: /Updated/ })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByText("Click a row to open it")).toBeInTheDocument();
  });

  it("shows each row's own status, match, location and dates", () => {
    open();
    const [kestrel, draft] = screen.getAllByRole("row").slice(1);
    expect(within(kestrel).getByRole("combobox", { name: "Status of Product Designer, Mobile, Kestrel Maps" })).toHaveValue("SENT");
    expect(within(draft).getByRole("combobox", { name: /^Status of/ })).toHaveValue("DRAFT");
    const text = (row: HTMLElement) => within(row).getAllByRole("cell").map((cell) => cell.textContent);
    const [company, role, salary, location, notes, , , match, applied, resume, posting, activity, updated] = text(kestrel);
    expect([company, role, salary, location, notes]).toEqual(["Kestrel Maps", "Product Designer, MobileCreated 15 Sep", "Not listed", "Amsterdam", "Add a note about Product Designer, Mobile at Kestrel Maps"]);
    expect([match, applied, resume, posting, activity, updated]).toEqual(["Not matched", "20 Sep", "–", "–", "Add event for Product Designer, Mobile at Kestrel Maps", "2 days ago"]);
    const cells = text(draft);
    expect([cells[3], cells[7], cells[8]]).toEqual(["Not given", "5/7", "Not applied"]);
  });

  it("sorts by a column, and reverses on a second click", async () => {
    const user = userEvent.setup();
    const { unmount } = open();
    await user.click(screen.getByRole("button", { name: "Match" }));
    expect(router.push).toHaveBeenLastCalledWith("/applications?view=table&sort=match", { scroll: false });
    unmount();

    open({ sort: { key: "match", reversed: false } });
    expect(screen.getByRole("columnheader", { name: /Match/ })).toHaveAttribute("aria-sort", "descending");
    await user.click(screen.getByRole("button", { name: "Match" }));
    expect(router.push).toHaveBeenLastCalledWith("/applications?view=table&sort=-match", { scroll: false });
  });

  it("names A to Z ascending", () => {
    open({ sort: { key: "role", reversed: false } });
    expect(screen.getByRole("columnheader", { name: /Role/ })).toHaveAttribute("aria-sort", "ascending");
  });

  it("opens a row on click, but not from its status select", async () => {
    const user = userEvent.setup();
    open();
    const [kestrel] = screen.getAllByRole("row").slice(1);
    await user.selectOptions(within(kestrel).getByRole("combobox", { name: /^Status of/ }), "INTERVIEW");
    expect(changeStatus).toHaveBeenCalledWith("kestrel", "INTERVIEW");
    expect(router.push).not.toHaveBeenCalled();

    await user.click(within(kestrel).getAllByRole("cell")[3]);
    expect(router.push).toHaveBeenCalledWith("/applications/kestrel");
    expect(within(kestrel).getByRole("link", { name: "Product Designer, Mobile" })).toHaveAttribute("href", "/applications/kestrel");
  });
});
