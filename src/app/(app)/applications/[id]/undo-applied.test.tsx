import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { undoStatus } from "@/lib/status-actions";

import { UndoApplied } from "./undo-applied";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/status-actions", () => ({ undoStatus: vi.fn(async () => ({ ok: true, data: { status: "DRAFT" } })) }));
vi.mock("@/components/toast", () => ({ toastResult: (result: unknown) => result }));

describe("Undo beside Marked as applied", () => {
  it("undoes the change that marked it applied, and shows the application as it was", async () => {
    render(<UndoApplied eventId="event-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undoStatus).toHaveBeenCalledWith({ eventId: "event-1" });
    expect(router.refresh).toHaveBeenCalled();
  });
});
