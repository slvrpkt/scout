import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HowToApply } from "./how-to-apply";

describe("How to apply", () => {
  it("offers the company's page first, then LinkedIn, then where the job was found", () => {
    render(
      <HowToApply
        url="https://ledgerly.wd1.myworkdayjobs.com/job/1"
        links={[
          { kind: "direct", url: "https://ledgerly.wd1.myworkdayjobs.com/job/1", publisher: "Ledgerly" },
          { kind: "linkedin", url: "https://www.linkedin.com/jobs/view/123", publisher: "LinkedIn" },
          { kind: "source", url: "https://www.indeed.com/viewjob?jk=1", publisher: "Indeed" },
        ]}
      />,
    );
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["1. Company site (via Workday) ↗", "2. LinkedIn ↗", "3. Where it was found: Indeed ↗"]);
  });

  it("shows the one link it has, and nothing without one", () => {
    const { unmount } = render(<HowToApply url="https://jobs.example.com/1" />);
    expect(screen.getByRole("link", { name: /Apply on the company's website/ })).toHaveAttribute("href", "https://jobs.example.com/1");
    unmount();
    const { container } = render(<HowToApply url="" />);
    expect(container).toBeEmptyDOMElement();
  });
});
