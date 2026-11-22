import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import { retry } from "@/lib/jobs/actions";
import type { JobView } from "@/lib/jobs/runner";

import { fetchPostingText, handOffToClaude, startPreparingDraft } from "./actions";
import { NewApplication } from "./new-application";

vi.mock("./actions", () => ({
  startPreparingDraft: vi.fn(),
  fetchPostingText: vi.fn(),
  handOffToClaude: vi.fn(),
}));
vi.mock("@/lib/jobs/actions", () => ({ retry: vi.fn(async () => ({ ok: true, data: null })), cancel: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));
// Jobs follow whatever the test says, as the real hook would: new state, then onChange.
const jobs = vi.hoisted(() => ({ listeners: new Map<string, (job: unknown) => void>() }));
vi.mock("@/hooks/use-job", async () => {
  const { useEffect, useState } = await import("react");
  return {
    useJob: vi.fn((id: string | null, _revision: number, onChange?: (job: unknown) => void) => {
      const [view, setView] = useState<{ id: string } | null>(null);
      useEffect(() => {
        if (!id) return;
        jobs.listeners.set(id, (job) => {
          setView(job as { id: string });
          onChange?.(job);
        });
      });
      return view && view.id === id ? view : null;
    }),
  };
});
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => null }));

const props = { aiReady: true, samplePosting: "Ledgerly is hiring a Senior Product Designer." };

function emit(job: Partial<JobView>) {
  const view = { id: "job-1", type: "prepare-draft", status: "RUNNING", step: null, error: null, result: null, ...job };
  act(() => jobs.listeners.get(view.id)?.(view));
}

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(toast).mockReset();
  // As the server does: the posting it came from, a new one for a paste, none for a startup.
  vi.mocked(startPreparingDraft)
    .mockReset()
    .mockImplementation(async (input) => ({ ok: true, data: { jobId: "job-1", postingId: input.postingId ?? (input.startupId ? null : "posting-new") } }));
  router.push.mockReset();
});

