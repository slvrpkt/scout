import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { writeLetterNow } from "./actions";
import { LetterUnwritten } from "./letter-pending";

vi.mock("./actions", () => ({ writeLetterNow: vi.fn(async () => ({ ok: true, data: "job-1" })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/hooks/use-job", () => ({ useJob: () => ({ status: "RUNNING" }) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));

describe("a cover letter written on request", () => {
  it("writes it when asked, and says it'll be ready in a minute or two", async () => {
    const user = userEvent.setup();
    render(<LetterUnwritten id="app-1" />);
    expect(screen.getByRole("heading", { name: "No cover letter written yet" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Write cover letter" }));
    expect(writeLetterNow).toHaveBeenCalledWith({ id: "app-1" });
    expect(await screen.findByText(/ready in 1 to 2 minutes/)).toBeInTheDocument();
  });
});
