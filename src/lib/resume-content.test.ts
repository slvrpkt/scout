import { describe, expect, it } from "vitest";

import { demoProfile, demoResumeUnits } from "@/lib/demo-profile";
import type { ProfileData } from "@/lib/profile";

import { contactItems, degreeRank, displayLink, educationOnOneRow, resumeContent } from "./resume-content";

const today = new Date(2026, 8, 28);

describe("contactItems", () => {
  const { basics } = demoProfile();

  it("lists email, phone, city and state, website and LinkedIn", () => {
    expect(contactItems(basics, today)).toEqual([
      "jane.doe@example.com",
      "+31 6 1234 5678",
      "Rotterdam",
      "example.com",
      "linkedin.com/in/janedoe-example",
    ]);
  });

  it("adds the age only when show-age is on", () => {
    expect(contactItems({ ...basics, showAge: true }, today).at(-1)).toBe("Age 34");
    expect(contactItems({ ...basics, showAge: true, dob: "" }, today)).toHaveLength(5);
  });

  it("shows a tailored resume's own job title, else the profile's", () => {
    const profile = demoProfile();
    const units = [{ id: "headline", label: "Job title", text: "Staff Designer" }];
    expect(resumeContent(profile, { units }).headline).toBe("Staff Designer");
    expect(resumeContent(profile, { units: [] }).headline).toBe(profile.basics.headline);
    expect(resumeContent(profile).headline).toBe(profile.basics.headline);
  });

  it("skips what's empty", () => {
    expect(contactItems({ ...basics, phone: " ", city: "", website: "" }, today)).toEqual([
      "jane.doe@example.com",
      "linkedin.com/in/janedoe-example",
    ]);
  });
});

