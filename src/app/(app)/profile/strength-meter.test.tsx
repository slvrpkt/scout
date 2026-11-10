import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BASICS_FIELDS, type ProfileData } from "@/lib/profile";

import { StrengthMeter } from "./strength-meter";

const basics: ProfileData["basics"] = {
  ...(Object.fromEntries(BASICS_FIELDS.map((field) => [field, ""])) as Record<(typeof BASICS_FIELDS)[number], string>),
  showAge: false,
};

describe("StrengthMeter", () => {
  it("is a labelled progress bar with the score and the hint", () => {
    render(
      <StrengthMeter
        profile={{ basics: { ...basics, name: "Jane" }, skills: [], languages: [], experience: [{} as never], projects: [], education: [], publications: [], references: [], facts: [] }}
      />,
    );
    const bar = screen.getByRole("progressbar", { name: "Profile strength" });
    expect(bar).toHaveAttribute("aria-valuenow", "50"); // 1 of 2 required basics
    expect(bar).toHaveAccessibleDescription("Nice progress. A bit more detail makes tailoring sharper.");
    expect(screen.getByText("50%")).toBeInTheDocument();
  });
});
