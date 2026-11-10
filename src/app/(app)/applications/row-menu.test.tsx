import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import { deleteApplication, setArchived } from "@/lib/application-actions";
import type { ApplicationRow } from "@/lib/applications-data";
import { DEFAULT_SORT } from "@/lib/applications-list";

import { addNote } from "./[id]/actions";
import { setEmployerType } from "./actions";
import { ApplicationsScreen } from "./applications-screen";

vi.mock("./actions", () => ({
  rememberListView: vi.fn(async () => ({ ok: true, data: null })),
  setEmployerType: vi.fn(async () => ({ ok: true, data: null })),
}));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => null }));
vi.mock("@/components/change-status", () => ({ changeStatus: vi.fn(async () => true) }));
vi.mock("@/lib/application-actions", () => ({
  setArchived: vi.fn(async () => ({ ok: true, data: null })),
  deleteApplication: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));
vi.mock("./[id]/actions", () => ({
  addNote: vi.fn(async () => ({ ok: true, data: null })),
  recordSend: vi.fn(async () => ({ ok: true, data: { copies: 2 } })),
}));

const row = (id: string, extra: Partial<ApplicationRow> = {}): ApplicationRow => ({
  id,
  company: "Quill & Co",
  role: "UX Designer",
  location: "",
  mode: "Remote",
  status: "DECLINED",
  archived: false,
  deadline: null,
  match: null,
  sent: "10 Aug",
  updated: "4 weeks ago",
  updatedAt: Date.UTC(2026, 7, 31),
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
const params = { view: "table" as const, filter: "all" as const, q: "", sort: DEFAULT_SORT, archived: false };
const open = (extra = {}) =>
  render(
    <ApplicationsScreen params={params} rows={[row("quill")]} counts={{ all: 1, active: 0, closed: 1 }} summary="1 application" empty={false} archivedCount={0} {...extra} />,
  );
const menu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Actions for UX Designer, Quill & Co" }));
  return screen.getByRole("menu");
};

beforeEach(() => {
  vi.mocked(setArchived).mockClear();
  vi.mocked(deleteApplication).mockClear();
  vi.mocked(toast).mockClear();
  router.push.mockClear();
});

describe("archiving and deleting from a row (E9-5)", () => {
  it("archives with Undo on the toast", async () => {
    const user = userEvent.setup();
    open();
    await user.click(within(await menu(user)).getByRole("menuitem", { name: "Archive" }));
    expect(setArchived).toHaveBeenCalledWith({ id: "quill", archived: true });
    expect(toast).toHaveBeenCalledWith("Archived. It's off your board, and still counts on your dashboard.", {
      action: expect.objectContaining({ label: "Undo" }),
    });
    vi.mocked(toast).mock.lastCall?.[1]?.action?.onClick();
    expect(setArchived).toHaveBeenLastCalledWith({ id: "quill", archived: false });
  });

  it("brings an archived one back", async () => {
    const user = userEvent.setup();
    open({ rows: [row("quill", { archived: true })], params: { ...params, archived: true }, archivedCount: 1 });
    expect(screen.getByText("Archived")).toBeInTheDocument();
    await user.click(within(await menu(user)).getByRole("menuitem", { name: "Unarchive" }));
    expect(setArchived).toHaveBeenCalledWith({ id: "quill", archived: false });
  });

  it("asks before deleting, and clicks in the dialog don't open the row", async () => {
    const user = userEvent.setup();
    open();
    await user.click(within(await menu(user)).getByRole("menuitem", { name: "Delete…" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete this application?" });
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(within(dialog).getByText(/can't be undone/));
    expect(router.push).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Delete application" }));
    expect(deleteApplication).toHaveBeenCalledWith({ id: "quill" });
    expect(toast).toHaveBeenCalledWith("Application deleted.");
  });

  it("cancels a delete", async () => {
    const user = userEvent.setup();
    open();
    await user.click(within(await menu(user)).getByRole("menuitem", { name: "Delete…" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(deleteApplication).not.toHaveBeenCalled();
  });
});

describe("adding an event from the list", () => {
  it("opens the pop-up from the ⋯ menu, adds a call, and closes", async () => {
    const user = userEvent.setup();
    open();
    await user.click(within(await menu(user)).getByRole("menuitem", { name: "Add event…" }));
    const dialog = screen.getByRole("dialog", { name: "Add an event" });
    expect(within(dialog).getByText("UX Designer at Quill & Co")).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText("Reason"), "CALL");
    await user.type(within(dialog).getByLabelText("Add an event"), "Recruiter called back.");
    // Typing and clicking in the pop-up doesn't open the row.
    expect(router.push).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Add event" }));
    expect(addNote).toHaveBeenCalledWith({ id: "quill", body: "Recruiter called back.", kind: "CALL" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith("Call added.");
  });

  it("opens the same pop-up from the table's Add event button", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "Add event for UX Designer at Quill & Co" }));
    expect(screen.getByRole("dialog", { name: "Add an event" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See all of its activity" })).toHaveAttribute("href", "/applications/quill?tab=notes");
  });
});

describe("who the employer is", () => {
  it("sets Government or Startup from the ⋯ menu, or goes back to Scout's guess", async () => {
    const user = userEvent.setup();
    open();
    await user.click(within(await menu(user)).getByRole("menuitemradio", { name: "Government" }));
    expect(setEmployerType).toHaveBeenCalledWith({ id: "quill", type: "GOVERNMENT" });
    await user.click(within(await menu(user)).getByRole("menuitemradio", { name: "Let Scout decide" }));
    expect(setEmployerType).toHaveBeenLastCalledWith({ id: "quill", type: null });
  });

  it("labels the row, with Scout's guess marked as one", () => {
    open({ rows: [row("gov", { employer: { type: "GOVERNMENT", chosen: null, auto: true } })] });
    expect(screen.getByText("Government")).toHaveAttribute("title", "Scout's guess: change it in the ⋯ menu");
  });
});
