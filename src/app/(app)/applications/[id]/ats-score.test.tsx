import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rewriteToA } from "./actions";
import { AtsScore } from "./ats-grade-card";

vi.mock("./actions", () => ({ rewriteToA: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/toast", () => ({ toastResult: (result: unknown) => result, toast: vi.fn() }));

const grade = {
  letter: "C" as const,
  score: 75,
  format: 100,
  match: 50,
  checks: [{ label: "Standard section headings", earned: 20, points: 20 }],
  covered: ["Figma"],
  fixes: [],
  missing: ["Kubernetes"],
  tips: [] as string[],
  beforeApplying: [] as string[],
  placement: [] as string[],
};

beforeEach(() => vi.mocked(rewriteToA).mockClear());

describe("AtsScore", () => {
  it("shows the score in a circle, and on click why and what would raise it, with no rewrite while the profile hasn't changed", async () => {
    const user = userEvent.setup();
    render(<AtsScore id="app-1" grade={grade} draft />);
    await user.click(screen.getByRole("button", { name: /ATS score C/ }));
    const dialog = screen.getByRole("dialog", { name: "ATS grade: C" });
    expect(dialog).toHaveTextContent("Standard section headings");
    expect(dialog).toHaveTextContent("On the resume from the posting: Figma");
    expect(dialog).toHaveTextContent("Not on the resume yet: Kubernetes");
    expect(dialog).toHaveTextContent("the score updates on its own after each change");
    expect(screen.queryByRole("button", { name: /Rewrite/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Re-check/ })).not.toBeInTheDocument();
  });

  it("offers a rewrite from the profile once it has changed since the resume was written, and not at an A or once sent", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AtsScore id="app-1" grade={grade} draft profileNewer />);
    await user.click(screen.getByRole("button", { name: /ATS score C/ }));
    await user.click(screen.getByRole("button", { name: "Rewrite from my updated Profile" }));
    await waitFor(() => expect(rewriteToA).toHaveBeenCalledWith({ id: "app-1" }));
    unmount();
    const second = render(<AtsScore id="app-1" grade={{ ...grade, letter: "A", score: 95, missing: [] }} draft profileNewer />);
    await user.click(screen.getByRole("button", { name: /ATS score A/ }));
    expect(screen.queryByRole("button", { name: /Rewrite/ })).not.toBeInTheDocument();
    expect(screen.queryByText("What would bring it up to an A")).not.toBeInTheDocument();
    second.unmount();
    render(<AtsScore id="app-1" grade={grade} draft={false} profileNewer />);
    await user.click(screen.getByRole("button", { name: /ATS score C/ }));
    expect(screen.queryByRole("button", { name: /Rewrite/ })).not.toBeInTheDocument();
  });

  it("says what changed when an edit moves the score: what's now covered, and what dropped off", async () => {
    const { toast } = await import("@/components/toast");
    const { rerender } = render(<AtsScore id="app-1" grade={grade} draft />);
    rerender(<AtsScore id="app-1" grade={{ ...grade, letter: "B", score: 86, covered: ["Kubernetes"], missing: ["Figma"] }} draft />);
    await waitFor(() => expect(toast).toHaveBeenCalledWith("ATS score C 75 → B 86. Now covered: Kubernetes. No longer on the resume: Figma."));
  });
});
