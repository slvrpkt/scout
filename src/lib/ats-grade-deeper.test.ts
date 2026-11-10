import { describe, expect, it } from "vitest";

import { atsGrade } from "./ats-grade";
import { demoProfile } from "./demo-profile";
import { resumeContent } from "./resume-content";

const content = resumeContent(demoProfile());
const skill = (name: string) => ({ text: `Experience with ${name}`, skill: name, kind: "skill" as const, years: null });
const other = (text: string) => ({ text, skill: null, kind: "other" as const, years: null });
const grade = (requirements: Parameters<typeof atsGrade>[0]["requirements"], extras = {}, base = content) => atsGrade({ content: base, sidebar: false, requirements, extras });

describe("the deeper ATS checks", () => {
  it("counts a skill under any of its names: an acronym or its words", () => {
    const withPmp = { ...content, certifications: [{ id: "c", name: "Project Management Professional", detail: "", link: "", href: "" }] };
    expect(grade([skill("PMP")], {}, withPmp as never).missing).toEqual([]);
    const withJs = { ...content, skills: "JavaScript" };
    expect(grade([skill("JS")], {}, withJs).missing).toEqual([]);
  });

  it("learns a pairing the posting spells out, like Objectives and Key Results (OKR)", () => {
    const withOkr = { ...content, summary: `${content.summary} Set quarterly objectives and key results.` };
    expect(grade([other("Experience setting Objectives and Key Results (OKR)"), skill("OKR")], {}, withOkr).missing).toEqual([]);
  });

  it("counts hard skills double, and lists missing ones first", () => {
    const result = grade([other("Quantum chromodynamics lattice theory"), skill("Figma"), skill("Kubernetes")]);
    // Figma (2) of Figma (2) + Kubernetes (2) + the other (1).
    expect(result.match).toBe(40);
    expect(result.missing).toEqual(["Kubernetes", "Quantum chromodynamics lattice theory"]);
  });

  it("checks the years asked for against the profile's", () => {
    const years = { text: "8+ years of program management", skill: null, kind: "years" as const, years: 8 };
    expect(grade([years], { years: 10 }).missing).toEqual([]);
    expect(grade([years], { years: 5 }).missing).toEqual(["8+ years of program management"]);
  });

  it("checks the degree asked for against the education", () => {
    const masters = { ...content, education: [{ id: "e", degree: "M.Sc. in Data Science", school: "Syracuse", dates: "", notes: "" }] };
    expect(grade([other("Bachelor's degree in a technical field")], {}, masters).missing).toEqual([]);
    const bachelors = { ...content, education: [{ id: "e", degree: "B.Sc. in Engineering", school: "Tech", dates: "", notes: "" }] };
    expect(grade([other("Master's degree required")], {}, bachelors).missing).toEqual(["Master's degree required"]);
  });

  it("sets apart what no resume can show, for before you apply, without scoring it", () => {
    const result = grade([other("Ability to obtain a Public Trust clearance"), other("Must be able to work on-site in Austin")]);
    expect(result.beforeApplying).toEqual(["Ability to obtain a Public Trust clearance", "Must be able to work on-site in Austin"]);
    expect(result.match).toBeNull();
  });

  it("checks the phone and location, not only the email", () => {
    const bare = { ...content, contacts: ["me@example.com"] };
    const result = grade([], { city: "Utrecht", phone: "", linkedin: "" }, bare);
    expect(result.checks.find((check) => check.label.startsWith("Contact details"))).toMatchObject({ earned: 9, points: 15 });
    expect(result.fixes.join(" ")).toMatch(/phone number/);
    expect(result.tips.join(" ")).toMatch(/LinkedIn/);
  });

  it("notices the posting's title missing from the top, and a key skill said only once", () => {
    const result = grade([skill("Figma")], { title: "Staff Product Designer" });
    expect(result.tips.join(" ")).toMatch(/"Staff Product Designer" isn't in your title line or summary/);
  });

  it("notices few measurable results", () => {
    const vague = { ...content, experience: content.experience.map((role) => ({ ...role, bullets: ["Led the team", "Ran the meetings"] })) };
    expect(grade([], {}, vague).tips.join(" ")).toMatch(/0 of \d+ bullets have a number/);
  });

  it("notices a key skill that's only in older roles", () => {
    const roles = content.experience.map((role, index) => ({ ...role, skills: [], bullets: index === content.experience.length - 1 ? ["Built it in Kubernetes"] : ["Led delivery"] }));
    const padded = { ...content, summary: "", experience: [...roles, ...roles.slice(0, 3)].slice(0, 4).reverse() };
    const old = { ...padded, experience: [...padded.experience.slice(1), padded.experience[0]].map((role, index, all) => (index === all.length - 1 ? { ...role, bullets: ["Built it in Kubernetes"] } : { ...role, bullets: ["Led delivery"] })) };
    expect(grade([skill("Kubernetes")], {}, old).tips.join(" ")).toMatch(/Only in older roles.*Kubernetes/);
  });
});
