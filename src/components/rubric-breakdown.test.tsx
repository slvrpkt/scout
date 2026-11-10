import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { RubricBreakdown } from "./rubric-breakdown";

it("lists each criterion with how it was judged and its points, and the total (#42)", () => {
  render(
    <RubricBreakdown
      score={70}
      breakdown={[
        { label: "How well it fits your profile", points: 50, earned: 40, verdict: "score", note: "Scored 80 of 100" },
        { label: "Remote", points: 25, earned: 25, verdict: "yes", note: "Fully remote." },
        { label: "Hybrid", points: 10, earned: 5, verdict: "partly", note: "" },
        { label: "Salary", points: 15, earned: 0, verdict: "unknown", note: "" },
      ]}
    />,
  );
  const rows = screen.getAllByRole("row").map((row) => row.textContent);
  expect(rows).toContain("RemoteFully remote.Met25 / 25");
  expect(rows).toContain("HybridPartly met5 / 10");
  expect(rows).toContain("SalaryPosting doesn't say0 / 15");
  expect(rows).toContain("Total: 70 of 10070 / 100");
});