describe("resumeContent", () => {
  const profile = demoProfile();

  it("builds the base resume from the profile", () => {
    const content = resumeContent(profile, { today });
    expect(content.name).toBe("Jane Doe");
    expect(content.experience.map((role) => [role.company, role.dates])).toEqual([
      ["Northwind Logistics, Rotterdam", "Mar 2021 – Present"],
      ["Fieldnote, Amsterdam", "Jun 2018 – Feb 2021"],
      ["Studio Brik, Rotterdam", "Sep 2015 – May 2018"],
    ]);
    expect(content.experience[0].bullets).toHaveLength(3);
    expect(content.experience[2].skills).toEqual(["HTML & CSS", "Interaction design"]);
    // A fit's last resort: certifications and tools with no bearing on the job left out.
    const withCerts = { ...profile, certifications: [{ id: "c1", name: "Six Sigma" }, { id: "c2", name: "PMP" }].map((entry) => ({ ...entry, issuer: "", issuedOn: "", expiresOn: "", noExpiry: true, credentialId: "", url: "", onResumes: true })) };
    const hidden = resumeContent(withCerts, { units: [{ id: "tools", label: "Tools & platforms", text: "Delivery: Jira · Figma\nQuality: Selenium" }], hide: ["certification:c1", "tool:selenium", "tool:figma"] });
    expect(hidden.certifications.map((entry) => entry.name)).toEqual(["PMP"]);
    expect(hidden.tools).toBe("Delivery: Jira");
    expect(resumeContent(profile, { units: [{ id: "skills", label: "Skills", text: "Delivery: Agile · Scrum · Kanban" }], hide: ["skill:kanban"] }).skills).toBe("Delivery: Agile · Scrum");
    // Education leaves its graduation year off unless it's switched on, then shows it alone.
    expect(content.education[0]).toMatchObject({ dates: "", notes: "Thesis on trust in automated scheduling tools" });
    const shown = resumeContent({ ...profile, education: profile.education.map((entry) => ({ ...entry, showYear: true })) });
    expect(shown.education[0].dates).toBe("2015");
    expect(content.skills).toBe("");
    expect(content.languages).toBe("Dutch: Native · English: Fluent (C2) · German: Intermediate (B1)");
  });

  it("includes references only when asked", () => {
    expect(resumeContent(profile).references).toEqual([]);
    expect(resumeContent(profile, { includeReferences: true }).references[0]).toEqual({
      id: "r1",
      name: "John Doe",
      role: "Former manager, Northwind Logistics",
      contact: "john.doe@example.com",
    });
  });

  it("leaves an empty profile empty, apart from a placeholder name", () => {
    const empty: ProfileData = {
      basics: { ...profile.basics, ...Object.fromEntries(Object.keys(profile.basics).map((key) => [key, ""])), showAge: false },
      skills: [],
      languages: [],
      experience: [],
      projects: [],
      education: [],
      publications: [],
      references: [],
      facts: [],
    };
    expect(resumeContent(empty)).toEqual({
      name: "Your name",
      headline: "",
      contacts: [],
      summary: "",
      experience: [],
      projects: [],
      education: [],
      publications: [],
      certifications: [],
      skills: "",
      tools: "",
      languages: "",
      references: [],
    });
  });

  it("takes a tailored resume's text from its units", () => {
    const content = resumeContent(profile, { units: demoResumeUnits() });
    expect(content.summary).toMatch(/^Senior product designer with nine years of making complex/);
    expect(content.experience[0].bullets[0]).toBe(
      "Led the redesign of the carrier portal used daily by 4,000+ dispatchers: a dense, high-stakes workflow",
    );
    // Role skills still come from the profile (RES-6).
    expect(content.experience[0].skills).toContain("Design systems");
    // The Skills section is the one written for the job.
    expect(content.skills).toBe(demoResumeUnits().find((unit) => unit.id === "skills")?.text ?? "");
    expect(content.languages).toBe("Dutch: Native · English: Fluent (C2) · German: Intermediate (B1)");
  });

  it("lays out projects like roles, with their link as a resume shows it (PRO-13)", () => {
    expect(resumeContent(profile).projects).toEqual([
      {
        id: "p1",
        name: "Tidewater design tokens",
        link: "github.com/janedoe/tidewater",
        dates: "Jan 2023 – Present",
        bullets: profile.projects[0].bullets.split("\n"),
        skills: ["Design systems", "Figma", "HTML & CSS"],
      },
    ]);
    expect(displayLink("https://www.example.com/work/")).toBe("example.com/work");
    expect(displayLink(" http://github.com/jane ")).toBe("github.com/jane");
    // A tailored resume takes a project's bullets from its unit, and leaves out one without a unit.
    const tailored = resumeContent(profile, { units: [{ id: "project:p1", label: "Tidewater project", text: "Shipped a token pipeline" }] });
    expect(tailored.projects.map((project) => project.bullets)).toEqual([["Shipped a token pipeline"]]);
    expect(resumeContent(profile, { units: [] }).projects).toEqual([]);
  });

  it("shows publications word for word, with their link, and not the ones kept off resumes (#218)", () => {
    expect(resumeContent(profile).publications).toEqual([
      {
        id: "u1",
        citation: profile.publications[0].citation,
        link: "doi.org/10.5555/12345678",
        href: "https://doi.org/10.5555/12345678",
      },
    ]);
    const hidden = { ...profile, publications: [{ ...profile.publications[0], onResumes: false }, { id: "u2", citation: " ", link: "", onResumes: true }] };
    expect(resumeContent(hidden).publications).toEqual([]);
    // A tailored resume takes the citation from its unit, and a DOI on its own opens at doi.org.
    const doi = { ...profile, publications: [{ ...profile.publications[0], link: "10.1038/s41388-024-03270-3" }] };
    expect(resumeContent(doi, { units: [{ id: "publication:u1", label: "Publication", text: "Doe, J. (2016). *Edited.*" }] }).publications).toEqual([
      { id: "u1", citation: "Doe, J. (2016). *Edited.*", link: "doi.org/10.1038/s41388-024-03270-3", href: "https://doi.org/10.1038/s41388-024-03270-3" },
    ]);
    expect(resumeContent(profile, { units: [] }).publications).toEqual([]);
  });

  it("includes only the parts a tailored resume has units for, in their order", () => {
    const units = [
      { id: "experience:e2", label: "Fieldnote role", text: "Ran research" },
      { id: "experience:e1", label: "Northwind Logistics role", text: "Led the portal redesign" },
      { id: "experience:gone", label: "Deleted role", text: "Ignored" },
      { id: "education:d1", label: "MSc", text: "" },
    ];
    const content = resumeContent(profile, { units });
    expect(content.summary).toBe("");
    expect(content.experience.map((role) => [role.company, role.bullets])).toEqual([
      ["Fieldnote, Amsterdam", ["Ran research"]],
      ["Northwind Logistics, Rotterdam", ["Led the portal redesign"]],
    ]);
    expect(content.education.map((entry) => entry.school)).toEqual(["TU Delft"]);
    expect(content.skills).toBe("");
    expect(content.languages).toBe("");
  });
});

