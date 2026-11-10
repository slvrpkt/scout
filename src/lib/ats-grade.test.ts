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

  it("uses career-ops' letters", () => {
    expect([95, 85, 75, 65, 50].map(letterOf)).toEqual(["A", "B", "C", "D", "F"]);
  });
});
