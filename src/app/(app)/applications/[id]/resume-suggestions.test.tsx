import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ResumeSuggestions } from "./resume-suggestions";

describe("ResumeSuggestions", () => {
  it("lists ideas to vet", () => {
    render(<ResumeSuggestions items={["The posting asks for Jira. If you have used it, add it."]} />);
    expect(screen.getByRole("region", { name: "Suggestions for this job" })).toHaveTextContent("Jira");
    expect(screen.getByRole("listitem")).toBeInTheDocument();
  });

  it("stays away when there are none", () => {
    const { container } = render(<ResumeSuggestions items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