describe("the paste step (E7-1)", () => {
  it("has the header, the two steps and the posting fields, the link optional", () => {
    render(<NewApplication {...props} />);
    expect(screen.getByRole("heading", { level: 1, name: "New manual application" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "New application steps" })).toHaveTextContent("Paste the posting2Prepare the draft");
    expect(screen.getByLabelText("Job posting")).toHaveAttribute("rows", "14");
    expect(screen.getByLabelText("Link to the posting (optional)")).toHaveAttribute("placeholder", "https://");
    // The link comes first, the posting second.
    expect(screen.getByLabelText(/^Link to the posting/).compareDocumentPosition(screen.getByLabelText("Job posting")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("stays focusable but explains itself while there's no posting", async () => {
    render(<NewApplication {...props} />);
    const prepare = screen.getByRole("button", { name: "Prepare draft →" });
    expect(prepare).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(prepare);
    expect(toast).toHaveBeenCalledWith("Paste a job posting first, or try the sample.");
    expect(startPreparingDraft).not.toHaveBeenCalled();
  });

  it("offers the sample only when there is one", async () => {
    const { unmount } = render(<NewApplication {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "Use a sample posting" }));
    expect(screen.getByLabelText("Job posting")).toHaveValue(props.samplePosting);
    unmount();
    // Another tab, with nothing kept.
    sessionStorage.clear();
    render(<NewApplication {...props} samplePosting={null} />);
    expect(screen.queryByRole("button", { name: "Use a sample posting" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Prepare draft →" }));
    expect(toast).toHaveBeenCalledWith("Paste a job posting first.");
  });

  it("fetches the posting from its link, with a way back to what was there (E7-8)", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchPostingText).mockResolvedValueOnce({ ok: true, data: { text: "Ledgerly: Senior Designer\n\nWhat you'll do…", url: "https://www.jobs.ledgerly.example/123" } });
    render(<NewApplication {...props} />);
    await user.type(screen.getByLabelText("Job posting"), "My own notes");
    await user.type(screen.getByLabelText(/^Link to the posting/), "jobs.ledgerly.example/123");
    await user.click(screen.getByRole("button", { name: "Fetch" }));
    expect(fetchPostingText).toHaveBeenCalledWith({ link: "jobs.ledgerly.example/123" });
    expect(screen.getByLabelText("Job posting")).toHaveValue("Ledgerly: Senior Designer\n\nWhat you'll do…");
    expect(toast).toHaveBeenCalledWith("Fetched the posting from jobs.ledgerly.example. Check it before preparing the draft.", {
      action: { label: "Undo", onClick: expect.any(Function) },
    });
    act(() => vi.mocked(toast).mock.calls.at(-1)![1]!.action!.onClick());
    expect(screen.getByLabelText("Job posting")).toHaveValue("My own notes");
  });

  it("explains why a link can't be fetched, and asks for one first", async () => {
    const user = userEvent.setup();
    render(<NewApplication {...props} />);
    await user.click(screen.getByRole("button", { name: "Fetch" }));
    expect(toast).toHaveBeenCalledWith("Enter the link to the posting first.");
    expect(fetchPostingText).not.toHaveBeenCalled();
  });

  it("points to Settings when no AI provider is set up", () => {
    render(<NewApplication {...props} aiReady={false} />);
    expect(screen.getByRole("link", { name: "Choose one in Settings → AI provider" })).toHaveAttribute("href", "/settings?section=ai");
  });

  it("hands the posting to a Claude chat when the connector is on and Scout has no model (#221)", async () => {
    const tab = { closed: false, opener: {}, location: { href: "about:blank" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    vi.mocked(handOffToClaude).mockResolvedValue({ ok: true, data: { url: "https://claude.ai/new?q=write" } });
    render(<NewApplication {...props} aiReady={false} writeInClaude />);
    expect(screen.getByRole("note")).toHaveTextContent(/Scout has no AI model of its own, so Claude writes this one/);
    await userEvent.type(screen.getByLabelText("Job posting"), "Ledgerly is hiring.");
    await userEvent.type(screen.getByLabelText(/^Link to the posting/), "https://jobs.example/1");
    await userEvent.click(screen.getByRole("button", { name: "Write it with Claude →" }));
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(handOffToClaude).toHaveBeenCalledWith({ posting: "Ledgerly is hiring.", postingUrl: "https://jobs.example/1" });
    expect(tab.location.href).toBe("https://claude.ai/new?q=write");
    expect(startPreparingDraft).not.toHaveBeenCalled();
    open.mockRestore();
  });
});

describe("preparing the draft, as the job agent does", () => {
  async function prepare(extra: Partial<Parameters<typeof NewApplication>[0]> = {}) {
    render(<NewApplication {...props} {...extra} />);
    if (!extra.fromPosting) await userEvent.type(screen.getByLabelText("Job posting"), "Ledgerly is hiring.");
    await userEvent.click(screen.getByRole("button", { name: "Prepare draft →" }));
  }

  it("keeps a pasted posting, no link needed, and follows the draft's steps, then opens it", async () => {
    await prepare();
    expect(startPreparingDraft).toHaveBeenCalledWith({ posting: "Ledgerly is hiring.", postingUrl: "", postingId: null, startupId: null });
    expect(screen.getByRole("heading", { name: "Preparing your draft…" })).toBeInTheDocument();
    expect(screen.getByText(/You can leave this page: the draft keeps being prepared/)).toBeInTheDocument();
    emit({ step: "Tailoring your resume" });
    expect(screen.getByText("Tailoring your resume").closest("li")).toHaveAttribute("aria-current", "step");
    emit({ status: "DONE", step: "Saving the application", result: { applicationId: "app-1" } });
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith("/applications/app-1"));
    expect(toast).toHaveBeenCalledWith("Your draft is ready. Nothing gets sent until you say so.");
  });

  it("offers Retry and a way back when it fails, and trying again from the posting keeps the same saved posting", async () => {
    await prepare();
    emit({ status: "FAILED", step: "Reading the posting", error: "Couldn't reach the server." });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't reach the server.");
    expect(screen.queryByText(/You can leave this page/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledWith({ id: "job-1" });
    await userEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByLabelText("Job posting")).toHaveValue("Ledgerly is hiring.");
    await userEvent.click(screen.getByRole("button", { name: "Prepare draft →" }));
    expect(startPreparingDraft).toHaveBeenLastCalledWith(expect.objectContaining({ postingId: "posting-new" }));
  });

  it("prepares a posting from Manual job search as that posting (E14-8)", async () => {
    await prepare({ fromPosting: { id: "posting-1", text: "Ledgerly: Designer\n\nWe're hiring.", url: "https://jobs.example/1", complete: true } });
    expect(toast).toHaveBeenCalledWith("Here's the posting from Manual job search. Check it, then prepare the draft.");
    expect(startPreparingDraft).toHaveBeenCalledWith({ posting: "Ledgerly: Designer\n\nWe're hiring.", postingUrl: "https://jobs.example/1", postingId: "posting-1", startupId: null });
  });

  it("prepares one for a startup handed over by Startups (#222)", async () => {
    await prepare({ fromPosting: { id: null, startup: { id: "startup-1", company: "Canalworks" }, text: "Canalworks is hiring a designer.", url: "https://news.example/1", complete: true } });
    expect(startPreparingDraft).toHaveBeenCalledWith(expect.objectContaining({ postingId: null, startupId: "startup-1" }));
  });

});