describe("certifications on a resume", () => {
  it("shows the named ones marked for resumes, word for word, with issuer, dates and ID", () => {
    const base = demoProfile();
    const content = resumeContent({
      ...base,
      certifications: [
        { id: "c1", name: "PMP", issuer: "Project Management Institute", issuedOn: "2024-03", expiresOn: "2027-03", noExpiry: false, credentialId: "123", url: "https://pmi.org/v/123", onResumes: true },
        { id: "c2", name: "Scrum Master", issuer: "", issuedOn: "", expiresOn: "2030-01", noExpiry: true, credentialId: "", url: "", onResumes: true },
        { id: "c3", name: "Hidden", issuer: "", issuedOn: "", expiresOn: "", noExpiry: false, credentialId: "", url: "", onResumes: false },
        { id: "c4", name: "  ", issuer: "No name", issuedOn: "", expiresOn: "", noExpiry: false, credentialId: "", url: "", onResumes: true },
      ],
    });
    expect(content.certifications).toEqual([
      { id: "c1", name: "PMP", detail: "Project Management Institute · Issued Mar 2024 · Expires Mar 2027 · ID 123", link: "pmi.org/v/123", href: "https://pmi.org/v/123" },
      { id: "c2", name: "Scrum Master", detail: "", link: "", href: null },
    ]);
  });
});

describe("the base resume's two-page rule", () => {
  it("shows each job's bullets as the fit chose them, and leaves out what it left out", () => {
    const profile = demoProfile();
    const [first] = profile.experience;
    const content = resumeContent(profile, {
      today,
      condense: { bullets: { [first.id]: ["One summarized bullet"] }, leftOut: profile.projects.slice(0, 1).map((entry) => `project:${entry.id}`) },
    });
    expect(content.experience[0].bullets).toEqual(["One summarized bullet"]);
    expect(content.projects).toHaveLength(Math.max(0, profile.projects.length - 1));
    // Without it, everything as written.
    expect(resumeContent(profile, { today }).projects).toHaveLength(profile.projects.length);
  });
});

describe("education on a resume", () => {
  it("ranks degrees, the highest first", () => {
    expect(["B.Sc. in Nanosystems Engineering", "M.Sc. in Applied Data Science", "PhD in Physics", "Certificate"].toSorted((a, b) => degreeRank(b) - degreeRank(a))).toEqual([
      "PhD in Physics",
      "M.Sc. in Applied Data Science",
      "B.Sc. in Nanosystems Engineering",
      "Certificate",
    ]);
  });

  it("fits the degrees on one line only when none shows a year or notes", () => {
    expect(educationOnOneRow([{ dates: "", notes: "" }, { dates: "", notes: "" }])).toBe(true);
    expect(educationOnOneRow([{ dates: "2020", notes: "" }, { dates: "", notes: "" }])).toBe(false);
    expect(educationOnOneRow([{ dates: "", notes: "Thesis" }, { dates: "", notes: "" }])).toBe(false);
  });
});
