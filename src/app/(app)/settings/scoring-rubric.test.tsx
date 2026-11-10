import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { saveScoringRubric } from "./actions";
import { ScoringRubric } from "./scoring-rubric";

vi.mock("./actions", () => ({ saveScoringRubric: vi.fn(async () => ({ ok: true, data: null })) }));

describe("ScoringRubric (#42)", () => {
  it("says jobs are scored by your settings while it's empty, and drops an old fit item, which has its own points now", () => {
    render(<ScoringRubric initial={[{ id: "fit", label: "How well it fits your profile", points: 50 }]} />);
    expect(screen.getByText("None yet: jobs are scored by the settings above.")).toBeInTheDocument();
  });

  it("adds your criteria with points in steps of 5, and saves them, up to 5", async () => {
    render(<ScoringRubric initial={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Add a criterion" }));
    await userEvent.type(screen.getByLabelText("Criterion 1"), "Remote");
    await userEvent.selectOptions(screen.getByLabelText("Points"), "30");
    expect(screen.getByText("30 points in all")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Points")[0].querySelectorAll("option")).toHaveLength(20);
    await vi.waitFor(() =>
      expect(saveScoringRubric).toHaveBeenLastCalledWith({
        rubric: [
          { id: expect.any(String), label: "Remote", points: 30 },
        ],
      }),
    );
    for (let index = 0; index < 4; index++) await userEvent.click(screen.getByRole("button", { name: "Add a criterion" }));
    expect(screen.getByText("That's the most: 5.")).toBeInTheDocument();
  });

  it("leaves out a criterion without words, and removes one", async () => {
    render(<ScoringRubric initial={[{ id: "a", label: "Hybrid", points: 10 }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Add a criterion" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove Hybrid" }));
    await vi.waitFor(() => expect(saveScoringRubric).toHaveBeenLastCalledWith({ rubric: [] }));
  });
});
