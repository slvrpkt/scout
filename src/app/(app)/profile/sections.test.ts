import { describe, expect, it } from "vitest";

import { SECTIONS, sectionFromParam, sectionHref } from "./sections";

describe("profile sections", () => {
  it("come in the order Basics → Experience → Education → Certifications → Skills & languages → Tools & platforms → Projects → Publications → References → Facts about me", () => {
    expect(SECTIONS.map((section) => section.label)).toEqual([
      "Basics",
      "Experience",
      "Education",
      "Certifications",
      "Skills & languages",
      "Tools & platforms",
      "Projects",
      "Publications",
      "References",
      "Facts about me",
    ]);
  });

  it("mark everything but Basics as optional (#216)", () => {
    expect(SECTIONS.filter((section) => section.optional).map((section) => section.id)).toEqual(["experience", "education", "certifications", "skills", "tools", "projects", "publications", "references", "facts"]);
  });

  it("read the current section from the URL, falling back to Basics", () => {
    expect(sectionFromParam("experience")).toBe("experience");
    expect(sectionFromParam("facts")).toBe("facts");
    expect(sectionFromParam(undefined)).toBe("basics");
    expect(sectionFromParam("unknown")).toBe("basics");
    expect(sectionFromParam(["skills", "education"])).toBe("basics");
    expect(sectionHref("references")).toBe("/profile?section=references");
  });
});
