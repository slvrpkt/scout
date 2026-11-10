import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { fitResumeNow } from "./actions";
import { OverLimitNotice } from "./over-limit-notice";

vi.mock("./actions", () => ({ fitResumeNow: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/toast", () => ({ toastResult: (result: unknown) => result, toast: vi.fn() }));

describe("OverLimitNotice", () => {
  it("says the resume runs over, and fits it only when asked", async () => {
    const user = userEvent.setup();
    render(<OverLimitNotice id="app-1" limit={2} />);
    expect(screen.getByText("This custom tailored resume runs over two pages.")).toBeInTheDocument();
    expect(fitResumeNow).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Fit to limit" }));
    await waitFor(() => expect(fitResumeNow).toHaveBeenCalledWith({ id: "app-1" }));
  });
});
