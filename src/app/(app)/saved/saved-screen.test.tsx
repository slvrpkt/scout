import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PostingState, ShownPosting } from "@/lib/job-search/search";

import { SavedScreen } from "./saved-screen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/saved" }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));
vi.mock("../jobs/actions", () => ({
  startApplicationFrom: vi.fn(),
  showMorePostings: vi.fn(),
  loadFullText: vi.fn(),
  savePostingForLater: vi.fn(),
  unsavePosting: vi.fn(),
  dismissFoundPosting: vi.fn(),
  restorePosting: vi.fn(),
  startScoringPosting: vi.fn(),
}));

const state: PostingState = { postingId: "p", saved: true, dismissed: false, applicationId: null, score: null };
const job = (id: string, score: number | null, extra: Partial<ShownPosting> = {}): ShownPosting => ({
  source: "JSEARCH",
  externalId: id,
  title: `Job ${id}`,
  company: `Company ${id}`,
  place: "Arlington, VA",
  remote: false,
  salary: "",
  postedAt: "2026-11-10T00:00:00.000Z",
  url: `https://jobs.example/${id}`,
  via: "LinkedIn",
  description: `The posting ${id}.`,
  complete: true,
  ...extra,
  state: { ...state, score: score === null ? null : { score, reasons: [], redFlags: [] } },
});
const listed = () => within(screen.getByRole("list", { name: "Postings" })).getAllByRole("button").map((item) => item.textContent?.match(/Job ([a-z]\d*)/)?.[1]).filter(Boolean);
const open = (postings: ShownPosting[]) => render(<SavedScreen postings={postings} today="2026-11-11T12:00:00.000Z" />);

describe("Saved for later", () => {
  it("says what it's for, and lists the highest score first, a job not scored yet last", () => {
    open([job("a", 72), job("b", null), job("c", 91)]);
    expect(screen.getByRole("heading", { level: 1, name: "Saved for later" })).toBeInTheDocument();
    expect(screen.getByText(/A temporary place for jobs you want to come back to/)).toBeInTheDocument();
    expect(listed()).toEqual(["c", "a", "b"]);
  });

  it("filters like Agentic job search, with a score floor", async () => {
    open([job("a", 72), job("b", 85, { company: "Ledgerly" }), job("c", 91)]);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Score" }), "80+");
    expect(listed()).toEqual(["c", "b"]);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Company" }), "Ledgerly (1)");
    expect(listed()).toEqual(["b"]);
  });

  it("shows 8 to a page", async () => {
    open(Array.from({ length: 10 }, (_, index) => job(`j${index}`, 90 - index)));
    expect(listed()).toHaveLength(8);
    await userEvent.click(screen.getByRole("button", { name: "2" }));
    expect(listed()).toEqual(["j8", "j9"]);
  });
});
