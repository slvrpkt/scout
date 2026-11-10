import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ScoreExplainer } from "./score-explainer";

describe("the score, explained", () => {
  it("opens how it was worked out: the reasons for and against, at most twenty", async () => {
    const user = userEvent.setup();
    const reasons = Array.from({ length: 25 }, (_, index) => `Reason ${index + 1}`);
    render(<ScoreExplainer score={82} title="Designer at Ledgerly" reasons={reasons} redFlags={["Wants 10 years"]} minScore={70} />);
    await user.click(screen.getByRole("button", { name: /how it was worked out/ }));
    const dialog = screen.getByRole("dialog", { name: "How this score was worked out" });
    expect(dialog).toHaveTextContent("Good fit · 82 of 100 · Designer at Ledgerly");
    expect(within(within(dialog).getByRole("region", { name: "Counts for it" })).getAllByRole("listitem")).toHaveLength(19);
    expect(within(dialog).getByRole("region", { name: "Counts against it" })).toHaveTextContent("Wants 10 years");
    expect(dialog).toHaveTextContent("The job agent keeps postings from 70 up");
  });
});
