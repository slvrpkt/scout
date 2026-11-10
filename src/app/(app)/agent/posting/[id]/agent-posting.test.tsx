import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AgentCandidateView } from "@/lib/agent/view";

import { dismissAgentCandidate, prepareAgentDraft, restoreAgentCandidate } from "../../actions";
import { AgentPosting } from "./agent-posting";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/agent/posting/s1" }));
vi.mock("@/hooks/use-job", () => ({ useJob: () => null }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: { ok: boolean }) => result }));
vi.mock("../../actions", () => ({
  prepareAgentDraft: vi.fn(async () => ({ ok: true, data: { jobId: "draft-1", applicationId: null } })),
  dismissAgentCandidate: vi.fn(async () => ({ ok: true, data: { archivedApplicationId: null } })),
  restoreAgentCandidate: vi.fn(async () => ({ ok: true, data: null })),
  runAgentNow: vi.fn(),
}));

const posting: AgentCandidateView = {
  id: "s1",
  title: "Senior Designer",
  company: "Ledgerly",
  facts: "Rotterdam",
  origin: "on JSearch",
  source: "JSEARCH",
  url: "https://jobs.example/s1",
  score: 76,
  reasons: ["Built a design system."],
  redFlags: [],
  error: null,
  applicationId: null,
  draftJobId: null,
  foundBy: null,
  description: "The whole posting, every line of it.",
  postedOn: null,
  foundOn: "5 Nov 2026",
  deadline: null,
  place: "Rotterdam",
  remote: false,
  postedAt: null,
  duplicate: null,
};

describe("a posting the agent found, on its own page", () => {
  it("shows the whole posting with Prepare draft, writing nothing until it's clicked", async () => {
    render(<AgentPosting posting={posting} archived={false} minScore={70} />);
    expect(screen.getByRole("heading", { level: 1, name: "Senior Designer" })).toBeInTheDocument();
    expect(screen.getByText("The whole posting, every line of it.")).toBeInTheDocument();
    expect(prepareAgentDraft).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Prepare draft" }));
    expect(prepareAgentDraft).toHaveBeenCalledWith({ candidateId: "s1" });
  });

  it("archives it and goes back, or puts an archived one back", async () => {
    const { unmount } = render(<AgentPosting posting={posting} archived={false} minScore={70} />);
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(dismissAgentCandidate).toHaveBeenCalledWith({ candidateId: "s1" });
    expect(router.push).toHaveBeenCalledWith("/agent");
    unmount();
    render(<AgentPosting posting={posting} archived minScore={70} />);
    expect(screen.queryByRole("button", { name: "Prepare draft" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Put back" }));
    expect(restoreAgentCandidate).toHaveBeenCalledWith({ id: "s1" });
  });
});
