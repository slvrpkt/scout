import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { CostLimitDialog } from "./cost-limit-dialog";

const jsearch = { title: "JSearch (job search): daily limit reached", amounts: "Your limit: $0.50 a day · Used today: $0.50", paused: "Job searches are paused until tomorrow." };

beforeEach(() => sessionStorage.clear());

describe("the cost limit message", () => {
  it("says what got done today before the limit", () => {
    render(<CostLimitDialog limits={[jsearch]} today={{ found: 1234, scored: 78, setAside: 45 }} />);
    expect(screen.getByRole("dialog")).toHaveTextContent("Today so far: 1,234 jobs looked at · 78 scored · 45 set aside by your settings");
    expect(screen.getByRole("dialog")).toHaveTextContent("JSearch (job search): daily limit reached");
  });

  it("leaves the line out when today's counts aren't known", () => {
    render(<CostLimitDialog limits={[jsearch]} />);
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Today so far");
  });
});
