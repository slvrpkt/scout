import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { NavLinks } from "./nav-links";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} />,
}));

function currentItem(path: string) {
  pathname = path;
  const { unmount } = render(<NavLinks />);
  const current = screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent);
  unmount();
  return current;
}

describe("NavLinks", () => {
  it("lists the job search first, then your profile and settings", () => {
    render(<NavLinks />);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Dashboard",
      "Agentic job search",
      "Manual job search",
      "Job application log",
      "Archive",
      // Startups is hidden for now.
      "Inbox",
      "Profile",
      "Base resume",
      "Settings",
    ]);
  });

  it("marks exactly one current section", () => {
    expect(currentItem("/")).toEqual(["Dashboard"]);
    expect(currentItem("/profile")).toEqual(["Profile"]);
    expect(currentItem("/resume")).toEqual(["Base resume"]);
    expect(currentItem("/jobs")).toEqual(["Manual job search"]);
    expect(currentItem("/agent")).toEqual(["Agentic job search"]);
    // Startups is hidden for now, so its page marks no section.
    expect(currentItem("/startups")).toEqual([]);
    expect(currentItem("/settings")).toEqual(["Settings"]);
  });

  it("keeps Applications current on an application and in the new application flow", () => {
    expect(currentItem("/applications")).toEqual(["Job application log"]);
    expect(currentItem("/applications/abc123")).toEqual(["Job application log"]);
    expect(currentItem("/new")).toEqual(["Job application log"]);
  });

  it("doesn't treat a path that only starts with the same letters as a match", () => {
    expect(currentItem("/profiles")).toEqual([]);
    expect(currentItem("/newsletter")).toEqual([]);
  });
});
