import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { saveGoogleSettings } from "@/lib/google/actions";

import { TimeZoneSection } from "./time-zone-section";

vi.mock("@/lib/google/actions", () => ({ saveGoogleSettings: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

describe("Settings → Time zone", () => {
  it("says which zone Scout works in, and saves another", async () => {
    const user = userEvent.setup();
    render(<TimeZoneSection initial={null} browserTimeZone="Europe/Berlin" />);
    expect(screen.getByRole("status")).toHaveTextContent("Working in Europe/Berlin (your browser's)");
    await user.type(screen.getByRole("combobox", { name: "Time zone" }), "America/New_York");
    await user.tab();
    expect(saveGoogleSettings).toHaveBeenCalledWith({ workTimeZone: "America/New_York" });
    expect(screen.getByRole("status")).toHaveTextContent("Working in America/New_York");
  });
});
