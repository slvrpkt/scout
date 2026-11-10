import { describe, expect, it } from "vitest";

import { sectionOrder, templateContacts, templateFromLayout, templateSummary } from "./resume-template";

const line = (text: string, size = 10.5) => ({ text, size });
const resume = (entry: string[]) => ({
  marginX: 0.62,
  marginY: 0.5,
  lines: [
    line("Jane Doe", 14),
    line("Gettysburg, PA | jane@example.com | (717) 555-0100"),
    line("SUMMARY", 11),
    line("Designer with years of experience."),
    line("WORK EXPERIENCE", 11),
    ...entry.map((text, index) => line(text, index === 0 ? 11 : 9.5)),
    line("• Led the design system."),
    line("Education", 11),
    line("BA, Design, Gettysburg College"),
  ],
});

describe("templateFromLayout", () => {
  it("reads the margins, the name's size, the title and the order", () => {
    expect(templateFromLayout(resume(["Lead Designer", "Acme, Jan 2020 – Present"]), "mine.pdf")).toEqual({
      fileName: "mine.pdf",
      marginX: 0.6,
      marginY: 0.5,
      nameSize: 14,
      headline: false,
      contacts: ["location", "email", "phone"],
      order: ["summary", "experience", "education"],
      entry: "company-below",
    });
  });

  it("tells how a job is laid out", () => {
    expect(templateFromLayout(resume(["Lead Designer  Jan 2020 – Present", "Acme"]), "a")?.entry).toBe("company-below-dates-right");
    expect(templateFromLayout(resume(["Lead Designer, Acme  2020 – 2024"]), "a")?.entry).toBe("inline");
  });

  it("notices a job title in the title block", () => {
    const layout = resume(["Lead Designer", "Acme"]);
    layout.lines.splice(1, 0, line("Senior Product Designer"));
    expect(templateFromLayout(layout, "a")?.headline).toBe(true);
  });

  it("gives up without sections to go by", () => {
    expect(templateFromLayout({ marginX: 1, marginY: 1, lines: [line("A scanned page"), line("with little text")] }, "a")).toBeNull();
  });
});

describe("a template in use", () => {
  it("puts what's left of the sections after its own", () => {
    expect(sectionOrder({ order: ["summary", "experience", "education"] }).slice(0, 4)).toEqual(["summary", "experience", "education", "projects"]);
  });

  it("shows only the contact details it has, in its order", () => {
    const basics = { email: "j@example.com", phone: "555", city: "Gettysburg", state: "PA", country: "US", website: "x.com", linkedin: "in/x" } as never;
    expect(templateContacts(basics, { contacts: ["location", "email", "phone"] })).toEqual(["Gettysburg, PA", "j@example.com", "555"]);
  });

  it("says what it took, in words", () => {
    const template = templateFromLayout(resume(["Lead Designer", "Acme"]), "a")!;
    expect(templateSummary(template)).toContain("Jobs: title, then company in a smaller font, then dates");
  });
});
