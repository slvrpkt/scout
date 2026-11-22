import { describe, expect, it } from "vitest";

import { atsGrade, letterOf } from "./ats-grade";
import { demoProfile } from "./demo-profile";
import { resumeContent } from "./resume-content";

const content = resumeContent(demoProfile());
const skill = (name: string) => ({ text: `Experience with ${name}`, skill: name });

describe("atsGrade", () => {
  it("is half Format, half Job match, with what's missing", () => {
    const grade = atsGrade({ content, sidebar: false, requirements: [skill("Figma"), skill("Kubernetes")] });
    expect(grade).toMatchObject({ format: 100, match: 50, score: 75, letter: "C", fixes: [], missing: ["Kubernetes"] });
  });

  it("goes by Format alone when the posting lists no requirements", () => {
    expect(atsGrade({ content, sidebar: false, requirements: [] })).toMatchObject({ score: 100, match: null, letter: "A" });
  });

  it("says how to fix a sidebar, and doesn't grade fonts", () => {
    const two = atsGrade({ content, sidebar: true, requirements: [skill("Figma")] });
    expect(two.format).toBe(70);
    expect(two.fixes.join(" ")).toMatch(/single column/);
    expect(two.checks.map(({ label }) => label).join(" ")).not.toMatch(/font/i);
    expect(two.checks.reduce((sum, { points }) => sum + points, 0)).toBe(100);
  });

  it("asks for what an ATS needs when it's missing", () => {
    const empty = { ...content, contacts: [], education: [] };
    const { fixes } = atsGrade({ content: empty, sidebar: false, requirements: [] });
    expect(fixes).toEqual(expect.arrayContaining(["Add your email in Profile → Basics.", "Add an Education section: an ATS looks for it by name."]));
  });

  it("counts a requirement without a skill by most of its words", () => {
    const text = { text: "Design systems and user research" , skill: null };
    expect(atsGrade({ content, sidebar: false, requirements: [{ text: "Quantum chromodynamics lattice theory", skill: null }, text] }).missing).toEqual(["Quantum chromodynamics lattice theory"]);
  });

  it("follows the requirement check for duties and degrees, but matches named tools word for word", () => {
    const duty = { text: "Artifacts for all phases of the SDLC", skill: null, kind: "other" as const };
    const degree = { text: "PhD in a STEM field", skill: null, kind: "other" as const };
    const tool = { text: "Experience with Kubernetes", skill: "Kubernetes", kind: "skill" as const };
    const requirements = [duty, degree, tool];
    expect(atsGrade({ content, sidebar: false, requirements }).missing).toEqual([degree.text, "Kubernetes", duty.text]);
    const verdicts = [
      { requirement: duty.text, result: "partial" as const },
      { requirement: degree.text, result: "covered" as const },
      // The check can't vouch for a named tool the resume doesn't name.
      { requirement: tool.text, result: "covered" as const },
    ];
    expect(atsGrade({ content, sidebar: false, requirements, verdicts }).missing).toEqual(["Kubernetes"]);
    // A gap verdict doesn't undo what the resume's own words show.
    expect(atsGrade({ content, sidebar: false, requirements: [skill("Figma")], verdicts: [{ requirement: "Experience with Figma", result: "gap" }] }).missing).toEqual([]);
  });

  it("reads a slash as two things, both ways", () => {
    const agile = { ...content, summary: `${content.summary} Agile delivery with Scrum teams across the SDLC/SELC.` };
    const requirements = [{ text: "Agile/Scrum methodology", skill: "Agile/Scrum", kind: "skill" as const }, { text: "SELC", skill: "SELC", kind: "skill" as const }];
    expect(atsGrade({ content: agile, sidebar: false, requirements }).missing).toEqual([]);
    expect(atsGrade({ content, sidebar: false, requirements }).missing).toEqual(["Agile/Scrum", "SELC"]);
  });

  it("counts a named skill the check found once part of its name is on the resume", () => {
    const selc = { ...content, summary: `${content.summary} Wrote SELC artifacts.` };
    const requirement = { text: "Developing SELC documents", skill: "SELC documentation", kind: "skill" as const };
    expect(atsGrade({ content: selc, sidebar: false, requirements: [requirement] }).missing).toEqual(["SELC documentation"]);
    expect(atsGrade({ content: selc, sidebar: false, requirements: [requirement], verdicts: [{ requirement: requirement.text, result: "covered" }] }).missing).toEqual([]);
    // Not when nothing of its name is there.
    expect(atsGrade({ content, sidebar: false, requirements: [requirement], verdicts: [{ requirement: requirement.text, result: "covered" }] }).missing).toEqual(["SELC documentation"]);
    // Nor for a broad word alone: Microsoft Project isn't Microsoft Office.
    const office = { text: "Microsoft Office Suite", skill: "Microsoft Office", kind: "skill" as const };
    const project = { ...content, summary: `${content.summary} Planned in Microsoft Project.` };
    expect(atsGrade({ content: project, sidebar: false, requirements: [office], verdicts: [{ requirement: office.text, result: "covered" }] }).missing).toEqual(["Microsoft Office"]);
  });

  it("uses career-ops' letters", () => {
    expect([95, 85, 75, 65, 50].map(letterOf)).toEqual(["A", "B", "C", "D", "F"]);
  });
});
