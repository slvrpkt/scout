import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import { setArchived } from "@/lib/application-actions";
import type { ArchiveRow } from "@/lib/archive-data";

import { restoreAgentCandidate } from "../agent/actions";
import { ArchiveScreen } from "./archive-screen";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/archive" }));
vi.mock("../agent/actions", () => ({ restoreAgentCandidate: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/lib/application-actions", () => ({ setArchived: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const row = (id: string, patch: Partial<ArchiveRow> = {}): ArchiveRow => ({
  kind: "posting",
  id,
  archivedAt: new Date().toISOString(),
  title: `Job ${id}`,
  company: `Company ${id}`,
  location: "Rockville, MD",
  salary: "",
  pay: null,
  score: null,
  why: "title",
  note: "",
  foundBy: null,
  href: "",
  ...patch,
});
const titles = () => within(screen.getByRole("table")).getAllByRole("row").slice(1).map((tr) => within(tr).getAllByRole("cell")[1].textContent);

beforeEach(() => vi.clearAllMocks());

describe("ArchiveScreen", () => {
  it("lists 50 rows a page, sorts by a column's name, and filters", async () => {
    const user = userEvent.setup();
    render(<ArchiveScreen rows={Array.from({ length: 60 }, (_, index) => row(`p${index}`, { pay: index * 1000 }))} />);
    expect(titles()).toHaveLength(50);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(titles()).toHaveLength(10);
    await user.click(screen.getByRole("button", { name: "Salary" }));
    expect(titles()[0]).toBe("Job p59");
    await user.click(screen.getByRole("button", { name: /Salary/ }));
    expect(titles()[0]).toBe("Job p0");
    await user.type(screen.getByLabelText("Title"), "p42");
    expect(titles()).toEqual(["Job p42"]);
  });

  it("puts a posting back in Agentic job search, and an application back in the log, each with a link there", async () => {
    const user = userEvent.setup();
    render(<ArchiveScreen rows={[row("p1"), row("a1", { kind: "application", why: "you" })]} />);
    await user.click(screen.getByRole("button", { name: "Put back Job p1" }));
    expect(restoreAgentCandidate).toHaveBeenCalledWith({ id: "p1" });
    expect(toast).toHaveBeenCalledWith("Put back in Agentic job search.", expect.objectContaining({ action: expect.objectContaining({ label: "Open" }) }));
    vi.mocked(toast).mock.calls[0][1]?.action?.onClick?.();
    expect(router.push).toHaveBeenCalledWith("/agent?select=p1");
    await user.click(screen.getByRole("button", { name: "Put back Job a1" }));
    expect(setArchived).toHaveBeenCalledWith({ id: "a1", archived: false });
    expect(screen.getByText("Nothing archived yet.")).toBeInTheDocument();
  });
});

describe("the Archive's note and charts", () => {
  it("says archived jobs are deleted after the chosen time, applications never, and where to change it", () => {
    const { unmount } = render(<ArchiveScreen rows={[row("p1")]} clearDays={90} />);
    expect(screen.getByRole("note")).toHaveTextContent("archived applications you never applied to are deleted automatically 90 days after they were archived. Anything you applied to is never deleted.");
    expect(screen.getByRole("link", { name: "Settings → Your data → Clear the Archive" })).toHaveAttribute("href", "/settings?section=data");
    unmount();
    render(<ArchiveScreen rows={[row("p1")]} clearDays={0} />);
    expect(screen.getByRole("note")).toHaveTextContent("Nothing here is deleted automatically.");
  });

  it("counts every archived record by reason, applications on their own", () => {
    render(<ArchiveScreen rows={[row("p1", { why: "distance" }), row("p2", { why: "distance" }), row("a1", { kind: "application", why: "you" })]} />);
    const legend = within(screen.getByRole("list", { name: "Archived records by reason" }));
    expect(legend.getByText("Too far").nextElementSibling).toHaveTextContent("2");
    expect(legend.getByText("Applications").nextElementSibling).toHaveTextContent("1");
    expect(legend.getByText("Archived by you").nextElementSibling).toHaveTextContent("0");
    expect(screen.getByRole("img", { name: /^3 archived records/ })).toBeInTheDocument();
  });
});
