import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TrapWarning } from "./trap-warning";

describe("the screening trap warning", () => {
  it("names each planted word, why it looks planted, and that it was kept out", () => {
    render(<TrapWarning traps={[{ term: "Cribbage", why: "Cribbage is a card game, not a programming language." }]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("⚠️ Possible resume screening trap");
    expect(screen.getByRole("alert")).toHaveTextContent("Lists “Cribbage”: Cribbage is a card game, not a programming language. Scout kept it out of your resume and cover letter.");
  });

  it("explains what a screening trap is, with an example, from the ⓘ", async () => {
    render(<TrapWarning traps={[{ term: "Cribbage", why: "A card game." }]} />);
    await userEvent.hover(screen.getByRole("button", { name: "What's a resume screening trap?" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("planting a made-up requirement in job postings");
  });
});
