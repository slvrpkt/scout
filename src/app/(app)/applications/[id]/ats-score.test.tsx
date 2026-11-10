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
  it("shows the score in a circle, and on click why, what would raise it and the rewrite", async () => {
    const user = userEvent.setup();
    render(<AtsScore id="app-1" grade={grade} draft />);
    expect(rewriteToA).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /ATS score C/ }));
    const dialog = screen.getByRole("dialog", { name: "ATS grade: C" });
    expect(dialog).toHaveTextContent("Standard section headings");
    expect(dialog).toHaveTextContent("On the resume from the posting: Figma");
    expect(dialog).toHaveTextContent("Not on the resume yet: Kubernetes");
    await user.click(screen.getByRole("button", { name: "Rewrite to Reach A" }));
    await waitFor(() => expect(rewriteToA).toHaveBeenCalledWith({ id: "app-1" }));
  });

  it("offers no rewrite at an A, or once it's been sent", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AtsScore id="app-1" grade={{ ...grade, letter: "A", score: 95, missing: [] }} draft />);
    await user.click(screen.getByRole("button", { name: /ATS score A/ }));
    expect(screen.queryByRole("button", { name: "Rewrite to Reach A" })).not.toBeInTheDocument();
    expect(screen.queryByText("What would bring it up to an A")).not.toBeInTheDocument();
    unmount();
    render(<AtsScore id="app-1" grade={grade} draft={false} />);
    await user.click(screen.getByRole("button", { name: /ATS score C/ }));
    expect(screen.queryByRole("button", { name: "Rewrite to Reach A" })).not.toBeInTheDocument();
  });
});
