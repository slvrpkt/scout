import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import type { AgentCandidateView, AgentView } from "@/lib/agent/view";

import { dismissAgentCandidate, prepareAgentDraft, restoreAgentCandidate, runAgentNow } from "./actions";
import { AgentScreen } from "./agent-screen";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/agent" }));
vi.mock("@/hooks/use-job", () => ({ useJob: () => null }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: { ok: boolean }) => result }));
vi.mock("./actions", () => ({
  runAgentNow: vi.fn(async () => ({ ok: true, data: { jobId: "run-1", reused: false } })),
  prepareAgentDraft: vi.fn(async () => ({ ok: true, data: { jobId: "draft-1", applicationId: null } })),
  dismissAgentCandidate: vi.fn(async () => ({ ok: true, data: { archivedApplicationId: "app-1" } })),
  restoreAgentCandidate: vi.fn(async () => ({ ok: true, data: null })),
}));

const card = (id: string, score: number, extra: Partial<AgentCandidateView> = {}): AgentCandidateView => ({
  id,
  title: `Posting ${id}`,
  company: `Company ${id}`,
  facts: "Rotterdam · €70k",
  origin: "Posted 2 days ago · via LinkedIn on JSearch",
  description: "",
  postedOn: "2 Nov 2026",
  foundOn: "3 Nov 2026",
  deadline: null,
  place: "Rotterdam",
  remote: false,
  postedAt: null,
  source: "JSEARCH",
  url: `https://jobs.example/${id}`,
  score,
  reasons: [`Reason for ${id}`],
  redFlags: [],
  error: null,
  applicationId: null,
  draftJobId: null,
  foundBy: null,
  duplicate: null,
  ...extra,
});
const view: AgentView = {
  enabled: true,
  autoDraft: false,
  minScore: 70,
  budget: { scored: 12, scoreLimit: 150, drafted: 2, draftLimit: 30 },
  searches: [{ id: "search-1", line: "Product designer · Rotterdam, 25 km · via JSearch", enabled: true, lastMessage: null }],
  setupProblem: null,
  setupSection: null,
  limitReached: false,
  waiting: 0,
  runsPerDay: 3,
  times: ["07:00"],
  lastRun: { at: "Tue 20 Oct, 07:00", message: "2 new postings are waiting for a look." },
  nextRun: "Wed 21 Oct, 07:00",
  runJobId: null,
  drafts: [card("d1", 91, { applicationId: "app-1" })],
  scored: [card("s1", 84, { redFlags: ["German required"], error: "The draft couldn't be prepared. Try again." }), card("s2", 72)],
  belowMinimum: [card("b1", 40)],
};
const open = (changes: Partial<AgentView> = {}, select: string | null = null) => render(<AgentScreen view={{ ...view, ...changes }} initialSelected={select} />);

beforeEach(() => vi.clearAllMocks());

