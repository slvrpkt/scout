import { describe, expect, it } from "vitest";

import { demoProfile } from "./demo-profile";
import { resumeContent } from "./resume-content";

describe("the list of all your skills, and of your tools and platforms", () => {
  it("is on the base resume's Full version only, never on a shorter or tailored one", () => {
    const profile = demoProfile();
    expect(resumeContent(profile, { skillsList: true }).skills).not.toBe("");
    expect(resumeContent(profile, {}).skills).toBe("");
    expect(resumeContent(profile, { skillsList: true, units: [] }).skills).toBe("");
  });

  it("prints tools apart from skills, a line per category", () => {
    const base = demoProfile();
    const profile = {
      ...base,
      skills: [
        { id: "a", name: "Agile", group: "Delivery" },
        { id: "t1", name: "Terraform", group: "Cloud & DevOps", kind: "TOOL" as const },
        { id: "t2", name: "Docker", group: "Cloud & DevOps", kind: "TOOL" as const },
        { id: "t3", name: "Vitest", group: "Testing", kind: "TOOL" as const },
      ],
    };
    const content = resumeContent(profile, { skillsList: true });
    expect(content.skills).toBe("Delivery: Agile");
    expect(content.tools).toBe("Cloud & DevOps: Terraform · Docker\nTesting: Vitest");
    expect(resumeContent(profile, {}).tools).toBe("");
  });
});
