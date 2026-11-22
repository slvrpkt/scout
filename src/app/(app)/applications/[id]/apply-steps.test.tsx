import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { changeStatus } from "@/components/change-status";
import { lookOnCompanySite } from "@/app/(app)/agent/actions";
import { noteLetterUsed } from "@/app/(app)/applications/[id]/actions";
import { downloadHeld } from "@/components/documents/download-pdf-button";

import { ApplySteps } from "./apply-steps";

vi.mock("@/components/change-status", () => ({ changeStatus: vi.fn(async () => true) }));
vi.mock("@/components/documents/download-pdf-button", () => ({ downloadHeld: vi.fn(async () => true) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/(app)/agent/actions", () => ({ lookOnCompanySite: vi.fn(async () => ({ ok: true, data: { jobId: "look-1" } })) }));
vi.mock("@/app/(app)/applications/[id]/actions", () => ({ noteLetterUsed: vi.fn(async () => ({ ok: true, data: null })) }));
// The look's job: still running unless a test says it finished.
const job = vi.hoisted(() => ({ update: null as null | { status: string; result: { found: boolean } } }));
vi.mock("@/hooks/use-job", async () => {
  const { useEffect } = await import("react");
  return {
    useJob: (id: string | null, _revision: number, onChange: (update: unknown) => void) => {
      useEffect(() => {
        if (id && job.update) onChange(job.update);
      }, [id, onChange]);
      return null;
    },
  };
});

const direct = { url: "https://acme.wd5.myworkdayjobs.com/job/1", label: "the company's site (via Workday)", direct: true };

describe("Quick Apply", () => {
  it("downloads the resume and letter on opening, copies the letter, opens the employer's page and marks it applied", async () => {
    const user = userEvent.setup();
    vi.mocked(downloadHeld).mockClear();
    render(<ApplySteps id="app-1" page={direct} letter={"Dear hiring team,\n\nHello."} />);
    await user.click(screen.getByRole("button", { name: "Quick Apply" }));

    // Both start at once, without a click, and say when they're done.
    expect(downloadHeld).toHaveBeenCalledWith("/api/pdf?doc=resume&application=app-1", null);
    expect(downloadHeld).toHaveBeenCalledWith("/api/pdf?doc=letter&application=app-1", null);
    expect(await screen.findByText("✓ Resume (PDF) downloaded")).toBeInTheDocument();
    expect(await screen.findByText("✓ Cover letter (PDF) downloaded")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy cover letter" }));
    expect(await navigator.clipboard.readText()).toBe("Dear hiring team,\n\nHello.");
    expect(screen.getByRole("button", { name: "Copied ✓" })).toBeInTheDocument();
    // Copied to paste in: the letter counts as used.
    expect(noteLetterUsed).toHaveBeenCalledWith({ id: "app-1" });

    const open = screen.getByRole("link", { name: /Click here to apply/ });
    expect(open).toHaveAttribute("href", direct.url);
    expect(open).toHaveAttribute("target", "_blank");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "I applied" }));
    expect(changeStatus).toHaveBeenCalledWith("app-1", "SENT");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says when the link is where the job was listed, and when there's no letter or link", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ApplySteps id="app-1" page={{ url: "https://www.theladders.com/job/1", label: "Ladders", direct: false }} letter={null} />);
    await user.click(screen.getByRole("button", { name: "Quick Apply" }));
    expect(screen.getByRole("note")).toHaveTextContent("not the employer's own page");
    expect(screen.getByText("No cover letter for this one: only the resume goes.")).toBeInTheDocument();
    // No letter: its download is off, and says why.
    expect(screen.getByRole("button", { name: "Cover letter (PDF)" })).toBeDisabled();
    expect(screen.getByText("No cover letter generated.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Click here to go to the job posting/ })).toBeInTheDocument();
    rerender(<ApplySteps id="app-1" page={null} letter={null} />);
    expect(screen.getByText(/No link to apply on/)).toBeInTheDocument();
  });

  it("looks for a draft on the company's own site when opened, if it never was, and says what it found", async () => {
    const user = userEvent.setup();
    job.update = null;
    const board = { url: "https://jobgether.com/offer/1", label: "Jobgether", direct: false };
    const { rerender } = render(<ApplySteps id="app-1" page={board} letter={null} lookFor="cand-1" company="Vultr" />);
    await user.click(screen.getByRole("button", { name: "Quick Apply" }));
    expect(lookOnCompanySite).toHaveBeenCalledWith({ candidateId: "cand-1" });
    expect(screen.getByText("Looking for this job on Vultr's own site…")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Click here/ })).not.toBeInTheDocument();

    // Found: the page comes back with the employer's link first.
    job.update = { status: "DONE", result: { found: true } };
    rerender(<ApplySteps id="app-1" page={board} letter={null} lookFor="cand-1" company="Vultr" />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Quick Apply" }));
    rerender(<ApplySteps id="app-1" page={{ url: "https://jobs.ashbyhq.com/Vultr/1", label: "the company's site (via Ashby)", direct: true }} letter={null} lookFor={null} company="Vultr" />);
    expect(screen.getByRole("link", { name: /Click here to apply/ })).toHaveAttribute("href", "https://jobs.ashbyhq.com/Vultr/1");
  });

  it("says when an earlier look didn't find it on the company's site, and doesn't look again", async () => {
    const user = userEvent.setup();
    vi.mocked(lookOnCompanySite).mockClear();
    render(<ApplySteps id="app-1" page={{ url: "https://jobgether.com/offer/1", label: "Jobgether", direct: false }} letter={null} notFound company="Vultr" />);
    await user.click(screen.getByRole("button", { name: "Quick Apply" }));
    expect(lookOnCompanySite).not.toHaveBeenCalled();
    expect(screen.getByRole("note")).toHaveTextContent("Couldn't find it on Vultr's own site.");
  });
});