describe("AgentScreen (E16-6)", () => {
  it("says what it searches, when it ran and when it runs next", () => {
    open();
    expect(screen.getByRole("heading", { level: 1, name: "Agentic job search" })).toBeInTheDocument();
    expect(screen.getByText("Searches for").nextElementSibling).toHaveTextContent("Product designer · Rotterdam, 25 km · via JSearch");
    expect(screen.getByText("Last run").nextElementSibling).toHaveTextContent("Tue 20 Oct, 07:002 new postings are waiting for a look.");
    expect(screen.getByText("Next run").nextElementSibling).toHaveTextContent("Wed 21 Oct, 07:00");
  });

  const shown = (name: RegExp) => screen.getByRole("button", { name });
  const found = () => within(screen.getByRole("list", { name: "What it found" })).getAllByRole("button").map((item) => item.textContent);

  it("shows everything at first, drafts first, with the one picked beside them: Review Opportunity and Archive, no Approve", async () => {
    open();
    expect(shown(/^All/)).toHaveAttribute("aria-pressed", "true");
    expect(found()).toHaveLength(4);
    expect(found()[0]).toContain("Posting d1");
    // When it was posted and when the agent found it, as dates.
    expect(found()[0]).toContain("Posted 2 Nov 2026");
    expect(found()[0]).toContain("Last updated 3 Nov 2026");
    expect(screen.getByRole("heading", { level: 3, name: "Posting d1" })).toBeInTheDocument();
    // The title opens it too: a draft's application.
    expect(within(screen.getByRole("heading", { level: 3 })).getByRole("link", { name: "Posting d1" })).toHaveAttribute("href", "/applications/app-1");
    expect(screen.getByRole("button", { name: /how it was worked out/ })).toHaveTextContent("91");
    expect(screen.getByRole("link", { name: "Review Opportunity" })).toHaveAttribute("href", "/applications/app-1");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("archives a draft into the Job application log at once, since nothing is deleted", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(dismissAgentCandidate).toHaveBeenCalledWith({ candidateId: "d1" });
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith("Archived in your Job application log, with its resume and cover letter.", expect.objectContaining({ action: expect.objectContaining({ label: "Open" }) })),
    );
  });

  it("marks a posting put back from the Archive, and opens on the one asked for", () => {
    open({ scored: [card("s1", 84), card("s2", 72, { wasArchived: true })] }, "s2");
    expect(screen.getByText("Was archived")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Posting s2/, pressed: true })).toBeInTheDocument();
  });

  it("lists scored postings best first, and shows the one picked with its reasons, red flags, error and link", async () => {
    const user = userEvent.setup();
    open();
    await user.click(shown(/^Scored postings/));
    expect(found().map((text) => text?.match(/Posting s\d/)?.[0])).toEqual(["Posting s1", "Posting s2"]);
    expect(screen.getByRole("list", { name: "Why it fits" })).toHaveTextContent("Reason for s1");
    expect(screen.getByText("German required")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The draft couldn't be prepared. Try again.");
    const link = screen.getByRole("link", { name: /Open posting/ });
    expect(link).toHaveAttribute("href", "https://jobs.example/s1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await user.click(screen.getByRole("button", { name: /Posting s2/ }));
    expect(screen.getByRole("heading", { level: 3, name: "Posting s2" })).toBeInTheDocument();
  });

  it("opens a posting without a draft on its own page from its title, preparing nothing", async () => {
    const user = userEvent.setup();
    open();
    await user.click(shown(/^Scored postings/));
    expect(within(screen.getByRole("heading", { level: 3 })).getByRole("link", { name: "Posting s1" })).toHaveAttribute("href", "/agent/posting/s1");
    expect(prepareAgentDraft).not.toHaveBeenCalled();
  });

  it("labels a posting that's already in the log, with a link to it", async () => {
    open({
      drafts: [],
      belowMinimum: [],
      scored: [card("a", 80, { duplicate: { kind: "potential", applicationId: "app-9", label: "Company a – Designer", why: "Same company and a similar role" } })],
    });
    expect(screen.getAllByText("Potential duplicate").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Company a – Designer" })).toHaveAttribute("href", "/applications/app-9");
    expect(screen.getByRole("note")).toHaveTextContent("Same company and a similar role.");
  });

  it("labels Adzuna's postings with a link to Adzuna, as its terms ask", async () => {
    const user = userEvent.setup();
    open({ scored: [card("s1", 84, { source: "ADZUNA", url: "https://www.adzuna.nl/land/ad/1" }), card("s2", 72)] });
    await user.click(shown(/^Scored postings/));
    expect(screen.getByRole("link", { name: "Jobs by Adzuna (opens in a new tab)" })).toHaveAttribute("href", "https://www.adzuna.nl");
  });

  it("keeps postings below the minimum score under their own filter, and filters like Manual job search", async () => {
    const user = userEvent.setup();
    open();
    await user.click(shown(/^Scored postings/));
    expect(screen.queryByText("Posting b1")).not.toBeInTheDocument();
    await user.click(shown(/^Below 70/));
    expect(found()[0]).toContain("Posting b1");
    await user.click(shown(/^Scored postings/));
    await user.type(screen.getByRole("searchbox", { name: "Search what it found" }), "s2");
    expect(found()).toHaveLength(1);
    await user.click(screen.getByRole("checkbox", { name: "Remote only" }));
    expect(screen.getByText("No postings waiting for a draft.")).toBeInTheDocument();
  });

  it("prepares a draft from a scored posting", async () => {
    const user = userEvent.setup();
    open();
    await user.click(shown(/^Scored postings/));
    await user.click(screen.getByRole("button", { name: "Prepare draft" }));
    expect(prepareAgentDraft).toHaveBeenCalledWith({ candidateId: "s1" });
    expect(screen.getByRole("button", { name: /Preparing draft…/ })).toBeInTheDocument();
  });

  it("archives a scored posting at once, with Undo", async () => {
    const user = userEvent.setup();
    vi.mocked(dismissAgentCandidate).mockResolvedValueOnce({ ok: true, data: { archivedApplicationId: null } });
    open();
    await user.click(shown(/^Scored postings/));
    await user.click(screen.getByRole("button", { name: /Posting s2/ }));
    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(dismissAgentCandidate).toHaveBeenCalledWith({ candidateId: "s2" });
    await waitFor(() => expect(screen.queryByText("Posting s2")).not.toBeInTheDocument());
    expect(toast).toHaveBeenLastCalledWith("Archived. It won't come back; find it in the Archive.", expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }));

    const { action } = vi.mocked(toast).mock.calls.at(-1)![1]!;
    await act(async () => action!.onClick());
    expect(restoreAgentCandidate).toHaveBeenCalledWith({ id: "s2" });
    await waitFor(() => expect(screen.getAllByText("Posting s2").length).toBeGreaterThan(0));
  });

  it("runs now on request", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "Run now" }));
    expect(runAgentNow).toHaveBeenCalledWith({});
    expect(screen.getByRole("button", { name: "Running…" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Starting the run…");
  });

  it("points to Settings while it's off, not set up, or out of runs for the day", () => {
    const { unmount } = open({ enabled: false, nextRun: null });
    expect(screen.getByRole("note")).toHaveTextContent("The job agent is off. Turn it on in Settings → Job agent. What it found before is still here.");
    expect(screen.getByRole("link", { name: "Turn it on in Settings → Job agent" })).toHaveAttribute("href", "/settings?section=agent");
    expect(screen.getByText("Next run").nextElementSibling).toHaveTextContent("Off");
    unmount();

    const second = open({ setupProblem: "Choose a job source in Settings → Job search first.", setupSection: "jobs" });
    expect(screen.getByRole("note")).toHaveTextContent("Choose a job source. Go to Settings → Job search");
    expect(screen.getByRole("link", { name: "Go to Settings → Job search" })).toHaveAttribute("href", "/settings?section=jobs");
    second.unmount();

    open({ limitReached: true });
    expect(screen.getByRole("note")).toHaveTextContent("The agent has run 3 times in the past 24 hours");
  });

  it("says when there's nothing yet", () => {
    open({ drafts: [], scored: [], belowMinimum: [], lastRun: null, autoDraft: true });
    expect(screen.getByText("Nothing waiting yet. A run puts the postings that fit you best here.")).toBeInTheDocument();
    expect(screen.getByText("Last run").nextElementSibling).toHaveTextContent("Not yet");
  });
});
